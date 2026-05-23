/**
 * Market Microstructure Analysis Module
 *
 * Features:
 * - Order Book Imbalance Trend (OBI momentum)
 * - Order Flow Imbalance (OFI) - tick-level directional pressure
 * - Cumulative Volume Delta (CVD) Divergence Detection
 * - Liquidity Sweep Detection (stop hunts)
 * - VWAP Calculation
 * - Volume Profile (VAH/VAL)
 */
import { CONFIG } from './config.js';
export class MarketMicrostructure {
    // OBI History for trend detection
    obiHistory = new Map();
    // Tick-level trade flow tracking
    bidVolumes = new Map();
    askVolumes = new Map();
    // CVD tracking
    cvdValues = new Map();
    cvdHistory = new Map();
    lastMidPrices = new Map();
    // Liquidity sweep detection
    priceHistory = new Map();
    // VWACalculation
    vwapCumulativePrice = new Map();
    vwapCumulativeVolume = new Map();
    vwapData = new Map();
    constructor() { }
    /**
     * Process a single order book tick and update all microstructure metrics
     */
    processTick(book) {
        const symbol = book.symbol;
        const bestBid = book.bids[0];
        const bestAsk = book.asks[0];
        const bidVol = bestBid[1];
        const askVol = bestAsk[1];
        const bidPx = bestBid[0];
        const askPx = bestAsk[0];
        const midPrice = (bidPx + askPx) / 2;
        const totalVol = bidVol + askVol;
        const obi = totalVol > 0 ? (bidVol - askVol) / totalVol : 0;
        // 1. Track OBI History
        if (!this.obiHistory.has(symbol)) {
            this.obiHistory.set(symbol, []);
        }
        const obiHist = this.obiHistory.get(symbol);
        obiHist.push(obi);
        if (obiHist.length > CONFIG.OFI_WINDOW_TICKS) {
            obiHist.shift();
        }
        // 2. Track order flow volumes
        if (!this.bidVolumes.has(symbol)) {
            this.bidVolumes.set(symbol, []);
            this.askVolumes.set(symbol, []);
        }
        const bidVols = this.bidVolumes.get(symbol);
        const askVols = this.askVolumes.get(symbol);
        bidVols.push(bidVol);
        askVols.push(askVol);
        if (bidVols.length > CONFIG.OFI_WINDOW_TICKS) {
            bidVols.shift();
            askVols.shift();
        }
        // 3. CVD: Cumulative Volume Delta
        // Positive = aggressive buying, Negative = aggressive selling
        const delta = bidVol - askVol;
        const currentCvd = (this.cvdValues.get(symbol) || 0) + delta;
        this.cvdValues.set(symbol, currentCvd);
        if (!this.cvdHistory.has(symbol)) {
            this.cvdHistory.set(symbol, []);
        }
        const cvdHist = this.cvdHistory.get(symbol);
        cvdHist.push(currentCvd);
        if (cvdHist.length > CONFIG.CVD_WINDOW_TICKS) {
            cvdHist.shift();
        }
        // Track prices for CVD divergence
        if (!this.lastMidPrices.has(symbol)) {
            this.lastMidPrices.set(symbol, []);
        }
        const priceHist = this.lastMidPrices.get(symbol);
        priceHist.push(midPrice);
        if (priceHist.length > CONFIG.CVD_WINDOW_TICKS) {
            priceHist.shift();
        }
        // 4. Price history for liquidity sweep detection
        if (!this.priceHistory.has(symbol)) {
            this.priceHistory.set(symbol, []);
        }
        const pxHist = this.priceHistory.get(symbol);
        pxHist.push({ high: askPx, low: bidPx });
        if (pxHist.length > CONFIG.LIQUIDITY_SWEEP_WINDOW_TICKS) {
            pxHist.shift();
        }
        // 5. VWAP update
        const vwapVolume = bidVol + askVol;
        const vwapPrice = midPrice;
        const cumPrice = (this.vwapCumulativePrice.get(symbol) || 0) + (vwapPrice * vwapVolume);
        const cumVol = (this.vwapCumulativeVolume.get(symbol) || 0) + vwapVolume;
        this.vwapCumulativePrice.set(symbol, cumPrice);
        this.vwapCumulativeVolume.set(symbol, cumVol);
        if (cumVol > 0) {
            const vwap = cumPrice / cumVol;
            // Calculate standard deviation of price from VWAP for bands
            const sqDiff = Math.pow(midPrice - vwap, 2) * vwapVolume;
            // Simplified bands: VWAP ± 1% (configurable)
            this.vwapData.set(symbol, {
                price: vwap,
                upperBand: vwap * 1.01,
                lowerBand: vwap * 0.99
            });
        }
    }
    /**
     * Detect OBI Trend - is buying/selling pressure increasing or decreasing?
     * Returns trend direction based on OBI momentum
     */
    getOBITrend(symbol) {
        const hist = this.obiHistory.get(symbol);
        if (!hist || hist.length < 5)
            return 'NEUTRAL';
        // Compare recent vs older OBI values
        const recent = hist.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const older = hist.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
        if (recent > older + 0.05)
            return 'ACCUMULATING';
        if (recent < older - 0.05)
            return 'DISTRIBUTING';
        return 'NEUTRAL';
    }
    /**
     * Get Order Flow Imbalance (OFI) as a momentum indicator
     * Positive = buying pressure, Negative = selling pressure
     */
    getOFI(symbol) {
        const bidVols = this.bidVolumes.get(symbol);
        const askVols = this.askVolumes.get(symbol);
        if (!bidVols || !askVols || bidVols.length < 3)
            return 0;
        const avgBid = bidVols.reduce((a, b) => a + b, 0) / bidVols.length;
        const avgAsk = askVols.reduce((a, b) => a + b, 0) / askVols.length;
        const total = avgBid + avgAsk;
        return total > 0 ? (avgBid - avgAsk) / total : 0;
    }
    /**
     * Check for CVD Divergence
     * Bullish divergence: Price making lower lows, CVD making higher lows
     * Bearish divergence: Price making higher highs, CVD making lower highs
     */
    checkCVDDivergence(symbol) {
        const cvdHist = this.cvdHistory.get(symbol);
        const priceHist = this.lastMidPrices.get(symbol);
        if (!cvdHist || !priceHist || cvdHist.length < 10)
            return null;
        // Split into two halves
        const half = Math.floor(cvdHist.length / 2);
        const firstHalfCVD = cvdHist.slice(0, half);
        const secondHalfCVD = cvdHist.slice(half);
        const firstHalfPrice = priceHist.slice(0, half);
        const secondHalfPrice = priceHist.slice(half);
        const cvdFirstAvg = firstHalfCVD.reduce((a, b) => a + b, 0) / firstHalfCVD.length;
        const cvdSecondAvg = secondHalfCVD.reduce((a, b) => a + b, 0) / secondHalfCVD.length;
        const priceFirstAvg = firstHalfPrice.reduce((a, b) => a + b, 0) / firstHalfPrice.length;
        const priceSecondAvg = secondHalfPrice.reduce((a, b) => a + b, 0) / secondHalfPrice.length;
        // Bullish divergence: price down, CVD up
        if (priceSecondAvg < priceFirstAvg * 0.998 && cvdSecondAvg > cvdFirstAvg * 1.001) {
            return 'BULLISH';
        }
        // Bearish divergence: price up, CVD down
        if (priceSecondAvg > priceFirstAvg * 1.002 && cvdSecondAvg < cvdFirstAvg * 0.999) {
            return 'BEARISH';
        }
        return null;
    }
    /**
     * Liquidity Sweep Detection
     * Detects when price briefly moves beyond a recent extreme (taking out stops)
     * then reverses - classic market maker / smart money manipulation
     */
    detectLiquiditySweep(symbol, bestBid, bestAsk) {
        const pxHist = this.priceHistory.get(symbol);
        if (!pxHist || pxHist.length < 10)
            return null;
        const midPrice = (bestBid + bestAsk) / 2;
        // Find recent extremes (lookback window)
        const lookback = Math.min(pxHist.length, CONFIG.LIQUIDITY_SWEEP_WINDOW_TICKS);
        const recentPx = pxHist.slice(-lookback, -1); // Exclude current tick
        const recentHigh = Math.max(...recentPx.map(p => p.high));
        const recentLow = Math.min(...recentPx.map(p => p.low));
        const currentHigh = bestAsk;
        const currentLow = bestBid;
        // Bullish sweep: price dipped below recent low, now back above (fake breakdown)
        if (currentLow <= recentLow && midPrice > recentLow) {
            return {
                symbol,
                side: 'BUY',
                price: bestAsk,
                reason: `Bullish Liquidity Sweep: Low ${currentLow} took out recent low ${recentLow}, now bouncing`
            };
        }
        // Bearish sweep: price spiked above recent high, now back below (fake breakout)
        if (currentHigh >= recentHigh && midPrice < recentHigh) {
            return {
                symbol,
                side: 'SELL',
                price: bestBid,
                reason: `Bearish Liquidity Sweep: High ${currentHigh} took out recent high ${recentHigh}, now reversing`
            };
        }
        return null;
    }
    /**
     * Get VWAP and distance from VWAP
     */
    getVWAP(symbol) {
        return this.vwapData.get(symbol) || null;
    }
    /**
     * Calculate Volume Profile (simplified)
     * Returns VAH (Value Area High) and VAL (Value Area Low)
     */
    getVolumeProfile(symbol) {
        const bidVols = this.bidVolumes.get(symbol);
        const askVols = this.askVolumes.get(symbol);
        if (!bidVols || !askVols || bidVols.length < 10)
            return null;
        // Use OBI to determine where volume is concentrated
        const obis = this.obiHistory.get(symbol) || [];
        if (obis.length < 10)
            return null;
        const avgObi = obis.slice(-10).reduce((a, b) => a + b, 0) / 10;
        // Simplified: POC at current price adjusted by OBI
        const priceHist = this.lastMidPrices.get(symbol);
        const currentPrice = priceHist ? priceHist[priceHist.length - 1] : 0;
        // VAH = POC * (1 + spread), VAL = POC * (1 - spread)
        // Spread based on volume volatility
        const volBids = bidVols.slice(-10);
        const volAsks = askVols.slice(-10);
        const avgVol = [...volBids, ...volAsks].reduce((a, b) => a + b, 0) / 20;
        const volStd = Math.sqrt([...volBids, ...volAsks].map(v => Math.pow(v - avgVol, 2)).reduce((a, b) => a + b, 0) / 20);
        const spread = Math.min(0.02, volStd / (avgVol || 1) * 0.01);
        return {
            poc: currentPrice,
            vah: currentPrice * (1 + spread),
            val: currentPrice * (1 - spread)
        };
    }
    /**
     * Get Order Flow State summary
     */
    getOrderFlowState(symbol) {
        const bidVols = this.bidVolumes.get(symbol) || [];
        const askVols = this.askVolumes.get(symbol) || [];
        return {
            bidVolume: bidVols.reduce((a, b) => a + b, 0),
            askVolume: askVols.reduce((a, b) => a + b, 0),
            totalTrades: Math.max(bidVols.length, askVols.length),
            cvd: this.cvdValues.get(symbol) || 0
        };
    }
}
