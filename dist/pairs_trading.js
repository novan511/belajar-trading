/**
 * Pairs Trading / Statistical Arbitrage Module
 *
 * Identifies correlated cryptocurrency pairs and trades
 * when their price spread deviates from the historical mean.
 *
 * Features:
 * - Dynamic correlation tracking
 * - Z-score based entry/exit signals
 * - Hedge ratio calculation via rolling regression
 * - Beta-neutral position sizing
 */
import { CONFIG } from './config.js';
export class PairsTrader {
    pairs = new Map();
    cooldownPeriodMs = 300000; // 5 min cooldown between signals
    constructor() {
        // Initialize trackable pairs from config
        for (const [symA, symB] of CONFIG.TRADABLE_PAIRS) {
            const key = this.getPairKey(symA, symB);
            this.pairs.set(key, {
                symbolA: symA,
                symbolB: symB,
                priceHistoryA: [],
                priceHistoryB: [],
                spreadValues: [],
                correlation: 0,
                hedgeRatio: 1,
                spreadMean: 0,
                spreadStd: 1,
                lastSignalTime: 0
            });
        }
    }
    getPairKey(a, b) {
        return [a, b].sort().join('-');
    }
    /**
     * Update price data for a symbol
     */
    updatePrice(symbol, midPrice) {
        for (const [, state] of this.pairs) {
            if (state.symbolA === symbol) {
                state.priceHistoryA.push(midPrice);
                if (state.priceHistoryA.length > CONFIG.PAIRS_LOOKBACK_PERIODS) {
                    state.priceHistoryA.shift();
                }
                this.updateSpread(state);
            }
            else if (state.symbolB === symbol) {
                state.priceHistoryB.push(midPrice);
                if (state.priceHistoryB.length > CONFIG.PAIRS_LOOKBACK_PERIODS) {
                    state.priceHistoryB.shift();
                }
                this.updateSpread(state);
            }
        }
    }
    /**
     * Update spread, correlation, and hedge ratio for a pair
     */
    updateSpread(state) {
        const { priceHistoryA, priceHistoryB } = state;
        if (priceHistoryA.length < 20 || priceHistoryB.length < 20)
            return;
        // Ensure same length
        const len = Math.min(priceHistoryA.length, priceHistoryB.length);
        const pa = priceHistoryA.slice(-len);
        const pb = priceHistoryB.slice(-len);
        // Calculate hedge ratio using simple regression (priceB = hedgeRatio * priceA)
        const meanA = pa.reduce((a, b) => a + b, 0) / pa.length;
        const meanB = pb.reduce((a, b) => a + b, 0) / pb.length;
        let num = 0;
        let den = 0;
        for (let i = 0; i < len; i++) {
            num += (pa[i] - meanA) * (pb[i] - meanB);
            den += Math.pow(pa[i] - meanA, 2);
        }
        const hedgeRatio = den > 0 ? num / den : 1;
        state.hedgeRatio = Math.max(0.1, Math.min(10, hedgeRatio));
        // Calculate spread: spread = priceB - hedgeRatio * priceA
        const spread = pb[pb.length - 1] - hedgeRatio * pa[pa.length - 1];
        state.spreadValues.push(spread);
        if (state.spreadValues.length > CONFIG.PAIRS_LOOKBACK_PERIODS) {
            state.spreadValues.shift();
        }
        // Calculate spread statistics
        if (state.spreadValues.length >= 20) {
            const spMean = state.spreadValues.reduce((a, b) => a + b, 0) / state.spreadValues.length;
            const spVar = state.spreadValues.reduce((acc, val) => acc + Math.pow(val - spMean, 2), 0) / state.spreadValues.length;
            state.spreadMean = spMean;
            state.spreadStd = Math.sqrt(spVar);
            // Calculate correlation
            const stdA = Math.sqrt(pa.reduce((acc, val) => acc + Math.pow(val - meanA, 2), 0) / pa.length);
            const stdB = Math.sqrt(pb.reduce((acc, val) => acc + Math.pow(val - meanB, 2), 0) / pb.length);
            if (stdA > 0 && stdB > 0) {
                state.correlation = num / (len * stdA * stdB);
            }
        }
    }
    /**
     * Check for pairs trading signals
     */
    checkSignal(symbolA, symbolB) {
        const key = this.getPairKey(symbolA, symbolB);
        const state = this.pairs.get(key);
        if (!state)
            return null;
        // Cooldown check
        if (Date.now() - state.lastSignalTime < this.cooldownPeriodMs)
            return null;
        // Need enough data
        if (state.spreadValues.length < 20 || state.spreadStd <= 0)
            return null;
        // Calculate current z-score
        const currentSpread = state.spreadValues[state.spreadValues.length - 1];
        const zScore = (currentSpread - state.spreadMean) / state.spreadStd;
        // Entry conditions
        if (Math.abs(zScore) > CONFIG.PAIRS_ZSCORE_ENTRY) {
            state.lastSignalTime = Date.now();
            // If z-score > entry threshold: spread is too wide
            // Positive z-score: symbolB is overvalued relative to symbolA -> short B, long A
            // Negative z-score: symbolB is undervalued relative to symbolA -> long B, short A
            const longSymbol = zScore < 0 ? state.symbolB : state.symbolA;
            const shortSymbol = zScore < 0 ? state.symbolA : state.symbolB;
            return {
                longSymbol,
                shortSymbol,
                zScore: parseFloat(zScore.toFixed(2)),
                reason: `Spread Z-score ${zScore.toFixed(2)} > ${CONFIG.PAIRS_ZSCORE_ENTRY}. ${longSymbol} undervalued vs ${shortSymbol}. Correlation: ${(state.correlation * 100).toFixed(1)}%`
            };
        }
        return null;
    }
    /**
     * Check if spread has reverted enough to close
     */
    shouldClose(symbolA, symbolB) {
        const key = this.getPairKey(symbolA, symbolB);
        const state = this.pairs.get(key);
        if (!state || state.spreadValues.length < 10)
            return false;
        const currentSpread = state.spreadValues[state.spreadValues.length - 1];
        const zScore = state.spreadStd > 0
            ? Math.abs((currentSpread - state.spreadMean) / state.spreadStd)
            : 0;
        return zScore < CONFIG.PAIRS_ZSCORE_EXIT;
    }
    /**
     * Get current spread status for a pair
     */
    getSpreadInfo(symbolA, symbolB) {
        const key = this.getPairKey(symbolA, symbolB);
        const state = this.pairs.get(key);
        if (!state)
            return null;
        const currentSpread = state.spreadValues.length > 0
            ? state.spreadValues[state.spreadValues.length - 1]
            : 0;
        const zScore = state.spreadStd > 0
            ? (currentSpread - state.spreadMean) / state.spreadStd
            : 0;
        return {
            symbolA: state.symbolA,
            symbolB: state.symbolB,
            correlation: parseFloat((state.correlation * 100).toFixed(1)),
            hedgeRatio: parseFloat(state.hedgeRatio.toFixed(4)),
            currentZScore: parseFloat(zScore.toFixed(2)),
            spreadMean: parseFloat(state.spreadMean.toFixed(4)),
            spreadStd: parseFloat(state.spreadStd.toFixed(4))
        };
    }
}
