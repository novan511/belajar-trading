import dotenv from 'dotenv';
dotenv.config();
export const CONFIG = {
    // Hyperliquid Endpoints
    HYPERLIQUID_WS_URL: 'wss://api.hyperliquid.xyz/ws',
    HYPERLIQUID_REST_URL: 'https://api.hyperliquid.xyz',
    // Trading Mode
    SIMULATION_MODE: true,
    // Wallet
    WALLET_PRIVATE_KEY: process.env.WALLET_PRIVATE_KEY || '',
    // Model registry
    MODELS: {
        Llama_8B: {
            id: 'Llama_8B',
            name: 'Llama 3.1 8B (AI Optimizer)',
            modelTag: 'meta/llama-3.1-8b-instruct',
            color: '#00f2fe',
            capitalAllocationUsd: 10000,
        }
    },
    // API keys
    NVIDIA_API_KEY: process.env.NVIDIA_API_KEY || '',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
    // Supabase
    SUPABASE_URL: process.env.SUPABASE_URL || 'https://myvuvhagzvrfkbcwekqs.supabase.co/rest/v1/',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    SUPABASE_ENABLED: true,
    // Trading Pairs Configuration
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
        }
    },
    // Strategy Core Constants
    ROLLING_WINDOW_SIZE: 30,
    EMA_FAST_PERIOD: 10,
    MAX_HOLD_DURATION_SEC: 86400,
    // Spacing and Downside Safeguards
    MIN_ENTRY_SPACING_PCT: 0.01,
    ENTRY_COOLDOWN_SEC: 300,
    CUMULATIVE_DRAWDOWN_LIMIT_PCT: 0.020,
    RUNAWAY_TRAILING_SL_MULTIPLIER: 0.30,
    // Advanced Risk Management
    DAILY_DRAWDOWN_LIMIT_PCT: 0.05,
    MAX_POSITION_RISK_PCT: 0.01,
    ACCOUNT_BALANCE_USD: 10000,
    PER_MODEL_CAPITAL_ALLOCATION_USD: 10000,
    MAX_CONCURRENT_POSITIONS: 12,
    PORTFOLIO_SECTOR_LIMIT_PCT: 0.60,
    // Partial Take Profit
    TP1_PCT: 0.30,
    TP2_PCT: 0.30,
    TP3_TRAIL_PCT: 0.40,
    // Volatility-Based Sizing
    ATR_PERIOD: 14,
    ATR_MULTIPLIER_MIN: 0.5,
    ATR_MULTIPLIER_MAX: 1.5,
    BASE_RISK_PER_TRADE_USD: 100,
    // Kelly Criterion
    KELLY_FRACTION: 0.25,
    // Time-Based Filtering
    TRADING_SESSION_START_HOUR_UTC: 1,
    TRADING_SESSION_END_HOUR_UTC: 21,
    // Liquidity Sweep Detection
    LIQUIDITY_SWEEP_WINDOW_TICKS: 50,
    SWEEP_BODY_THRESHOLD_PCT: 0.001,
    // Regime Detection
    REGIME_LOOKBACK_CANDLES: 50,
    REGIME_EMA_PERIOD: 20,
    REGIME_TREND_STRENGTH_THRESHOLD: 0.3,
    // Market Microstructure
    OFI_WINDOW_TICKS: 10,
    CVD_WINDOW_TICKS: 20,
    // VWAP & Volume Profile
    VWAP_PERIOD_CANDLES: 24,
    VALUE_AREA_PCT: 0.70,
    // Pairs Trading
    PAIRS_ZSCORE_ENTRY: 2.0,
    PAIRS_ZSCORE_EXIT: 0.5,
    PAIRS_LOOKBACK_PERIODS: 100,
    TRADABLE_PAIRS: [
        ['BTC', 'ETH'],
        ['BTC', 'SOL'],
        ['ETH', 'SOL'],
        ['SOL', 'SUI'],
    ],
    // Performance Tracking
    PERFORMANCE_TRACKING_ENABLED: true,
    // Hyperliquid Fee Rates
    MAKER_FEE_PCT: 0.0001,
    TAKER_FEE_PCT: 0.0003,
    // Logging
    LOG_LEVEL: 'info',
    // Optimization
    AI_OPTIMIZER_ENABLED: true,
    AI_OPTIMIZATION_INTERVAL_MS: 180000,
    // AI Continuous Learning
    AI_LEARNING_ENABLED: true,
    AI_FEEDBACK_ENABLED: true,
    AI_AUTO_TUNING_ENABLED: true,
    AI_AUTO_TUNING_MIN_TRADES: 10,
    AI_AUTO_TUNING_INTERVAL_MS: 300000,
    AI_SESSION_LEARNING_ENABLED: true,
    AI_SESSION_PAUSE_THRESHOLD: 0.3,
    AI_SESSION_MIN_TRADES: 3,
    AI_RL_FEEDBACK_WINDOW: 50,
};
