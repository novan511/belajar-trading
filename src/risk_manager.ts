/**
 * Advanced Risk Manager Module
 * 
 * Features:
 * - Daily drawdown limit (auto-pause on threshold breach)
 * - Kelly Criterion position sizing
 * - ATR-based dynamic position sizing
 * - Session-based trading filters
 * - Portfolio-level risk controls
 */

import { CONFIG } from './config.js';
import { ExecutionStats, TradeRecord, MarketRegime, TradingSession } from './types.js';

export class RiskManager {
  private dailyStartBalance: number = CONFIG.ACCOUNT_BALANCE_USD;
  private currentBalance: number = CONFIG.ACCOUNT_BALANCE_USD;
  private dailyPeakBalance: number = CONFIG.ACCOUNT_BALANCE_USD;
  private isPausedForDay: boolean = false;
  private pauseDate: string = '';
  private dailyTrades: number = 0;
  private dailyLosses: number = 0;

  // Performance tracking per symbol
  private symbolStats: Map<string, { wins: number; losses: number; totalPnl: number; trades: number }> = new Map();

  constructor() {
    this.resetDaily();
  }

  /**
   * Reset daily counters (call at start of each trading day)
   */
  public resetDaily() {
    const today = new Date().toDateString();
    if (this.pauseDate !== today) {
      this.dailyStartBalance = this.currentBalance;
      this.dailyPeakBalance = this.currentBalance;
      this.isPausedForDay = false;
      this.dailyTrades = 0;
      this.dailyLosses = 0;
    }
  }

  /**
   * Update balance after a trade closes
   */
  public updateBalance(profitLoss: number, symbol: string, result: 'WIN' | 'LOSS' | 'BREAKEVEN') {
    this.currentBalance += profitLoss;
    this.dailyTrades++;

    if (result === 'LOSS') {
      this.dailyLosses++;
    }

    // Track per-symbol performance
    const existing = this.symbolStats.get(symbol) || { wins: 0, losses: 0, totalPnl: 0, trades: 0 };
    existing.trades++;
    existing.totalPnl += profitLoss;
    if (result === 'WIN') existing.wins++;
    else if (result === 'LOSS') existing.losses++;
    this.symbolStats.set(symbol, existing);

    // Track peak balance for drawdown calculation
    if (this.currentBalance > this.dailyPeakBalance) {
      this.dailyPeakBalance = this.currentBalance;
    }

    // Check daily drawdown limit
    const dailyDrawdown = (this.dailyPeakBalance - this.currentBalance) / this.dailyPeakBalance;
    if (dailyDrawdown >= CONFIG.DAILY_DRAWDOWN_LIMIT_PCT) {
      this.isPausedForDay = true;
      this.pauseDate = new Date().toDateString();
      console.log(`\n\x1b[31m[RISK MANAGER] ⛔ DAILY DRAWDOWN LIMIT REACHED! ${(dailyDrawdown * 100).toFixed(2)}% >= ${(CONFIG.DAILY_DRAWDOWN_LIMIT_PCT * 100).toFixed(2)}%. Trading PAUSED until next day.\x1b[0m\n`);
    }
  }

  /**
   * Check if trading is allowed (not paused, good session, etc.)
   */
  public isTradingAllowed(): boolean {
    if (this.isPausedForDay) {
      // Check if it's a new day
      const today = new Date().toDateString();
      if (this.pauseDate !== today) {
        this.resetDaily();
        return true;
      }
      return false;
    }

    // Time-based filtering: only trade during high-liquidity sessions
    if (!this.isInTradingSession()) {
      return false;
    }

    return true;
  }

  /**
   * Check if current time is within configured trading session
   */
  private isInTradingSession(): boolean {
    const now = new Date();
    const hourUtc = now.getUTCHours();
    
    const start = CONFIG.TRADING_SESSION_START_HOUR_UTC;
    const end = CONFIG.TRADING_SESSION_END_HOUR_UTC;

    if (start <= end) {
      return hourUtc >= start && hourUtc < end;
    } else {
      // Wraps around midnight
      return hourUtc >= start || hourUtc < end;
    }
  }

  /**
   * Get current trading session name
   */
  public getTradingSession(): TradingSession {
    const now = new Date();
    const hourUtc = now.getUTCHours();
    const minuteUtc = now.getUTCMinutes();
    const timeDecimal = hourUtc + minuteUtc / 60;

    // Asian session: 00:00 - 09:00 UTC
    // London session: 08:00 - 17:00 UTC
    // New York session: 13:00 - 22:00 UTC

    const isAsian = timeDecimal >= 0 && timeDecimal < 9;
    const isLondon = timeDecimal >= 8 && timeDecimal < 17;
    const isNewYork = timeDecimal >= 13 && timeDecimal < 22;

    if (isLondon && isNewYork) return 'OVERLAP';
    if (isAsian && isLondon) return 'OVERLAP';
    if (isAsian) return 'ASIAN';
    if (isLondon) return 'LONDON';
    if (isNewYork) return 'NEW_YORK';
    return 'OFF_HOURS';
  }

  /**
   * Calculate position size using Kelly Criterion + ATR adjustment
   * 
   * Kelly % = W - (1-W)/(R)
   * where W = win rate, R = avg win / avg loss
   * We use fractional Kelly (25%) to be conservative
   */
  public calculatePositionSize(
    stats: ExecutionStats,
    symbol: string,
    atr: number,
    entryPrice: number,
    stopPrice: number,
    confidence: 'HIGH' | 'LOW'
  ): number {
    // 1. Base risk amount
    let baseRisk = CONFIG.BASE_RISK_PER_TRADE_USD;

    // 2. Adjust for confidence
    if (confidence === 'LOW') {
      baseRisk *= 0.5;
    }

    // 3. Kelly Criterion adjustment
    if (stats.totalTrades >= 20) {
      const winRate = stats.winRate / 100;
      const avgWin = stats.netProfitUsd > 0 
        ? stats.grossProfitUsd / stats.winningTrades 
        : 0;
      const avgLoss = stats.losingTrades > 0 
        ? Math.abs(stats.grossProfitUsd - stats.netProfitUsd - stats.totalFeesUsd) / stats.losingTrades 
        : baseRisk;
      
      if (avgWin > 0 && avgLoss > 0) {
        const r = avgWin / avgLoss;
        const kelly = winRate - ((1 - winRate) / r);
        const fractionKelly = Math.max(0.01, Math.min(0.5, kelly * CONFIG.KELLY_FRACTION));
        baseRisk *= fractionKelly * 10; // Scale up Kelly fraction
      }
    }

    // 4. ATR-based volatility adjustment
    const riskDistance = Math.abs(entryPrice - stopPrice);
    const atrMultiplier = riskDistance > 0 
      ? Math.max(CONFIG.ATR_MULTIPLIER_MIN, Math.min(CONFIG.ATR_MULTIPLIER_MAX, atr / riskDistance))
      : 1;

    const adjustedRisk = baseRisk * atrMultiplier;

    // 5. Calculate quantity
    if (riskDistance <= 0) return 0;
    const quantity = (adjustedRisk / riskDistance);
    
    // 6. Check max position risk (1% of account)
    const maxRiskAmount = CONFIG.ACCOUNT_BALANCE_USD * CONFIG.MAX_POSITION_RISK_PCT;
    const finalQuantity = Math.min(quantity, maxRiskAmount / riskDistance);

    return Math.max(0, parseFloat(finalQuantity.toFixed(6)));
  }

  /**
   * Get performance stats for a specific symbol
   */
  public getSymbolStats(symbol: string) {
    return this.symbolStats.get(symbol) || null;
  }

  /**
   * Get comprehensive performance attribution data
   */
  public getPerformanceAttribution(): any[] {
    const results: any[] = [];
    for (const [symbol, data] of this.symbolStats) {
      results.push({
        symbol,
        totalTrades: data.trades,
        winRate: data.trades > 0 ? (data.wins / data.trades) * 100 : 0,
        netProfitUsd: parseFloat(data.totalPnl.toFixed(4)),
        profitFactor: data.losses > 0 ? (data.wins > 0 ? data.wins / data.losses : 0) : data.wins,
        trades: data.trades,
        wins: data.wins,
        losses: data.losses
      });
    }
    return results.sort((a, b) => b.netProfitUsd - a.netProfitUsd);
  }

  public getIsPaused(): boolean {
    return this.isPausedForDay;
  }

  public getCurrentBalance(): number {
    return this.currentBalance;
  }

  public getDailyDrawdownPct(): number {
    return (this.dailyPeakBalance - this.currentBalance) / this.dailyPeakBalance;
  }
}
