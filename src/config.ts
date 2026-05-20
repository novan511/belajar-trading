import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
  // Hyperliquid Endpoints
  HYPERLIQUID_WS_URL: 'wss://api.hyperliquid.xyz/ws',
  HYPERLIQUID_REST_URL: 'https://api.hyperliquid.xyz',

  // Trading Mode
  SIMULATION_MODE: true, // If true, simulates orders against live Hyperliquid WebSocket data feed

  // L1 Ethereum Private Key (only used if SIMULATION_MODE is false)
  WALLET_PRIVATE_KEY: process.env.WALLET_PRIVATE_KEY || '',

  // Multi-Model Configuration
  MODELS: {
    Llama_8B: {
      id: 'Llama_8B',
      name: 'Llama 3.1 8B (AI Optimizer)',
      modelTag: 'meta/llama-3.1-8b-instruct',
      color: '#00f2fe' // Neon Cyan
    },
    Gemini_Pro: {
      id: 'Gemini_Pro',
      name: 'Gemini Pro (AI Optimizer)',
      modelTag: 'gemini-pro',
      color: '#ff9800' // Neon Orange
    }
  },
  // Gemini API Key (set in .env)
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'AQ.Ab8RN6Jk40Buo7VPt8ZH-8vQ4AeZwVvCs2yZXaui2okosxxwoQ',


  // Trading Pairs Configuration (Optimized Sweetspot for Higher Frequency + Beat Commissions)
  SYMBOLS: {
    BTC: {
      name: 'BTC',
      tradeSizeUsd: 1000,
      tickSize: 1.0,
      lotSize: 0.0001,
      obiThreshold: 0.20,    // Responsive BTC OBI
      zScoreThreshold: 0.8,  // Faster pullback trigger
      takeProfitPct: 0.0040, 
      stopLossPct: 0.0035,   
    },
    ETH: {
      name: 'ETH',
      tradeSizeUsd: 1000,
      tickSize: 0.1,
      lotSize: 0.001,
      obiThreshold: 0.22,    // Responsive ETH
      zScoreThreshold: 0.8,
      takeProfitPct: 0.0050, 
      stopLossPct: 0.0040,   
    },
    SOL: {
      name: 'SOL',
      tradeSizeUsd: 1000,
      tickSize: 0.01,
      lotSize: 0.01,
      obiThreshold: 0.25,    // Sweetspot OBI
      zScoreThreshold: 0.9,  // Fast Z-score entry
      takeProfitPct: 0.0080, 
      stopLossPct: 0.0050,   
    },
    SUI: {
      name: 'SUI',
      tradeSizeUsd: 1000,
      tickSize: 0.0001,
      lotSize: 0.1,
      obiThreshold: 0.35,    
      zScoreThreshold: 0.9,  
      takeProfitPct: 0.0100, 
      stopLossPct: 0.0035,   
    },

    MANTA: {
      name: 'MANTA',
      tradeSizeUsd: 1000,
      tickSize: 0.0001,
      lotSize: 1.0,
      obiThreshold: 0.35,
      zScoreThreshold: 0.9,
      takeProfitPct: 0.0120, 
      stopLossPct: 0.0035,   
    },
    XRP: {
      name: 'XRP',
      tradeSizeUsd: 1000,
      tickSize: 0.0001,
      lotSize: 1.0,
      obiThreshold: 0.25,    
      zScoreThreshold: 0.9,  
      takeProfitPct: 0.0060, 
      stopLossPct: 0.0045,   
    },
    HYPE: {
      name: 'HYPE',
      tradeSizeUsd: 1000,
      tickSize: 0.001,
      lotSize: 0.1,
      obiThreshold: 0.35,    
      zScoreThreshold: 0.9,  
      takeProfitPct: 0.0100, 
      stopLossPct: 0.0035,   
    },


    ASTR: {
      name: 'ASTR',
      tradeSizeUsd: 1000,
      tickSize: 0.00001,
      lotSize: 1.0,
      obiThreshold: 0.25,
      zScoreThreshold: 0.9,
      takeProfitPct: 0.0150, 
      stopLossPct: 0.0080,   
    },
    DOGE: {
      name: 'DOGE',
      tradeSizeUsd: 1000,
      tickSize: 0.00001,
      lotSize: 1.0,
      obiThreshold: 0.25,    
      zScoreThreshold: 0.9,  
      takeProfitPct: 0.0080, 
      stopLossPct: 0.0050,   
    },
    XAUT: {
      name: 'XAUT',
      tradeSizeUsd: 1000,
      tickSize: 0.1,
      lotSize: 0.0001,
      obiThreshold: 0.25,    // Gold Sweetspot
      zScoreThreshold: 0.9,
      takeProfitPct: 0.0050, // 0.50% profit target
      stopLossPct: 0.0035,   // 0.35% SL
    },
    XAG: {
      name: 'XAG',
      tradeSizeUsd: 1000,
      tickSize: 0.0001,
      lotSize: 0.1,
      obiThreshold: 0.25,    // Silver Sweetspot
      zScoreThreshold: 0.9,
      takeProfitPct: 0.0060, // 0.60% profit target
      stopLossPct: 0.0040,   // 0.40% SL
    }
  },

  // Strategy Core Constants
  ROLLING_WINDOW_SIZE: 20,    // Window (in seconds) for Z-score mean and stddev
  EMA_FAST_PERIOD: 5,        // Period (in seconds) for fast trend tracking
  MAX_HOLD_DURATION_SEC: 120, // Safeguard max duration: 2 minutes

  // Spacing and Downside Safeguards
  MIN_ENTRY_SPACING_PCT: 0.005,       // Minimum entry price spacing (0.5%)
  ENTRY_COOLDOWN_SEC: 15,            // Minimum entry time cooldown (15 seconds)
  CUMULATIVE_DRAWDOWN_LIMIT_PCT: 0.015, // Max cumulative loss per coin (1.5%)
  RUNAWAY_TRAILING_SL_MULTIPLIER: 0.40, // Tight trailing SL multiplier for runaway profit mode (40% of stopLossPct)

  // Hyperliquid Fee Rates
  MAKER_FEE_PCT: 0.0001,     // Hyperliquid Maker Fee (0.01%)
  TAKER_FEE_PCT: 0.0003,     // Hyperliquid Retail Taker Fee (0.03%)

  // Logging Configuration
  LOG_LEVEL: 'info'          // 'info' | 'debug'
};
