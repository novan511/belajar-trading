/**
 * Smart Order Routing — Slippage Protection & Optimal Execution
 * 
 * Masalah: Market order entry kena slippage gede pas high volatility.
 * 
 * Solusi:
 * - Iceberg order slicing (pecah order besar jadi kecil2)
 * - TWAP execution (spread order dari waktu ke waktu)
 * - Slippage check sebelum tiap slice
 * - Price improvement detection
 * - Adaptive slicing based on volume profile
 */

import { CONFIG } from './config.js';
import { OrderBook, Side, TradeRecord } from './types.js';

interface ExecutionSlice {
  qty: number;
  price: number;
  delayMs: number;
}

interface ExecutionPlan {
  slices: ExecutionSlice[];
  totalQty: number;
  expectedAvgPrice: number;
  estimatedSlippage: number;
  durationMs: number;
}

interface ExecutionResult {
  success: boolean;
  avgPrice: number;
  totalFilled: number;
  totalFees: number;
  slippagePct: number;
  slices: { price: number; qty: number; time: number }[];
  reason?: string;
}

export class SmartOrderRouter {
  private readonly MAX_SLIPPAGE_PCT = 0.002; // 0.2% max slippage per slice
  private readonly MIN_SLICE_SIZE_PCT = 0.1;  // Min 10% dari total order
  private readonly MAX_SLICE_SIZE_PCT = 0.5;  // Max 50% dari total order
  private readonly TWAP_SPREAD_MS = 1000;      // 1 detik antar slice
  private readonly PRICE_IMPROVEMENT_THRESHOLD = 0.0003; // 0.03% improvement = better price
  
  private lastOrderTimes: Map<string, number> = new Map();
  private marketMicro: any; // MarketMicrostructure reference

  constructor(marketMicro?: any) {
    this.marketMicro = marketMicro;
  }

  /**
   * Buat execution plan optimal berdasarkan kondisi order book
   * 
   * @param symbol - Trading pair
   * @param side - BUY or SELL
   * @param totalQty - Total quantity to execute
   * @param book - Current order book snapshot
   * @param urgency - 'IMMEDIATE' | 'NORMAL' | 'PASSIVE'
   */
  createExecutionPlan(
    symbol: string,
    side: Side,
    totalQty: number,
    book: OrderBook,
    urgency: 'IMMEDIATE' | 'NORMAL' | 'PASSIVE' = 'NORMAL'
  ): ExecutionPlan {
    const coinConfig = Object.values(CONFIG.SYMBOLS).find(s => s.name === symbol);
    if (!coinConfig) throw new Error(`Unknown symbol: ${symbol}`);

    const bestBid = book.bids[0][0];
    const bestAsk = book.asks[0][0];
    const midPrice = (bestBid + bestAsk) / 2;
    const spread = (bestAsk - bestBid) / midPrice;

    // Adaptive: lebih agresif kalo spread sempit, lebih pasif kalo spread lebar
    const isTightSpread = spread < 0.0005; // < 0.05% spread
    const isWideSpread = spread > 0.002; // > 0.2% spread

    // Tentukan jumlah slice
    let sliceCount: number;
    switch (urgency) {
      case 'IMMEDIATE':
        sliceCount = isTightSpread ? 2 : 3;
        break;
      case 'NORMAL':
        sliceCount = Math.max(2, Math.min(5, Math.ceil(totalQty / 0.1)));
        break;
      case 'PASSIVE':
        sliceCount = Math.max(3, Math.min(8, Math.ceil(totalQty / 0.05)));
        break;
    }

    // Adaptive delay
    let baseDelayMs: number;
    if (isWideSpread) {
      baseDelayMs = this.TWAP_SPREAD_MS * 2; // Lebih lambat di spread lebar
    } else if (isTightSpread) {
      baseDelayMs = this.TWAP_SPREAD_MS * 0.5; // Lebih cepat di spread sempit
    } else {
      baseDelayMs = this.TWAP_SPREAD_MS;
    }

    // Volume profile adaptive sizing
    const volumeAtBid = book.bids.reduce((sum, [, vol]) => sum + vol, 0);
    const volumeAtAsk = book.asks.reduce((sum, [, vol]) => sum + vol, 0);
    const marketDepth = side === 'BUY' ? volumeAtAsk : volumeAtBid;

    // Slice size proportional to market depth
    const maxSliceSize = marketDepth * 0.3; // Max 30% of available depth
    const sliceQty = Math.min(
      totalQty / sliceCount,
      maxSliceSize,
      coinConfig.lotSize * 100
    );

    const slices: ExecutionSlice[] = [];
    let remainingQty = totalQty;
    let totalSlippage = 0;

    for (let i = 0; i < sliceCount && remainingQty > 0; i++) {
      const qty = Math.min(remainingQty, sliceQty);
      
      // Price with adaptive offset
      let price: number;
      if (side === 'BUY') {
        // Buy: offset above best ask, decreasing with each slice
        const offset = bestAsk * (0.0003 * (1 - i / sliceCount)); // 0.03% → 0%
        price = bestAsk + offset;
      } else {
        // Sell: offset below best bid, decreasing with each slice
        const offset = bestBid * (0.0003 * (1 - i / sliceCount));
        price = bestBid - offset;
      }

      // Slippage estimation
      const refPrice = side === 'BUY' ? bestAsk : bestBid;
      const sliceSlippage = Math.abs(price - refPrice) / refPrice;
      totalSlippage += sliceSlippage;

      slices.push({
        qty,
        price,
        delayMs: i === 0 ? 0 : baseDelayMs * i
      });

      remainingQty -= qty;
    }

    // Jika masih ada sisa, tambahin ke slice terakhir
    if (remainingQty > 0 && slices.length > 0) {
      slices[slices.length - 1].qty += remainingQty;
    }

    const expectedAvgPrice = slices.reduce((sum, s) => sum + s.price * s.qty, 0) / totalQty;
    const estimatedSlippage = Math.abs(expectedAvgPrice - midPrice) / midPrice;

    return {
      slices,
      totalQty,
      expectedAvgPrice,
      estimatedSlippage,
      durationMs: slices.length > 0 ? slices[slices.length - 1].delayMs : 0
    };
  }

  /**
   * Eksekusi order dengan smart routing — slices terpecah dengan slippage check
   * 
   * @param symbol - Trading pair
   * @param side - BUY/SELL
   * @param totalQty - Total quantity
   * @param book - Current order book
   * @param executeFn - Function untuk execute individual slice
   * @param urgency - Execution urgency
   */
  async executePlannedOrder(
    symbol: string,
    side: Side,
    totalQty: number,
    book: OrderBook,
    executeFn: (qty: number, price: number) => Promise<{ success: boolean; price: number; fee: number }>,
    urgency: 'IMMEDIATE' | 'NORMAL' | 'PASSIVE' = 'NORMAL'
  ): Promise<ExecutionResult> {
    const coinConfig = Object.values(CONFIG.SYMBOLS).find(s => s.name === symbol);
    if (!coinConfig) throw new Error(`Unknown symbol: ${symbol}`);

    // Cooldown check — prevent order spam
    const lastOrderTime = this.lastOrderTimes.get(symbol) || 0;
    if (Date.now() - lastOrderTime < 100) {
      // Too fast, skip
      return { success: false, avgPrice: 0, totalFilled: 0, totalFees: 0, slippagePct: 0, slices: [], reason: 'COOLDOWN' };
    }
    this.lastOrderTimes.set(symbol, Date.now());

    // Create execution plan
    const plan = this.createExecutionPlan(symbol, side, totalQty, book, urgency);

    const filledSlices: { price: number; qty: number; time: number }[] = [];
    let totalFilled = 0;
    let totalValue = 0;
    let totalFees = 0;
    let maxSlippageHit = false;

    const refPrice = side === 'BUY' ? book.asks[0][0] : book.bids[0][0];

    for (const slice of plan.slices) {
      // Delay TWAP
      if (slice.delayMs > 0) {
        await this.sleep(slice.delayMs);
      }

      // Skip if max slippage already hit
      if (maxSlippageHit) break;

      // Check current price for slippage
      const currentRefPrice = side === 'BUY' ? book.asks[0][0] : book.bids[0][0];
      const currentSlippage = Math.abs(slice.price - currentRefPrice) / currentRefPrice;

      if (currentSlippage > this.MAX_SLIPPAGE_PCT) {
        console.log(`\x1b[33m[SOR] Slippage ${(currentSlippage * 100).toFixed(3)}% > max ${(this.MAX_SLIPPAGE_PCT * 100).toFixed(3)}%. Skipping slice.\x1b[0m`);
        maxSlippageHit = true;
        continue;
      }

      // Check for price improvement
      const hasPriceImprovement = side === 'BUY' 
        ? currentRefPrice < refPrice * (1 - this.PRICE_IMPROVEMENT_THRESHOLD)
        : currentRefPrice > refPrice * (1 + this.PRICE_IMPROVEMENT_THRESHOLD);

      // Execute slice
      const result = await executeFn(slice.qty, slice.price);
      
      if (result.success) {
        filledSlices.push({
          price: result.price,
          qty: slice.qty,
          time: Date.now()
        });

        totalFilled += slice.qty;
        totalValue += result.price * slice.qty;
        totalFees += result.fee;

        if (hasPriceImprovement) {
          console.log(`\x1b[32m[SOR] Price improvement! Got ${side === 'BUY' ? 'lower' : 'higher'} price.\x1b[0m`);
        }
      }
    }

    if (totalFilled === 0) {
      return {
        success: false,
        avgPrice: 0,
        totalFilled: 0,
        totalFees: 0,
        slippagePct: 0,
        slices: [],
        reason: maxSlippageHit ? 'MAX_SLIPPAGE_EXCEEDED' : 'NO_FILL'
      };
    }

    const avgPrice = totalValue / totalFilled;
    const slippagePct = Math.abs(avgPrice - refPrice) / refPrice;

    console.log(`\x1b[36m[SOR] Executed ${totalFilled}/${totalQty} ${symbol} ${side} @ avg $${avgPrice.toFixed(coinConfig.tickSize.toString().split('.')[1]?.length || 2)} | Slippage: ${(slippagePct * 100).toFixed(3)}% | Fees: $${totalFees.toFixed(4)}\x1b[0m`);

    return {
      success: true,
      avgPrice,
      totalFilled,
      totalFees,
      slippagePct,
      slices: filledSlices
    };
  }

  /**
   * Execute dengan aggressive pricing — langsung ke market
   */
  async executeMarketOrder(
    symbol: string,
    side: Side,
    qty: number,
    executeFn: (qty: number, price: number) => Promise<{ success: boolean; price: number; fee: number }>,
    book: OrderBook
  ): Promise<ExecutionResult> {
    const price = side === 'BUY' ? book.asks[0][0] : book.bids[0][0];
    
    const result = await executeFn(qty, price);
    
    if (result.success) {
      return {
        success: true,
        avgPrice: result.price,
        totalFilled: qty,
        totalFees: result.fee,
        slippagePct: 0,
        slices: [{ price: result.price, qty, time: Date.now() }]
      };
    }

    return {
      success: false,
      avgPrice: 0,
      totalFilled: 0,
      totalFees: 0,
      slippagePct: 0,
      slices: [],
      reason: 'MARKET_ORDER_FAILED'
    };
  }

  /**
   * Check apakah kondisi market bagus untuk entry
   */
  isGoodEntryCondition(symbol: string, side: Side, book: OrderBook): { allowed: boolean; reason: string } {
    const bestBid = book.bids[0][0];
    const bestAsk = book.asks[0][0];
    const spread = (bestAsk - bestBid) / bestBid;
    const midPrice = (bestBid + bestAsk) / 2;

    // 1. Spread terlalu lebar? (> 0.5%)
    if (spread > 0.005) {
      return { allowed: false, reason: `Spread terlalu lebar: ${(spread * 100).toFixed(3)}%` };
    }

    // 2. Volume tipis? (kurang dari $1000 notional)
    const depth = side === 'BUY' ? book.asks[0][1] : book.bids[0][1];
    const notionalDepth = depth * midPrice;
    if (notionalDepth < 1000) {
      return { allowed: false, reason: `Market depth terlalu tipis: $${notionalDepth.toFixed(0)}` };
    }

    // 3. Price manipulation check (spike > 1% dalam 1 tick)
    // Ini di-check sama liquidity sweep detection di market microstructure

    return { allowed: true, reason: 'OK' };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
