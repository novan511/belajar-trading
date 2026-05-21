import { CONFIG } from './config.js';
export class StrategyManager {
    states = new Map();
    aiBiases = {};
    macroTrends = {};
    indicatorsCache = {};
    setAiBiases(biases) {
        this.aiBiases = {};
        for (const [symbol, info] of Object.entries(biases)) {
            if (info && info.bias) {
                this.aiBiases[symbol] = info.bias;
            }
        }
    }
    setMacroTrends(trends) {
        this.macroTrends = trends;
    }
    /**
     * Caches premium technical indicators fetched from candle multi-timeframe analysis
     */
    setCalculatedIndicators(symbol, indicators) {
        this.indicatorsCache[symbol] = indicators;
    }
    constructor() {
        // Initialize states for configured symbols
        for (const [key, symbolConfig] of Object.entries(CONFIG.SYMBOLS)) {
            this.states.set(symbolConfig.name, {
                symbol: symbolConfig.name,
                midPriceHistory: [],
                fastEma: null,
                lastTickTime: 0,
                lastHistoryTime: 0,
                obiThreshold: symbolConfig.obiThreshold,
                zScoreThreshold: symbolConfig.zScoreThreshold,
                takeProfitPct: symbolConfig.takeProfitPct,
                stopLossPct: symbolConfig.stopLossPct
            });
        }
    }
    updateParams(symbol, params) {
        const state = this.states.get(symbol);
        if (state) {
            state.obiThreshold = params.obiThreshold;
            state.zScoreThreshold = params.zScoreThreshold;
            // Enforce strict Risk-to-Reward Ratio (1:2 to 1:4)
            // SL must be between 0.25x and 0.50x of TP
            const minSl = params.takeProfitPct * 0.25;
            const maxSl = params.takeProfitPct * 0.50;
            const clampedSl = Math.max(minSl, Math.min(maxSl, params.stopLossPct));
            state.takeProfitPct = params.takeProfitPct;
            state.stopLossPct = clampedSl;
        }
    }
    getParams(symbol) {
        const state = this.states.get(symbol);
        if (state) {
            return {
                obiThreshold: state.obiThreshold,
                zScoreThreshold: state.zScoreThreshold,
                takeProfitPct: state.takeProfitPct,
                stopLossPct: state.stopLossPct
            };
        }
        return null;
    }
    getAllParams() {
        const snapshot = {};
        for (const [symbol, state] of this.states.entries()) {
            snapshot[symbol] = {
                obiThreshold: state.obiThreshold,
                zScoreThreshold: state.zScoreThreshold,
                takeProfitPct: state.takeProfitPct,
                stopLossPct: state.stopLossPct
            };
        }
        return snapshot;
    }
    /**
     * Process a new OrderBook tick and check for high-probability signals.
     * Leverages a premium hybrid model: candle quantitative levels act as confirmation zones,
     * while micro-imbalances (OBI & Z-score) trigger precise execution.
     */
    processTick(book) {
        const state = this.states.get(book.symbol);
        if (!state)
            return null;
        const now = Date.now();
        // Micro-throttle to prevent double fills
        if (now - state.lastTickTime < 30) {
            return null;
        }
        state.lastTickTime = now;
        if (book.bids.length === 0 || book.asks.length === 0) {
            return null;
        }
        const bestBid = book.bids[0];
        const bestAsk = book.asks[0];
        const pBid = bestBid[0];
        const vBid = bestBid[1];
        const pAsk = bestAsk[0];
        const vAsk = bestAsk[1];
        const midPrice = (pBid + pAsk) / 2;
        const totalVolume = vBid + vAsk;
        if (totalVolume === 0)
            return null;
        const microPrice = (pBid * vAsk + pAsk * vBid) / totalVolume;
        const obi = (vBid - vAsk) / totalVolume;
        // Decoupled Baseline: Update rolling window history & EMA
        if (now - state.lastHistoryTime >= 1000 || state.midPriceHistory.length === 0) {
            state.midPriceHistory.push(midPrice);
            if (state.midPriceHistory.length > CONFIG.ROLLING_WINDOW_SIZE) {
                state.midPriceHistory.shift();
            }
            const emaPeriod = CONFIG.EMA_FAST_PERIOD;
            const k = 2 / (emaPeriod + 1);
            if (state.fastEma === null) {
                state.fastEma = midPrice;
            }
            else {
                state.fastEma = midPrice * k + state.fastEma * (1 - k);
            }
            state.lastHistoryTime = now;
        }
        if (state.midPriceHistory.length < CONFIG.ROLLING_WINDOW_SIZE || state.fastEma === null) {
            return null;
        }
        const sum = state.midPriceHistory.reduce((a, b) => a + b, 0);
        const mean = sum / state.midPriceHistory.length;
        const variance = state.midPriceHistory.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / state.midPriceHistory.length;
        const stdDev = Math.sqrt(variance);
        const zScore = stdDev > 0 ? (midPrice - mean) / stdDev : 0;
        const symbolConfig = Object.values(CONFIG.SYMBOLS).find(s => s.name === book.symbol);
        if (!symbolConfig)
            return null;
        const activeBias = this.aiBiases[book.symbol] || 'NEUTRAL';
        // =========================================================================
        // HYBRID QUANTITATIVE CONFIRMATION: Evaluate Fibonacci, S/R, FVG, POC zones
        // =========================================================================
        const indicators = this.indicatorsCache[book.symbol];
        let isNearSupportLevel = false;
        let isNearResistanceLevel = false;
        let techReason = '';
        if (indicators) {
            const price = midPrice;
            // A. Check Fibonacci Retracement Support/Resistance
            if (indicators.fibonacci) {
                const fib = indicators.fibonacci;
                // Bullish pullback retracements (0.500, 0.618, 0.786)
                const fibSupports = [fib.level500, fib.level618, fib.level786];
                for (const level of fibSupports) {
                    const diffPct = Math.abs(price - level) / level;
                    if (diffPct <= 0.010) { // within 1.0% buffer
                        isNearSupportLevel = true;
                        techReason += `FibSupport(${(diffPct * 100).toFixed(1)}%) `;
                        break;
                    }
                }
                // Bearish rally retracements (0.236, 0.382, 0.500, 0.618)
                const fibResists = [fib.level236, fib.level382, fib.level500, fib.level618];
                for (const level of fibResists) {
                    const diffPct = Math.abs(price - level) / level;
                    if (diffPct <= 0.010) {
                        isNearResistanceLevel = true;
                        techReason += `FibResistance(${(diffPct * 100).toFixed(1)}%) `;
                        break;
                    }
                }
            }
            // B. Check Swing Support & Resistance Lines
            if (indicators.srLevels && indicators.srLevels.length > 0) {
                for (const sr of indicators.srLevels) {
                    const diffPct = Math.abs(price - sr.price) / sr.price;
                    if (diffPct <= 0.012) { // within 1.2% buffer
                        if (sr.type === 'SUPPORT') {
                            isNearSupportLevel = true;
                            techReason += `SwingSupport(${sr.strength}) `;
                        }
                        else if (sr.type === 'RESISTANCE') {
                            isNearResistanceLevel = true;
                            techReason += `SwingResistance(${sr.strength}) `;
                        }
                    }
                }
            }
            // C. Check Fair Value Gaps (FVG) zones
            if (indicators.fvgs && indicators.fvgs.length > 0) {
                const unfilledFvgs = indicators.fvgs.filter(f => !f.isFilled);
                for (const fvg of unfilledFvgs) {
                    if (fvg.type === 'BULLISH' && price <= fvg.top && price >= fvg.bottom) {
                        isNearSupportLevel = true;
                        techReason += `BullishFVG `;
                        break;
                    }
                    else if (fvg.type === 'BEARISH' && price >= fvg.top && price <= fvg.bottom) {
                        isNearResistanceLevel = true;
                        techReason += `BearishFVG `;
                        break;
                    }
                }
            }
            // D. Check Point of Control (POC) Volume Magnet
            if (indicators.poc) {
                const diffPct = Math.abs(price - indicators.poc) / indicators.poc;
                if (diffPct <= 0.008) { // within 0.8%
                    if (activeBias === 'BULLISH') {
                        isNearSupportLevel = true;
                    }
                    else if (activeBias === 'BEARISH') {
                        isNearResistanceLevel = true;
                    }
                    techReason += `POCMagnet `;
                }
            }
        }
        else {
            // Fallback: If cache not ready yet, allow entry based on pure tick conditions
            isNearSupportLevel = true;
            isNearResistanceLevel = true;
            techReason = 'OBI+Z-Score Fallback ';
        }
        // =========================================================================
        // EXECUTION TRIGGERS: Tick Imbalance & Momentum
        // =========================================================================
        // LONG Entry Conditions (Buy)
        const isBuyAllowedByAI = activeBias === 'NEUTRAL' || activeBias === 'BULLISH';
        const hasLongImbalance = obi > state.obiThreshold;
        const hasLongMicroPriceDivergence = microPrice > midPrice + (symbolConfig.tickSize * 0.1);
        const isOversold = zScore < -state.zScoreThreshold;
        const hasUpwardMomentum = midPrice > state.fastEma;
        if (isBuyAllowedByAI && isNearSupportLevel && hasLongImbalance && hasLongMicroPriceDivergence && isOversold && hasUpwardMomentum) {
            if (this.macroTrends['BTC'] === 'BEARISH') {
                return null; // Kill-switch: abort buying if BTC macro trend is bearish
            }
            const confidence = (Math.abs(obi) > state.obiThreshold * 1.5 && Math.abs(zScore) > state.zScoreThreshold * 1.5) ? 'HIGH' : 'LOW';
            const reason = `${techReason.trim()} | OBI(${obi.toFixed(2)}) > ${state.obiThreshold.toFixed(2)} & Z(${zScore.toFixed(2)}) < -${state.zScoreThreshold.toFixed(2)}`;
            return {
                symbol: book.symbol,
                side: 'BUY',
                price: pAsk,
                reason,
                confidence
            };
        }
        // SHORT Entry Conditions (Sell)
        const isSellAllowedByAI = activeBias === 'NEUTRAL' || activeBias === 'BEARISH';
        const hasShortImbalance = obi < -state.obiThreshold;
        const hasShortMicroPriceDivergence = microPrice < midPrice - (symbolConfig.tickSize * 0.1);
        const isOverbought = zScore > state.zScoreThreshold;
        const hasDownwardMomentum = midPrice < state.fastEma;
        if (isSellAllowedByAI && isNearResistanceLevel && hasShortImbalance && hasShortMicroPriceDivergence && isOverbought && hasDownwardMomentum) {
            if (this.macroTrends['BTC'] === 'BULLISH') {
                return null; // Kill-switch: abort selling if BTC macro trend is bullish
            }
            const confidence = (Math.abs(obi) > state.obiThreshold * 1.5 && Math.abs(zScore) > state.zScoreThreshold * 1.5) ? 'HIGH' : 'LOW';
            const reason = `${techReason.trim()} | OBI(${obi.toFixed(2)}) < -${state.obiThreshold.toFixed(2)} & Z(${zScore.toFixed(2)}) > ${state.zScoreThreshold.toFixed(2)}`;
            return {
                symbol: book.symbol,
                side: 'SELL',
                price: pBid,
                reason,
                confidence
            };
        }
        return null;
    }
}
