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
export class MarketRegimeDetector {
    // EMA slopes for trend detection per symbol
    emaValues = new Map();
    emaSlopes = new Map();
    atrValues = new Map();
    priceHistory = new Map();
    // Regime cache
    currentRegime = new Map();
    constructor() { }
    /**
     * Process a mid-price tick to update regime indicators
     */
    processPrice(symbol, midPrice) {
        // 1. Update price history
        if (!this.priceHistory.has(symbol)) {
            this.priceHistory.set(symbol, []);
        }
        const prices = this.priceHistory.get(symbol);
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
        }
        else {
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
    detectRegime(symbol) {
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
            if (ema && p > ema)
                aboveCount++;
            else if (ema && p < ema)
                belowCount++;
        }
        const trendStrength = Math.abs(aboveCount - belowCount) / recentPrices.length;
        const isStrongTrend = trendStrength >= CONFIG.REGIME_TREND_STRENGTH_THRESHOLD;
        // 3. Determine regime
        let regime;
        if (isStrongTrend && slope) {
            if (slope > 0 && aboveCount > belowCount) {
                regime = isHighVol ? 'HIGH_VOLATILITY' : 'TRENDING_BULL';
            }
            else if (slope < 0 && belowCount > aboveCount) {
                regime = isHighVol ? 'HIGH_VOLATILITY' : 'TRENDING_BEAR';
            }
            else {
                regime = isHighVol ? 'HIGH_VOLATILITY' : 'RANGING';
            }
        }
        else {
            if (isHighVol)
                regime = 'HIGH_VOLATILITY';
            else if (isLowVol)
                regime = 'LOW_VOLATILITY';
            else
                regime = 'RANGING';
        }
        this.currentRegime.set(symbol, regime);
        return regime;
    }
    /**
     * Get trend direction
     */
    getTrendDirection(symbol) {
        const regime = this.currentRegime.get(symbol);
        if (regime === 'TRENDING_BULL')
            return 'BULLISH';
        if (regime === 'TRENDING_BEAR')
            return 'BEARISH';
        return 'NEUTRAL';
    }
    /**
     * Get current ATR value for position sizing
     */
    getATR(symbol) {
        return this.atrValues.get(symbol) || 0;
    }
    /**
     * Get EMA slope for momentum confirmation
     */
    getEMASlope(symbol) {
        return this.emaSlopes.get(symbol) || 0;
    }
    /**
     * Check if market is ranging (good for mean reversion)
     */
    isRanging(symbol) {
        const regime = this.currentRegime.get(symbol);
        return regime === 'RANGING';
    }
    /**
     * Check if market is trending (good for momentum)
     */
    isTrending(symbol) {
        const regime = this.currentRegime.get(symbol);
        return regime === 'TRENDING_BULL' || regime === 'TRENDING_BEAR';
    }
}
