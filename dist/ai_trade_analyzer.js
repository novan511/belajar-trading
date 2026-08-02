import { CONFIG } from './config.js';
export class AITradeAnalyzer {
    analyze(trades, riskMetrics) {
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
        const autoTuning = this.computeAutoTuning(trades, symbolBreakdown, profitFactor, overallWinRate);
        const sessionAnalysis = this.computeSessionAnalysis(trades);
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
            autoTuning,
            sessionAnalysis,
        };
    }
    emptyAnalysis(riskMetrics) {
        return {
            totalTrades: 0, winRate: 0, netProfitUsd: 0, profitFactor: 0, avgWinUsd: 0, avgLossUsd: 0, avgHoldTimeSec: 0,
            bestTrade: null, worstTrade: null, symbolBreakdown: [], sideBreakdown: [], hourlyBreakdown: [], dailyBreakdown: [],
            consecutiveLosses: 0, maxDrawdown: 0, riskMetrics: null,
            aiInsights: { summary: 'Belum ada data trade.', strengths: [], weaknesses: [], recommendations: [], patternNotes: [] },
            autoTuning: {
                recommendedObiThreshold: null,
                recommendedZScoreThreshold: null,
                recommendedTakeProfitPct: null,
                recommendedStopLossPct: null,
                reason: 'Belum cukup data untuk auto-tuning.',
                confidence: null,
            },
            sessionAnalysis: null,
        };
    }
    groupBy(arr, keyFn) {
        return arr.reduce((acc, t) => {
            const k = keyFn(t);
            (acc[k] = acc[k] || []).push(t);
            return acc;
        }, {});
    }
    calculateMaxConsecutiveLosses(trades) {
        let max = 0, current = 0;
        for (const t of trades) {
            if (t.result === 'LOSS') {
                current++;
                max = Math.max(max, current);
            }
            else
                current = 0;
        }
        return max;
    }
    generateInsights(trades, symbolBreakdown, sideBreakdown, hourlyBreakdown, profitFactor, winRate) {
        const strengths = [];
        const weaknesses = [];
        const recommendations = [];
        const patternNotes = [];
        const summaries = [];
        const total = trades.length;
        const topSymbol = symbolBreakdown[0];
        if (topSymbol && topSymbol.totalTrades >= 3) {
            strengths.push(`Symbol terkuat: ${topSymbol.symbol} (WR ${topSymbol.winRate.toFixed(0)}%, net $${topSymbol.netProfitUsd.toFixed(2)})`);
        }
        if (profitFactor > 1.5)
            strengths.push(`Profit factor sehat: ${profitFactor.toFixed(2)}`);
        if (winRate >= 55)
            strengths.push(`Win rate solid: ${winRate.toFixed(1)}%`);
        if (winRate < 45)
            weaknesses.push(`Win rate rendah: ${winRate.toFixed(1)}% — perlu filter entry lebih ketat`);
        if (profitFactor < 1)
            weaknesses.push(`Profit factor < 1 (${profitFactor.toFixed(2)}): strategi masih loss after fees`);
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
            if (longTrades.netProfitUsd > shortTrades.netProfitUsd)
                patternNotes.push(`Long lebih unggul (+$${longTrades.netProfitUsd.toFixed(2)}) dibanding short (+$${shortTrades.netProfitUsd.toFixed(2)})`);
            else
                patternNotes.push(`Short lebih unggul (+$${shortTrades.netProfitUsd.toFixed(2)}) dibanding long (+$${longTrades.netProfitUsd.toFixed(2)})`);
        }
        if (total > 0 && total < 20)
            recommendations.push('Masih early stage — tunggu minimal 20-30 trade untuk evaluasi yang lebih representatif');
        if (weaknesses.length === 0 && total > 0)
            summaries.push(`Performa solid. Lanjutkan dan fokus pada risk management.`);
        else if (weaknesses.length >= 2)
            summaries.push('Ada beberapa area perbaikan — lihat rekomendasi di bawah.');
        const summary = summaries.length > 0 ? summaries[0] : `Total ${total} trade dengan win rate ${winRate.toFixed(1)}% dan profit factor ${profitFactor.toFixed(2)}.`;
        return { summary, strengths, weaknesses, recommendations, patternNotes };
    }
    /**
     * B. Auto-Parameter Tuning: analyze performance trends and recommend parameter adjustments
     */
    computeAutoTuning(trades, symbolBreakdown, profitFactor, winRate) {
        const total = trades.length;
        if (total < 10) {
            return {
                recommendedObiThreshold: null,
                recommendedZScoreThreshold: null,
                recommendedTakeProfitPct: null,
                recommendedStopLossPct: null,
                reason: 'Belum cukup data (min 10 trade). Tunggu evaluasi berikutnya.',
                confidence: null,
            };
        }
        const recentTrades = trades.slice(-30);
        const recentWins = recentTrades.filter(t => t.result === 'WIN');
        const recentLosses = recentTrades.filter(t => t.result === 'LOSS');
        const recentWinRate = recentWins.length / recentTrades.length;
        const recommendations = [];
        let obiThreshold = null;
        let zScoreThreshold = null;
        let takeProfitPct = null;
        let stopLossPct = null;
        // Win rate declining → tighten entry thresholds
        if (recentWinRate < 0.45 && total >= 20) {
            const olderHalf = trades.slice(0, Math.floor(total / 2));
            const olderWins = olderHalf.filter(t => t.result === 'WIN').length;
            const olderWinRate = olderWins / olderHalf.length;
            if (recentWinRate < olderWinRate - 0.1) {
                obiThreshold = CONFIG.SYMBOLS.BTC.obiThreshold * 1.15;
                zScoreThreshold = CONFIG.SYMBOLS.BTC.zScoreThreshold * 1.1;
                recommendations.push(`Win rate menurun (terkini ${(recentWinRate * 100).toFixed(0)}% vs historis ${(olderWinRate * 100).toFixed(0)}%) → tighten OBV threshold +15% dan Z-score +10%`);
            }
        }
        // Profit factor < 1 → widen stops, reduce TP
        if (profitFactor < 1.0 && total >= 15) {
            stopLossPct = CONFIG.SYMBOLS.BTC.stopLossPct * 0.8;
            takeProfitPct = CONFIG.SYMBOLS.BTC.takeProfitPct * 0.9;
            recommendations.push(`Profit factor ${profitFactor.toFixed(2)} < 1 → relaksasi SL ke ${(stopLossPct * 100).toFixed(2)}% dan TP ke ${(takeProfitPct * 100).toFixed(2)}%`);
        }
        // High win rate but low profit factor → widen TP
        if (winRate >= 60 && profitFactor < 1.3 && total >= 20) {
            takeProfitPct = CONFIG.SYMBOLS.BTC.takeProfitPct * 1.2;
            recommendations.push(`Win rate tinggi (${(winRate * 100).toFixed(0)}%) tapi profit factor rendah (${profitFactor.toFixed(2)}) → perbesar TP ke ${(takeProfitPct * 100).toFixed(2)}%`);
        }
        // Consecutive losses → pause and widen
        const maxConsecLoss = this.calculateMaxConsecutiveLosses(trades);
        if (maxConsecLoss >= 4) {
            stopLossPct = CONFIG.SYMBOLS.BTC.stopLossPct * 1.2;
            recommendations.push(`${maxConsecLoss} consecutive losses → perlebar SL ke ${(stopLossPct * 100).toFixed(2)}% dan kurangi ukuran posisi`);
        }
        const confidence = recommendations.length > 0 ? (recommendations.length >= 2 ? 'HIGH' : 'LOW') : null;
        const reason = recommendations.length > 0 ? recommendations.join('; ') : 'Tidak ada penyesuaian parameter yang direkomendasikan saat ini.';
        return {
            recommendedObiThreshold: obiThreshold,
            recommendedZScoreThreshold: zScoreThreshold,
            recommendedTakeProfitPct: takeProfitPct,
            recommendedStopLossPct: stopLossPct,
            reason,
            confidence,
        };
    }
    /**
     * C. Session-Based Learning: analyze hourly performance and recommend session adjustments
     */
    computeSessionAnalysis(trades) {
        if (trades.length < 10)
            return null;
        const byHour = {};
        for (const t of trades) {
            const hour = new Date(t.entryTime).getUTCHours();
            if (!byHour[hour])
                byHour[hour] = { trades: 0, wins: 0, netProfit: 0 };
            byHour[hour].trades++;
            if (t.result === 'WIN')
                byHour[hour].wins++;
            byHour[hour].netProfit += t.netProfitUsd;
        }
        const sessionEntries = Object.entries(byHour)
            .filter(([_, data]) => data.trades >= 3)
            .map(([hour, data]) => ({
            hour: parseInt(hour),
            winRate: data.wins / data.trades,
            netProfit: data.netProfit,
            trades: data.trades,
        }))
            .sort((a, b) => b.netProfit - a.netProfit);
        if (sessionEntries.length === 0)
            return null;
        const bestSession = sessionEntries[0];
        const worstSession = sessionEntries[sessionEntries.length - 1];
        let shouldPauseSession = null;
        const recommendation = [];
        if (worstSession.winRate < 0.3 && worstSession.trades >= 3) {
            shouldPauseSession = `UTC ${String(worstSession.hour).padStart(2, '0')}:00`;
            recommendation.push(`Sesi UTC ${shouldPauseSession} memiliki WR ${(worstSession.winRate * 100).toFixed(0)}% dan net PnL $${worstSession.netProfit.toFixed(2)} → auto-pause di jam ini`);
        }
        if (bestSession.winRate >= 0.6 && bestSession.trades >= 3) {
            recommendation.push(`Sesi terbaik: UTC ${String(bestSession.hour).padStart(2, '0')}:00 (WR ${(bestSession.winRate * 100).toFixed(0)}%, net $${bestSession.netProfit.toFixed(2)}) → prioritas trading di jam ini`);
        }
        return {
            bestSession: `UTC ${String(bestSession.hour).padStart(2, '0')}:00`,
            worstSession: `UTC ${String(worstSession.hour).padStart(2, '0')}:00`,
            shouldPauseSession,
            recommendation: recommendation.join('; '),
        };
    }
    /**
     * D. Reinforcement Learning Ringan: process feedback and adjust future insights
     */
    processFeedback(feedback, rating, currentInsights) {
        const adjusted = { ...currentInsights };
        if (rating === 1) {
            adjusted.strengths.push(`User feedback: insight terbukti akurat`);
        }
        else if (rating === -1) {
            adjusted.weaknesses.push(`User feedback: insight tidak akurat — perlu re-evaluation`);
            adjusted.recommendations.push('Insight ini kurang akurat. Pertimbangkan untuk menyesuaikan parameter entry.');
        }
        return adjusted;
    }
}
