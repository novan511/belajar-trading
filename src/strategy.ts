import { CONFIG } from './config.js';
import { OrderBook, Side, TradeSignal } from './types.js';

interface SymbolState {
  symbol: string;
  midPriceHistory: number[];
  fastEma: number | null;
  lastTickTime: number;
  lastHistoryTime: number; // Decoupled: tracks when history window was updated
  obiThreshold: number;
  zScoreThreshold: number;
  takeProfitPct: number;
  stopLossPct: number;
}

export class StrategyManager {
  private states: Map<string, SymbolState> = new Map();
  private aiBiases: Record<string, 'BULLISH' | 'BEARISH' | 'NEUTRAL'> = {};
  private macroTrends: Record<string, 'BULLISH' | 'BEARISH' | 'NEUTRAL'> = {};

  public setAiBiases(biases: Record<string, any>) {
    this.aiBiases = {};
    for (const [symbol, info] of Object.entries(biases)) {
      if (info && (info as any).bias) {
        this.aiBiases[symbol] = (info as any).bias;
      }
    }
  }

  public setMacroTrends(trends: Record<string, 'BULLISH' | 'BEARISH' | 'NEUTRAL'>) {
    this.macroTrends = trends;
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

  public updateParams(symbol: string, params: { obiThreshold: number; zScoreThreshold: number; takeProfitPct: number; stopLossPct: number }) {
    const state = this.states.get(symbol);
    if (state) {
      state.obiThreshold = params.obiThreshold;
      state.zScoreThreshold = params.zScoreThreshold;
      state.takeProfitPct = params.takeProfitPct;
      state.stopLossPct = params.stopLossPct;
    }
  }

  public getParams(symbol: string) {
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

  public getAllParams(): Record<string, any> {
    const snapshot: Record<string, any> = {};
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
   * Process a new OrderBook tick and check for high-probability HFT signals.
   * Runs at a high-speed sub-second tick-level (50ms gate).
   */
  public processTick(book: OrderBook): TradeSignal | null {
    const state = this.states.get(book.symbol);
    if (!state) return null;

    const now = Date.now();
    // High-frequency HFT micro-throttle of 30ms to prevent double fills on the same millisecond packet
    if (now - state.lastTickTime < 30) {
      return null;
    }
    state.lastTickTime = now;

    // Check if the order book is valid and has bids/asks
    if (book.bids.length === 0 || book.asks.length === 0) {
      return null;
    }

    const bestBid = book.bids[0];
    const bestAsk = book.asks[0];

    const pBid = bestBid[0];
    const vBid = bestBid[1];
    const pAsk = bestAsk[0];
    const vAsk = bestAsk[1];

    // 1. Calculate standard Mid Price
    const midPrice = (pBid + pAsk) / 2;

    // 2. Calculate Micro-Price (weights price by opposite volumes)
    // P_micro = (P_bid * V_ask + P_ask * V_bid) / (V_bid + V_ask)
    const totalVolume = vBid + vAsk;
    if (totalVolume === 0) return null;
    const microPrice = (pBid * vAsk + pAsk * vBid) / totalVolume;

    // 3. Calculate Order Book Imbalance (OBI)
    // OBI = (V_bid - V_ask) / (V_bid + V_ask)
    const obi = (vBid - vAsk) / totalVolume;

    // 4 & 5. Decoupled Baseline: Update Mid-Price History & fast EMA once every 1000ms
    if (now - state.lastHistoryTime >= 1000 || state.midPriceHistory.length === 0) {
      state.midPriceHistory.push(midPrice);
      if (state.midPriceHistory.length > CONFIG.ROLLING_WINDOW_SIZE) {
        state.midPriceHistory.shift(); // Keep rolling window size
      }

      const emaPeriod = CONFIG.EMA_FAST_PERIOD;
      const k = 2 / (emaPeriod + 1);
      if (state.fastEma === null) {
        state.fastEma = midPrice;
      } else {
        state.fastEma = midPrice * k + state.fastEma * (1 - k);
      }

      state.lastHistoryTime = now;
    }

    // We need a full history window to compute reliable Z-Scores
    if (state.midPriceHistory.length < CONFIG.ROLLING_WINDOW_SIZE || state.fastEma === null) {
      return null;
    }

    // 6. Calculate Mean and Standard Deviation of the sliding window
    const sum = state.midPriceHistory.reduce((a, b) => a + b, 0);
    const mean = sum / state.midPriceHistory.length;
    
    const variance = state.midPriceHistory.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / state.midPriceHistory.length;
    const stdDev = Math.sqrt(variance);

    // Calculate Z-Score
    const zScore = stdDev > 0 ? (midPrice - mean) / stdDev : 0;

    // Get specific configuration for this symbol
    const symbolConfig = Object.values(CONFIG.SYMBOLS).find(s => s.name === book.symbol);
    if (!symbolConfig) return null;

    // Output debug indicators
    if (CONFIG.LOG_LEVEL === 'debug') {
      console.log(`[DEBUG] ${book.symbol} | Mid: ${midPrice.toFixed(2)} | Micro: ${microPrice.toFixed(2)} | OBI: ${obi.toFixed(2)} | Z: ${zScore.toFixed(2)} | EMA: ${state.fastEma.toFixed(2)}`);
    }

    // 7. Check Strategy Entry Rules
    // Long entry conditions (Buy)
    const hasLongImbalance = obi > state.obiThreshold;
    const hasLongMicroPriceDivergence = microPrice > midPrice + (symbolConfig.tickSize * 0.1);
    const isOversold = zScore < -state.zScoreThreshold;
    const hasUpwardMomentum = midPrice > state.fastEma;

    // Check AI Bias Lock Trend Safeguard
    const activeBias = this.aiBiases[book.symbol] || 'NEUTRAL';
    const isBuyAllowedByAI = activeBias === 'NEUTRAL' || activeBias === 'BULLISH';

    if (hasLongImbalance && hasLongMicroPriceDivergence && isOversold && hasUpwardMomentum && isBuyAllowedByAI) {
      const confidence: 'HIGH' | 'LOW' = (Math.abs(obi) > state.obiThreshold * 1.5 && Math.abs(zScore) > state.zScoreThreshold * 1.5) ? 'HIGH' : 'LOW';
      // BTC Kill‑Switch check
      if (this.macroTrends['BTC'] === 'BEARISH') {
        // Abort BUY signal during BTC bearish trend
        return null;
      }
      const reason = `OBI(${obi.toFixed(2)}) > ${state.obiThreshold.toFixed(2)} & Z(${zScore.toFixed(2)}) < -${state.zScoreThreshold.toFixed(2)} & MicroPrice(${microPrice.toFixed(2)}) > Mid(${midPrice.toFixed(2)})`;
      return {
        symbol: book.symbol,
        side: 'BUY',
        price: pAsk,
        reason,
        confidence
      };
    }

    // Short entry conditions (Sell)
    const hasShortImbalance = obi < -state.obiThreshold;
    const hasShortMicroPriceDivergence = microPrice < midPrice - (symbolConfig.tickSize * 0.1);
    const isOverbought = zScore > state.zScoreThreshold;
    const hasDownwardMomentum = midPrice < state.fastEma;

    const isSellAllowedByAI = activeBias === 'NEUTRAL' || activeBias === 'BEARISH';

    if (hasShortImbalance && hasShortMicroPriceDivergence && isOverbought && hasDownwardMomentum && isSellAllowedByAI) {
      const confidence: 'HIGH' | 'LOW' = (Math.abs(obi) > state.obiThreshold * 1.5 && Math.abs(zScore) > state.zScoreThreshold * 1.5) ? 'HIGH' : 'LOW';
      // BTC Kill‑Switch check
      if (this.macroTrends['BTC'] === 'BULLISH') {
        // Abort SELL signal during BTC bullish trend
        return null;
      }
      const reason = `OBI(${obi.toFixed(2)}) < -${state.obiThreshold.toFixed(2)} & Z(${zScore.toFixed(2)}) > ${state.zScoreThreshold.toFixed(2)} & MicroPrice(${microPrice.toFixed(2)}) < Mid(${midPrice.toFixed(2)})`;
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
