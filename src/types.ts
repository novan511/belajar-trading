export type Side = 'BUY' | 'SELL';

export interface OrderBook {
  symbol: string;
  bids: [number, number][]; // Array of [price, size]
  asks: [number, number][]; // Array of [price, size]
  updatedAt: number;
}

export interface TickData {
  symbol: string;
  midPrice: number;
  microPrice: number;
  obi: number;
  timestamp: number;
}

export interface TradeSignal {
  symbol: string;
  side: Side;
  price: number;
  reason: string;
}

export interface Position {
  id: string;
  symbol: string;
  side: Side;
  entryPrice: number;
  quantity: number;
  entryTime: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  highestPrice?: number; // Tracks peak bid price for trailing stop in long positions
  lowestPrice?: number;  // Tracks trough ask price for trailing stop in short positions
  entryReason?: string;  // Quantitative reason from StrategyManager
}

export interface TradeRecord {
  id: string;
  symbol: string;
  side: Side;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  entryTime: number;
  exitTime: number;
  holdTimeSec: number;
  grossProfitUsd: number;
  feesUsd: number;
  netProfitUsd: number;
  result: 'WIN' | 'LOSS' | 'BREAKEVEN';
  entryReason?: string; // Quantitative reason from StrategyManager
}

export interface ExecutionStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  grossProfitUsd: number;
  totalFeesUsd: number;
  netProfitUsd: number;
  averageHoldTimeSec: number;
}
