import { CONFIG } from './config.js';
import { Side, TradeSignal, Position, TradeRecord, ExecutionStats } from './types.js';
import { ExchangeConnector } from './exchange.js';

export class ExecutionEngine {
  private activePositions: Map<string, Position> = new Map(); // Key is symbol
  private tradesHistory: TradeRecord[] = [];
  private exchange: ExchangeConnector;

  // Track Stats
  private stats: ExecutionStats = {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    grossProfitUsd: 0,
    totalFeesUsd: 0,
    netProfitUsd: 0,
    averageHoldTimeSec: 0
  };

  constructor(exchange: ExchangeConnector) {
    this.exchange = exchange;
  }

  /**
   * Helper to format price dynamically according to each coin's tick size
   */
  private formatPrice(symbol: string, price: number): string {
    const coinConfig = Object.values(CONFIG.SYMBOLS).find(s => s.name === symbol);
    if (!coinConfig) return price.toFixed(2);
    
    const tickStr = coinConfig.tickSize.toString();
    const dot = tickStr.indexOf('.');
    const decimals = dot === -1 ? 0 : tickStr.length - dot - 1;
    return price.toFixed(decimals);
  }

  /**
   * Evaluates active positions to recalculate Trailing Stop Loss levels
   */
  public evaluatePositions(symbol: string, currentBid: number, currentAsk: number) {
    const position = this.activePositions.get(symbol);
    if (!position) return;

    const now = Date.now();
    const holdTimeSec = (now - position.entryTime) / 1000;
    
    let shouldClose = false;
    let exitPrice = 0;
    let reason = '';

    const coinConfig = Object.values(CONFIG.SYMBOLS).find(s => s.name === symbol);
    if (!coinConfig) return;

    const roundtripFeePct = CONFIG.TAKER_FEE_PCT * 2; // 0.06% roundtrip fee

    if (position.side === 'BUY') {
      // LONG: exit by selling at current Bid
      exitPrice = currentBid;
      const profitPct = (exitPrice - position.entryPrice) / position.entryPrice;

      // Dynamic Trailing Stop Tightening: hug price tighter as it nears profit target
      let activeStopLossPct = coinConfig.stopLossPct;
      if (profitPct >= coinConfig.takeProfitPct * 0.4) {
        activeStopLossPct = coinConfig.stopLossPct * 0.4; // Tighten SL by 60% once 40% of TP is reached!
      }

      // Initialize or update peak bid price
      const peakPrice = position.highestPrice || position.entryPrice;
      if (currentBid > peakPrice) {
        position.highestPrice = currentBid;
        // Drag Stop Loss upward behind the price peak
        const newStopLoss = currentBid * (1 - activeStopLossPct);
        if (newStopLoss > position.stopLossPrice) {
          position.stopLossPrice = newStopLoss;
        }
      }

      // STOP LOSS + : Force SL to cross above entry price + roundtrip fee to lock in a free trade!
      const feePlusStopLoss = position.entryPrice * (1 + roundtripFeePct);
      if (currentBid >= feePlusStopLoss && position.stopLossPrice < feePlusStopLoss) {
        position.stopLossPrice = feePlusStopLoss;
        console.log(`\x1b[32m[STOP LOSS + ACTIVATED] ${position.symbol} SL moved to fee-breakeven floor (${this.formatPrice(position.symbol, feePlusStopLoss)})\x1b[0m`);
      }

      // A. Check if price hit or exceeded the Hard Take Profit target
      if (exitPrice >= position.takeProfitPrice) {
        shouldClose = true;
        reason = `TAKE PROFIT TARGET HIT (+${(profitPct * 100).toFixed(3)}%)`;
      }
      // B. Check if price fell below trailing stop level
      else if (exitPrice <= position.stopLossPrice) {
        shouldClose = true;
        const isWin = exitPrice > position.entryPrice * (1 + roundtripFeePct);
        reason = isWin 
          ? `TRAILING PROFIT LOCKED (+${(profitPct * 100).toFixed(3)}%)` 
          : `STOP LOSS TRIGGERED (${(profitPct * 100).toFixed(3)}%)`;
      }
      // C. Check if max hold time expired
      else if (holdTimeSec >= CONFIG.MAX_HOLD_DURATION_SEC) {
        shouldClose = true;
        reason = `MAX TIME EXPIRED (${holdTimeSec.toFixed(1)}s)`;
      }
    } else {
      // SHORT: exit by buying back at current Ask
      exitPrice = currentAsk;
      const profitPct = (position.entryPrice - exitPrice) / position.entryPrice;

      // Dynamic Trailing Stop Tightening: hug price tighter as it drops
      let activeStopLossPct = coinConfig.stopLossPct;
      if (profitPct >= coinConfig.takeProfitPct * 0.4) {
        activeStopLossPct = coinConfig.stopLossPct * 0.4; // Tighten SL by 60% once 40% of TP is reached!
      }

      // Initialize or update trough ask price
      const troughPrice = position.lowestPrice || position.entryPrice;
      if (currentAsk < troughPrice) {
        position.lowestPrice = currentAsk;
        // Drag Stop Loss downward behind the price drop
        const newStopLoss = currentAsk * (1 + activeStopLossPct);
        if (newStopLoss < position.stopLossPrice) {
          position.stopLossPrice = newStopLoss;
        }
      }

      // STOP LOSS + : Force SL to cross below entry price - roundtrip fee to lock in a free trade!
      const feePlusStopLoss = position.entryPrice * (1 - roundtripFeePct);
      if (currentAsk <= feePlusStopLoss && position.stopLossPrice > feePlusStopLoss) {
        position.stopLossPrice = feePlusStopLoss;
        console.log(`\x1b[32m[STOP LOSS + ACTIVATED] ${position.symbol} SL moved to fee-breakeven floor (${this.formatPrice(position.symbol, feePlusStopLoss)})\x1b[0m`);
      }

      // A. Check if price hit or fell below the Hard Take Profit target
      if (exitPrice <= position.takeProfitPrice) {
        shouldClose = true;
        reason = `TAKE PROFIT TARGET HIT (+${(profitPct * 100).toFixed(3)}%)`;
      }
      // B. Check if price rose above trailing stop level
      else if (exitPrice >= position.stopLossPrice) {
        shouldClose = true;
        const isWin = exitPrice < position.entryPrice * (1 - roundtripFeePct);
        reason = isWin 
          ? `TRAILING PROFIT LOCKED (+${(profitPct * 100).toFixed(3)}%)` 
          : `STOP LOSS TRIGGERED (${(profitPct * 100).toFixed(3)}%)`;
      }
      // C. Check if max hold time expired
      else if (holdTimeSec >= CONFIG.MAX_HOLD_DURATION_SEC) {
        shouldClose = true;
        reason = `MAX TIME EXPIRED (${holdTimeSec.toFixed(1)}s)`;
      }
    }

    if (shouldClose) {
      this.closePosition(position, exitPrice, reason);
    }
  }

  /**
   * Triggers entry for a new signal
   */
  public async executeSignal(signal: TradeSignal) {
    // Skip if we already have an active position in this symbol
    if (this.activePositions.has(signal.symbol)) {
      return;
    }

    const coinConfig = Object.values(CONFIG.SYMBOLS).find(s => s.name === signal.symbol);
    if (!coinConfig) return;

    const tradeSize = coinConfig.tradeSizeUsd;
    const entryPrice = signal.price;
    const quantity = parseFloat((tradeSize / entryPrice).toFixed(this.getLotDecimalPlaces(coinConfig.lotSize)));

    if (quantity <= 0) return;

    // Trailing Stop & Take Profit configurations
    let stopLossPrice = 0;
    let takeProfitPrice = 0;
    if (signal.side === 'BUY') {
      stopLossPrice = entryPrice * (1 - coinConfig.stopLossPct);
      takeProfitPrice = entryPrice * (1 + coinConfig.takeProfitPct);
    } else {
      stopLossPrice = entryPrice * (1 + coinConfig.stopLossPct);
      takeProfitPrice = entryPrice * (1 - coinConfig.takeProfitPct);
    }

    console.log(`\x1b[36m[SIGNAL ENTRY] ${signal.symbol} | ${signal.side} at ${this.formatPrice(signal.symbol, entryPrice)} | size: $${tradeSize} | SL: ${this.formatPrice(signal.symbol, stopLossPrice)} | TP: ${this.formatPrice(signal.symbol, takeProfitPrice)}\x1b[0m`);
    
    if (CONFIG.SIMULATION_MODE) {
      const order = await this.exchange.submitSimulatedOrder(signal.symbol, signal.side, entryPrice, quantity);
      
      if (order.success) {
        const position: Position = {
          id: order.orderId,
          symbol: signal.symbol,
          side: signal.side,
          entryPrice: order.executedPrice,
          quantity,
          entryTime: Date.now(),
          takeProfitPrice,
          stopLossPrice,
          highestPrice: order.executedPrice, // Initialize peak bid to entry price
          lowestPrice: order.executedPrice   // Initialize trough ask to entry price
        };

        this.activePositions.set(signal.symbol, position);
        this.stats.totalFeesUsd += order.feeUsd; // Add entry fee
      }
    } else {
      try {
        await this.exchange.submitLiveOrder(signal.symbol, signal.side, quantity);
      } catch (err: any) {
        console.error(`[EXECUTION ERROR] Live entry failed:`, err.message);
      }
    }
  }

  /**
   * Closes an active position and calculates trade performance metrics
   */
  private async closePosition(position: Position, exitPrice: number, reason: string) {
    const coinConfig = Object.values(CONFIG.SYMBOLS).find(s => s.name === position.symbol);
    if (!coinConfig) return;

    const now = Date.now();
    const holdTimeSec = (now - position.entryTime) / 1000;

    // Compute gross profit based on direction
    let grossProfit = 0;
    if (position.side === 'BUY') {
      grossProfit = (exitPrice - position.entryPrice) * position.quantity;
    } else {
      grossProfit = (position.entryPrice - exitPrice) * position.quantity;
    }

    // Compute exit fee (using MAKER rate as orders are executed via Limit orders)
    const orderValue = exitPrice * position.quantity;
    const exitFee = orderValue * CONFIG.MAKER_FEE_PCT;
    
    const entryFee = position.entryPrice * position.quantity * CONFIG.MAKER_FEE_PCT;
    const totalFeesForTrade = entryFee + exitFee;
    const netProfit = grossProfit - totalFeesForTrade;

    this.stats.totalFeesUsd += exitFee;
    this.stats.grossProfitUsd += grossProfit;
    this.stats.netProfitUsd += netProfit;

    const result = netProfit > 0 ? 'WIN' : netProfit < 0 ? 'LOSS' : 'BREAKEVEN';

    if (result === 'WIN') {
      this.stats.winningTrades++;
    } else if (result === 'LOSS') {
      this.stats.losingTrades++;
    }

    this.stats.totalTrades++;
    this.stats.winRate = (this.stats.winningTrades / this.stats.totalTrades) * 100;
    
    this.stats.averageHoldTimeSec = 
      (this.stats.averageHoldTimeSec * (this.stats.totalTrades - 1) + holdTimeSec) / this.stats.totalTrades;

    const record: TradeRecord = {
      id: position.id,
      symbol: position.symbol,
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice,
      quantity: position.quantity,
      entryTime: position.entryTime,
      exitTime: now,
      holdTimeSec,
      grossProfitUsd: grossProfit,
      feesUsd: totalFeesForTrade,
      netProfitUsd: netProfit,
      result
    };

    this.tradesHistory.push(record);
    this.activePositions.delete(position.symbol);

    const color = result === 'WIN' ? '\x1b[32m' : '\x1b[31m';
    console.log(`${color}[TRADE CLOSED] ${position.symbol} | ${position.side} closed via ${reason} | Hold: ${holdTimeSec.toFixed(1)}s | Net: $${netProfit.toFixed(3)} | Result: ${result}\x1b[0m`);

    this.renderDashboard();
  }

  /**
   * Helper to count decimal spaces for rounding quantities
   */
  private getLotDecimalPlaces(lotSize: number): number {
    if (lotSize >= 1) return 0;
    const s = lotSize.toString();
    const dot = s.indexOf('.');
    return dot === -1 ? 0 : s.length - dot - 1;
  }

  /**
   * Sleek, high-frequency real-time dashboard printed to console
   */
  public renderDashboard() {
    console.clear();
    console.log('\x1b[35m================================================================================\x1b[0m');
    console.log('\x1b[1m\x1b[33m                   HIGH-FREQUENCY TRADING (HFT) DASHBOARD                      \x1b[0m');
    console.log(`\x1b[37m Running Mode   : ${CONFIG.SIMULATION_MODE ? 'LIVE SIMULATION (Safe)' : 'LIVE TRADING (Real API)'}\x1b[0m`);
    console.log(`\x1b[37m Start Time     : ${new Date().toLocaleString()}\x1b[0m`);
    console.log('\x1b[35m================================================================================\x1b[0m');
    
    const winRateColor = this.stats.winRate >= 70 ? '\x1b[32m' : this.stats.winRate >= 50 ? '\x1b[33m' : '\x1b[31m';
    const netProfitColor = this.stats.netProfitUsd >= 0 ? '\x1b[32m' : '\x1b[31m';

    console.log(`\x1b[1m Performance Metrics:\x1b[0m`);
    console.log(`   Total Executed Trades : \x1b[1m${this.stats.totalTrades}\x1b[0m`);
    console.log(`   Wins                  : \x1b[32m${this.stats.winningTrades}\x1b[0m`);
    console.log(`   Losses                : \x1b[31m${this.stats.losingTrades}\x1b[0m`);
    console.log(`   Winning Rate          : ${winRateColor}\x1b[1m${this.stats.winRate.toFixed(2)}%\x1b[0m  \x1b[90m(Target: >70%)\x1b[0m`);
    console.log(`   Gross Profit/Loss     : ${this.stats.grossProfitUsd >= 0 ? '\x1b[32m' : '\x1b[31m'}$${this.stats.grossProfitUsd.toFixed(4)}\x1b[0m`);
    console.log(`   Exchange Fees Paid    : \x1b[31m$${this.stats.totalFeesUsd.toFixed(4)}\x1b[0m \x1b[90m(Taker Rate: ${(CONFIG.TAKER_FEE_PCT * 100).toFixed(3)}%)\x1b[0m`);
    console.log(`   Net Profit (P&L)      : ${netProfitColor}\x1b[1m$${this.stats.netProfitUsd.toFixed(4)}\x1b[0m`);
    console.log(`   Average Hold Duration : \x1b[33m${this.stats.averageHoldTimeSec.toFixed(2)} seconds\x1b[0m`);
    console.log('\x1b[35m--------------------------------------------------------------------------------\x1b[0m');
    
    // Active Positions
    console.log(`\x1b[1m Active Positions (Trailing Stop Loss Mode):\x1b[0m`);
    if (this.activePositions.size === 0) {
      console.log('   No active positions currently held.');
    } else {
      for (const [symbol, pos] of this.activePositions) {
        const sideColor = pos.side === 'BUY' ? '\x1b[32m' : '\x1b[31m';
        const holdTimeSec = ((Date.now() - pos.entryTime) / 1000).toFixed(1);
        const peakPrice = pos.side === 'BUY' ? (pos.highestPrice || pos.entryPrice) : (pos.lowestPrice || pos.entryPrice);
        
        console.log(`   Symbol: \x1b[1m${symbol}\x1b[0m | Side: ${sideColor}${pos.side}\x1b[0m | Entry: ${this.formatPrice(symbol, pos.entryPrice)} | SL: \x1b[31m${this.formatPrice(symbol, pos.stopLossPrice)}\x1b[0m | Peak: \x1b[32m${this.formatPrice(symbol, peakPrice)}\x1b[0m | Hold: ${holdTimeSec}s`);
      }
    }
    console.log('\x1b[35m================================================================================\x1b[0m');
    
    // Recent Trade logs (last 5)
    console.log(`\x1b[1m Recent Finished Scalps:\x1b[0m`);
    const recentTrades = this.tradesHistory.slice(-5).reverse();
    if (recentTrades.length === 0) {
      console.log('   Waiting for first trade to complete...');
    } else {
      recentTrades.forEach(t => {
        const resultColor = t.result === 'WIN' ? '\x1b[32m' : '\x1b[31m';
        console.log(`   [${new Date(t.exitTime).toLocaleTimeString()}] ${t.symbol} | ${t.side} | Entry: ${this.formatPrice(t.symbol, t.entryPrice)} -> Exit: ${this.formatPrice(t.symbol, t.exitPrice)} | Net: ${resultColor}$${t.netProfitUsd.toFixed(3)}\x1b[0m`);
      });
    }
    console.log('\x1b[35m================================================================================\x1b[0m');
    console.log('\x1b[90m Press Ctrl+C to safely shutdown. Logs will flush to console.\x1b[0m');
  }

  public getStats() {
    return this.stats;
  }

  public getActivePositions() {
    return Array.from(this.activePositions.values());
  }

  public getTradesHistory() {
    return this.tradesHistory;
  }
}
