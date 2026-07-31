import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
  HYPERLIQUID_WS_URL: 'wss://api.hyperliquid.xyz/ws',
  HYPERLIQUID_REST_URL: 'https://api.hyperliquid.xyz',

  SIMULATION_MODE: true,

  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  WALLET_PRIVATE_KEY: process.env.WALLET_PRIVATE_KEY || '',

  GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'AQ.Ab8RN6Jk40Buo7VPt8ZH-8vQ4AeZwVvCs2yZXaui2okosxxwoQ',

  MODELS: {
    Llama_8B: {
      id: 'Llama_8B',
      name: 'Llama 3.1 8B (AI Optimizer)',
      modelTag: 'meta/llama-3.1-8b-instruct',
      color: '#00f2fe',
    },
  },

  SYMBOLS: {
    BTC: {
      name: 'BTC',
      tradeSizeUsd: 1000,
      tickSize: 1.0,
      lotSize: 0.0001,
      obiThreshold: 0.20,
      zScoreThreshold: 0.8,
      takeProfitPct: 0.0150,
      stopLossPct: 0.0050,
    },
    ETH: {
      name: 'ETH',
      tradeSizeUsd: 1000,
      tickSize: 0.1,
      lotSize: 0.001,
      obiThreshold: 0.22,
      zScoreThreshold: 0.8,
      takeProfitPct: 0.0180,
      stopLossPct: 0.0060,
    },
    SOL: {
      name: 'SOL',
      tradeSizeUsd: 1000,
      tickSize: 0.01,
      lotSize: 0.01,
      obiThreshold: 0.25,
      zScoreThreshold: 0.9,
      takeProfitPct: 0.0240,
      stopLossPct: 0.0080,
    },
    SUI: {
      name: 'SUI',
      tradeSizeUsd: 1000,
      tickSize: 0.0001,
      lotSize: 0.1,
      obiThreshold: 0.35,
      zScoreThreshold: 0.9,
      takeProfitPct: 0.0300,
      stopLossPct: 0.0100,
    },
    XRP: {
      name: 'XRP',
      tradeSizeUsd: 1000,
      tickSize: 0.0001,
      lotSize: 1.0,
      obiThreshold: 0.25,
      zScoreThreshold: 0.9,
      takeProfitPct: 0.0200,
      stopLossPct: 0.0060,
    },
    HYPE: {
      name: 'HYPE',
      tradeSizeUsd: 1000,
      tickSize: 0.001,
      lotSize: 0.1,
      obiThreshold: 0.35,
      zScoreThreshold: 0.9,
      takeProfitPct: 0.0300,
      stopLossPct: 0.0100,
    },
    DOGE: {
      name: 'DOGE',
      tradeSizeUsd: 1000,
      tickSize: 0.00001,
      lotSize: 1.0,
      obiThreshold: 0.25,
      zScoreThreshold: 0.9,
      takeProfitPct: 0.0240,
      stopLossPct: 0.0080,
    },
    NEAR: {
      name: 'NEAR',
      tradeSizeUsd: 1000,
      tickSize: 0.001,
      lotSize: 0.1,
      obiThreshold: 0.30,
      zScoreThreshold: 0.9,
      takeProfitPct: 0.0250,
      stopLossPct: 0.0080,
    },
    FET: {
      name: 'FET',
      tradeSizeUsd: 1000,
      tickSize: 0.0001,
      lotSize: 1.0,
      obiThreshold: 0.30,
      zScoreThreshold: 0.9,
      takeProfitPct: 0.0280,
      stopLossPct: 0.0090,
    },
  },

  ROLLING_WINDOW_SIZE: 30,
  EMA_FAST_PERIOD: 10,
  MAX_HOLD_DURATION_SEC: 86400,

  MIN_ENTRY_SPACING_PCT: 0.01,
  ENTRY_COOLDOWN_SEC: 300,
  CUMULATIVE_DRAWDOWN_LIMIT_PCT: 0.020,
  RUNAWAY_TRAILING_SL_MULTIPLIER: 0.30,

  DAILY_DRAWDOWN_LIMIT_PCT: 0.05,
  MAX_POSITION_RISK_PCT: 0.01,
  ACCOUNT_BALANCE_USD: 10000,

  TP1_PCT: 0.30,
  TP2_PCT: 0.30,
  TP3_TRAIL_PCT: 0.40,

  ATR_PERIOD: 14,
  ATR_MULTIPLIER_MIN: 0.5,
  ATR_MULTIPLIER_MAX: 1.5,
  BASE_RISK_PER_TRADE_USD: 100,
  KELLY_FRACTION: 0.25,

  TRADING_SESSION_START_HOUR_UTC: 1,
  TRADING_SESSION_END_HOUR_UTC: 21,

  LIQUIDITY_SWEEP_WINDOW_TICKS: 50,
  SWEEP_BODY_THRESHOLD_PCT: 0.001,

  REGIME_LOOKBACK_CANDLES: 50,
  REGIME_EMA_PERIOD: 20,
  REGIME_TREND_STRENGTH_THRESHOLD: 0.3,

  OFI_WINDOW_TICKS: 10,
  CVD_WINDOW_TICKS: 20,

  VWAP_PERIOD_CANDLES: 24,
  VALUE_AREA_PCT: 0.70,

  PAIRS_ZSCORE_ENTRY: 2.0,
  PAIRS_ZSCORE_EXIT: 0.5,
  PAIRS_LOOKBACK_PERIODS: 100,
  TRADABLE_PAIRS: [
    ['BTC', 'ETH'],
    ['BTC', 'SOL'],
    ['ETH', 'SOL'],
    ['SOL', 'SUI'],
  ],

  PERFORMANCE_TRACKING_ENABLED: true,

  MAKER_FEE_PCT: 0.0001,
  TAKER_FEE_PCT: 0.0003,

  LOG_LEVEL: 'info',
};
