import { TradeRecord, PerformanceAttribution, RiskMetrics } from './types.js';
import { CONFIG } from './config.js';

export interface TradeAnalysis {
  totalTrades: number;
  winRate: number;
  netProfitUsd: number;
  profitFactor: number;
  avgWinUsd: number;
  avgLossUsd: number;
  avgHoldTimeSec: number;
  bestTrade: { symbol: string; side: string; netProfitUsd: number; date: string } | null;
  worstTrade: { symbol: string; side: string; netProfitUsd: number; date: string } | null;
  symbolBreakdown: PerformanceAttribution[];
  sideBreakdown: { side: string; trades: number; winRate: number; netProfitUsd: number }[];
  hourlyBreakdown: { hour: number; trades: number; winRate: number; netProfitUsd: number }[];
  dailyBreakdown: { date: string; trades: number; winRate: number; netProfitUsd: number }[];
  consecutiveLosses: number;
  maxDrawdown: number;
  riskMetrics: RiskMetrics | null;
  aiInsights: {
    summary: string;
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
    patternNotes: string[];
  };
}

export class AITradeAnalyzer {
  analyze(trades: TradeRecord[], riskMetrics: RiskMetrics | null): TradeAnalysis {
    if (trades.length === 0) {
      return this.emptyAnalysis(riskMetrics);
    }

    const wins = trades.filter(t => t.result === 'WIN');
    const losses = trades.filter(t => t.result === 'LOSS');
    const grossWin = wins.reduce((s, t) => s + t.netProfitUsd, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netProfitUsd, 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;

    const avgWin = wins.length > 0 ? grossWin / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
    const avgHold = trades.reduce((s, t) => s + t.holdTimeSec, 0) / trades.length;

    const best = wins.length > 0 ? wins.reduce((a, b) => a.netProfitUsd > b.netProfitUsd ? a : b) : null;
    const worst = losses.length > 0 ? losses.reduce((a, b) => a.netProfitUsd < b.netProfitUsd ? a : b) : null;

    const bySymbol = this.groupBy(trades, t => t.symbol);
    const bySide = this.groupBy(trades, t => t.side);
    const byHour = this.groupBy(trades, t => new Date(t.entryTime).getUTCHours());
    const byDate = this.groupBy(trades, t => new Date(t.entryTime).toISOString().split('T')[0]);

    const symbolBreakdown = Object.entries(bySymbol).map(([symbol, symTrades]) => {
      const symWins = symTrades.filter(t => t.result === 'WIN').length;
      const symNet = symTrades.reduce((s, t) => s + t.netProfitUsd, 0);
      return {
        symbol,
        totalTrades: symTrades.length,
        winRate: symTrades.length > 0 ? (symWins / symTrades.length) * 100 : 0,
        netProfitUsd: parseFloat(symNet.toFixed(4)),
        profitFactor: 0,
        sharpeRatio: 0,
        avgReturnPerTrade: parseFloat((symNet / symTrades.length).toFixed(4)),
        maxDrawdown: 0,
      };
    }).sort((a, b) => b.netProfitUsd - a.netProfitUsd);

    const sideBreakdown = Object.entries(bySide).map(([side, sideTrades]) => {
      const sideWins = sideTrades.filter(t => t.result === 'WIN').length;
      const sideNet = sideTrades.reduce((s, t) => s + t.netProfitUsd, 0);
      return { side, trades: sideTrades.length, winRate: (sideWins / sideTrades.length) * 100, netProfitUsd: parseFloat(sideNet.toFixed(4)) };
    });

    const hourlyBreakdown = Object.entries(byHour).map(([hour, hourTrades]) => {
      const hourWins = hourTrades.filter(t => t.result === 'WIN').length;
      const hourNet = hourTrades.reduce((s, t) => s + t.netProfitUsd, 0);
      return { hour: parseInt(hour), trades: hourTrades.length, winRate: (hourWins / hourTrades.length) * 100, netProfitUsd: parseFloat(hourNet.toFixed(4)) };
    }).sort((a, b) => a.hour - b.hour);

    const dailyBreakdown = Object.entries(byDate).map(([date, dateTrades]) => {
      const dayWins = dateTrades.filter(t => t.result === 'WIN').length;
      const dayNet = dateTrades.reduce((s, t) => s + t.netProfitUsd, 0);
      return { date, trades: dateTrades.length, winRate: (dayWins / dateTrades.length) * 100, netProfitUsd: parseFloat(dayNet.toFixed(4)) };
    });

    const overallWinRate = (wins.length / trades.length) * 100;
    const aiInsights = this.generateInsights(trades, symbolBreakdown, sideBreakdown, hourlyBreakdown, profitFactor, overallWinRate);

    return {
      totalTrades: trades.length,
      winRate: overallWinRate,
      netProfitUsd: parseFloat((wins.reduce((s, t) => s + t.netProfitUsd, 0) - Math.abs(losses.reduce((s, t) => s + t.netProfitUsd, 0))).toFixed(4)),
      profitFactor,
      avgWinUsd: parseFloat(avgWin.toFixed(4)),
      avgLossUsd: parseFloat(avgLoss.toFixed(4)),
      avgHoldTimeSec: parseFloat(avgHold.toFixed(2)),
      bestTrade: best ? { symbol: best.symbol, side: best.side, netProfitUsd: parseFloat(best.netProfitUsd.toFixed(4)), date: new Date(best.exitTime).toISOString() } : null,
      worstTrade: worst ? { symbol: worst.symbol, side: worst.side, netProfitUsd: parseFloat(worst.netProfitUsd.toFixed(4)), date: new Date(worst.exitTime).toISOString() } : null,
      symbolBreakdown,
      sideBreakdown,
      hourlyBreakdown,
      dailyBreakdown,
      consecutiveLosses: this.calculateMaxConsecutiveLosses(trades),
      maxDrawdown: riskMetrics ? riskMetrics.maxDrawdown : 0,
      riskMetrics,
      aiInsights,
    };
  }

  private emptyAnalysis(riskMetrics: RiskMetrics | null): TradeAnalysis {
    return {
      totalTrades: 0, winRate: 0, netProfitUsd: 0, profitFactor: 0, avgWinUsd: 0, avgLossUsd: 0, avgHoldTimeSec: 0,
      bestTrade: null, worstTrade: null, symbolBreakdown: [], sideBreakdown: [], hourlyBreakdown: [], dailyBreakdown: [],
      consecutiveLosses: 0, maxDrawdown: 0, riskMetrics: null,
      aiInsights: { summary: 'Belum ada data trade.', strengths: [], weaknesses: [], recommendations: [], patternNotes: [] },
    };
  }

  private groupBy<T>(arr: T[], keyFn: (t: T) => string | number): Record<string | number, T[]> {
    return arr.reduce((acc, t) => {
      const k = keyFn(t);
      (acc[k] = acc[k] || []).push(t);
      return acc;
    }, {} as Record<string | number, T[]>);
  }

  private calculateMaxConsecutiveLosses(trades: TradeRecord[]): number {
    let max = 0, current = 0;
    for (const t of trades) {
      if (t.result === 'LOSS') { current++; max = Math.max(max, current); }
      else current = 0;
    }
    return max;
  }

  private generateInsights(
    trades: TradeRecord[],
    symbolBreakdown: PerformanceAttribution[],
    sideBreakdown: { side: string; trades: number; winRate: number; netProfitUsd: number }[],
    hourlyBreakdown: { hour: number; trades: number; winRate: number; netProfitUsd: number }[],
    profitFactor: number,
    winRate: number
  ): TradeAnalysis['aiInsights'] {
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const recommendations: string[] = [];
    const patternNotes: string[] = [];
    const summaries: string[] = [];

    const total = trades.length;
    const topSymbol = symbolBreakdown[0];
    if (topSymbol && topSymbol.totalTrades >= 3) {
      strengths.push(`Symbol terkuat: ${topSymbol.symbol} (WR ${topSymbol.winRate.toFixed(0)}%, net $${topSymbol.netProfitUsd.toFixed(2)})`);
    }
    if (profitFactor > 1.5) strengths.push(`Profit factor sehat: ${profitFactor.toFixed(2)}`);
    if (winRate >= 55) strengths.push(`Win rate solid: ${winRate.toFixed(1)}%`);
    if (winRate < 45) weaknesses.push(`Win rate rendah: ${winRate.toFixed(1)}% — perlu filter entry lebih ketat`);
    if (profitFactor < 1) weaknesses.push(`Profit factor < 1 (${profitFactor.toFixed(2)}): strategi masih loss after fees`);

    const bestHour = hourlyBreakdown.sort((a, b) => b.netProfitUsd - a.netProfitUsd)[0];
    if (bestHour && bestHour.trades >= 3) {
      patternNotes.push(`Sesi terbaik: UTC ${String(bestHour.hour).padStart(2, '0')}:00 (WR ${bestHour.winRate.toFixed(0)}%, net $${bestHour.netProfitUsd.toFixed(2)})`);
    }
    const worstHour = hourlyBreakdown.sort((a, b) => a.netProfitUsd - b.netProfitUsd)[0];
    if (worstHour && worstHour.trades >= 3) {
      weaknesses.push(`Sesi terburuk: UTC ${String(worstHour.hour).padStart(2, '0')}:00 — pertimbangkan matikan trading di sesi ini`);
    }

    const longTrades = sideBreakdown.find(s => s.side === 'BUY');
    const shortTrades = sideBreakdown.find(s => s.side === 'SELL');
    if (longTrades && shortTrades) {
      if (longTrades.netProfitUsd > shortTrades.netProfitUsd) patternNotes.push(`Long lebih unggul (+$${longTrades.netProfitUsd.toFixed(2)}) dibanding short (+$${shortTrades.netProfitUsd.toFixed(2)})`);
      else patternNotes.push(`Short lebih unggul (+$${shortTrades.netProfitUsd.toFixed(2)}) dibanding long (+$${longTrades.netProfitUsd.toFixed(2)})`);
    }

    if (total > 0 && total < 20) recommendations.push('Masih early stage — tunggu minimal 20-30 trade untuk evaluasi yang lebih representatif');
    if (weaknesses.length === 0 && total > 0) summaries.push(`Performa solid. Lanjutkan dan fokus pada risk management.`);
    else if (weaknesses.length >= 2) summaries.push('Ada beberapa area perbaikan — lihat rekomendasi di bawah.');

    const summary = summaries.length > 0 ? summaries[0] : `Total ${total} trade dengan win rate ${winRate.toFixed(1)}% dan profit factor ${profitFactor.toFixed(2)}.`;

    return { summary, strengths, weaknesses, recommendations, patternNotes };
  }
}
