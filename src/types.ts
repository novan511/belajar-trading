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
  confidence: 'HIGH' | 'LOW'; // Added confidence level for dynamic sizing
}

export interface PartialTPLevel {
  pct: number;          // Fraction of position to close at this level
  targetPx: number;     // Price target
  isTriggered: boolean;
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
  isTakeProfitTriggered?: boolean; // Tracks whether position hit its original TP target and is in runaway profit mode
  modelId?: string;      // Identifies which model owns this position
  // NEW: Partial take-profit levels
  partialTPs?: PartialTPLevel[];
  remainingQty?: number;  // Remaining quantity after partial closes
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
  modelId?: string;     // Identifies which model owns this trade record
  // NEW: Enhanced tracking
  exitReason?: string;
  partialCloses?: { qty: number; price: number; time: number }[];
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

// NEW: Market Regime types
export type MarketRegime = 'TRENDING_BULL' | 'TRENDING_BEAR' | 'RANGING' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY';

// NEW: Trading Session
export type TradingSession = 'ASIAN' | 'LONDON' | 'NEW_YORK' | 'OVERLAP' | 'OFF_HOURS';

// NEW: Liquidity Sweep Signal
export interface LiquiditySweepSignal {
  symbol: string;
  side: Side;
  price: number;
  reason: string;
}

// NEW: Order Flow Imbalance
export interface OrderFlowState {
  bidVolume: number;
  askVolume: number;
  totalTrades: number;
  cvd: number; // Cumulative Volume Delta
}

// NEW: VWAP & Volume Profile
export interface VWAPData {
  price: number;
  upperBand: number;
  lowerBand: number;
}

export interface VolumeProfile {
  poc: number;         // Point of Control
  vah: number;         // Value Area High
  val: number;         // Value Area Low
}

// NEW: Pairs Trading Signal
export interface PairsSignal {
  longSymbol: string;
  shortSymbol: string;
  zScore: number;
  reason: string;
}

// NEW: Performance Attribution (per coin/per strategy)
export interface PerformanceAttribution {
  symbol: string;
  totalTrades: number;
  winRate: number;
  netProfitUsd: number;
  profitFactor: number;
  sharpeRatio: number;
  avgReturnPerTrade: number;
  maxDrawdown: number;
}
