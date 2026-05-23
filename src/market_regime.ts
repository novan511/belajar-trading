/**
 * Market Regime Detection Module
 * 
 * Identifies current market conditions:
 * - Trending Bull / Trending Bear
 * - Ranging / Sideways 
 * - High Volatility / Low Volatility
 * 
 * Uses EMA slope, ATR, and price action analysis
 */

import { CONFIG } from './config.js';
import { MarketRegime } from './types.js';

export class MarketRegimeDetector {
  // EMA slopes for trend detection per symbol
  private emaValues: Map<string, number> = new Map();
  private emaSlopes: Map<string, number> = new Map();
  private atrValues: Map<string, number> = new Map();
  private priceHistory: Map<string, number[]> = new Map();
  
  // Regime cache
  private currentRegime: Map<string, MarketRegime> = new Map();

  constructor() {}

  /**
   * Process a mid-price tick to update regime indicators
   */
  public processPrice(symbol: string, midPrice: number) {
    // 1. Update price history
    if (!this.priceHistory.has(symbol)) {
      this.priceHistory.set(symbol, []);
    }
    const prices = this.priceHistory.get(symbol)!;
    prices.push(midPrice);
    if (prices.length > CONFIG.REGIME_LOOKBACK_CANDLES) {
      prices.shift();
    }

    // 2. Update EMA
    const emaPeriod = CONFIG.REGIME_EMA_PERIOD;
    const k = 2 / (emaPeriod + 1);
    const currentEma = this.emaValues.get(symbol);
    
    if (currentEma === undefined) {
      this.emaValues.set(symbol, midPrice);
    } else {
      const newEma = midPrice * k + currentEma * (1 - k);
      this.emaValues.set(symbol, newEma);

      // 3. Calculate EMA slope (rate of change)
      const prevEma = currentEma;
      const slope = (newEma - prevEma) / prevEma;
      this.emaSlopes.set(symbol, slope);
    }

    // 4. Calculate ATR (simplified)
    if (prices.length >= 2) {
      const atrPeriod = CONFIG.ATR_PERIOD;
      const recentPrices = prices.slice(-atrPeriod);
      
      if (recentPrices.length >= 2) {
        let totalRange = 0;
        for (let i = 1; i < recentPrices.length; i++) {
          totalRange += Math.abs(recentPrices[i] - recentPrices[i - 1]);
        }
        const atr = totalRange / (recentPrices.length - 1);
        this.atrValues.set(symbol, atr);
      }
    }
  }

  /**
   * Determine current market regime for a symbol
   */
  public detectRegime(symbol: string): MarketRegime {
    const prices = this.priceHistory.get(symbol);
    const atr = this.atrValues.get(symbol);
    const slope = this.emaSlopes.get(symbol);

    if (!prices || prices.length < 20) {
      return 'LOW_VOLATILITY'; // Default when not enough data
    }

    // 1. Check volatility
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const atrPct = atr ? atr / avgPrice : 0;
    const isHighVol = atrPct > 0.005; // 0.5% ATR relative to price
    const isLowVol = atrPct < 0.001; // 0.1% ATR relative to price

    // 2. Check trend strength
    // Count how many consecutive closes are above/below EMA
    const ema = this.emaValues.get(symbol);
    const recentPrices = prices.slice(-10);
    
    let aboveCount = 0;
    let belowCount = 0;
    
    for (const p of recentPrices) {
      if (ema && p > ema) aboveCount++;
      else if (ema && p < ema) belowCount++;
    }

    const trendStrength = Math.abs(aboveCount - belowCount) / recentPrices.length;
    const isStrongTrend = trendStrength >= CONFIG.REGIME_TREND_STRENGTH_THRESHOLD;

    // 3. Determine regime
    let regime: MarketRegime;

    if (isStrongTrend && slope) {
      if (slope > 0 && aboveCount > belowCount) {
        regime = isHighVol ? 'HIGH_VOLATILITY' : 'TRENDING_BULL';
      } else if (slope < 0 && belowCount > aboveCount) {
        regime = isHighVol ? 'HIGH_VOLATILITY' : 'TRENDING_BEAR';
      } else {
        regime = isHighVol ? 'HIGH_VOLATILITY' : 'RANGING';
      }
    } else {
      if (isHighVol) regime = 'HIGH_VOLATILITY';
      else if (isLowVol) regime = 'LOW_VOLATILITY';
      else regime = 'RANGING';
    }

    this.currentRegime.set(symbol, regime);
    return regime;
  }

  /**
   * Get trend direction
   */
  public getTrendDirection(symbol: string): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
    const regime = this.currentRegime.get(symbol);
    if (regime === 'TRENDING_BULL') return 'BULLISH';
    if (regime === 'TRENDING_BEAR') return 'BEARISH';
    return 'NEUTRAL';
  }

  /**
   * Get current ATR value for position sizing
   */
  public getATR(symbol: string): number {
    return this.atrValues.get(symbol) || 0;
  }

  /**
   * Get EMA slope for momentum confirmation
   */
  public getEMASlope(symbol: string): number {
    return this.emaSlopes.get(symbol) || 0;
  }

  /**
   * Check if market is ranging (good for mean reversion)
   */
  public isRanging(symbol: string): boolean {
    const regime = this.currentRegime.get(symbol);
    return regime === 'RANGING';
  }

  /**
   * Check if market is trending (good for momentum)
   */
  public isTrending(symbol: string): boolean {
    const regime = this.currentRegime.get(symbol);
    return regime === 'TRENDING_BULL' || regime === 'TRENDING_BEAR';
  }
}
