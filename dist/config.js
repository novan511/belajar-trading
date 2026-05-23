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
    // Multi-Model Configuration (Only Llama 3.1 8B is kept)
    MODELS: {
        Llama_8B: {
            id: 'Llama_8B',
            name: 'Llama 3.1 8B (AI Optimizer)',
            modelTag: 'meta/llama-3.1-8b-instruct',
            color: '#00f2fe' // Neon Cyan
        }
    },
    // Gemini API Key (kept for references or fallback, but not used in active models)
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'AQ.Ab8RN6Jk40Buo7VPt8ZH-8vQ4AeZwVvCs2yZXaui2okosxxwoQ',
    // Trading Pairs Configuration (Optimized Sweetspot for Scalping/Swing with 1:2 to 1:4 R:R)
    SYMBOLS: {
        BTC: {
            name: 'BTC',
            tradeSizeUsd: 1000,
            tickSize: 1.0,
            lotSize: 0.0001,
            obiThreshold: 0.20,
            zScoreThreshold: 0.8,
            takeProfitPct: 0.0150, // 1.50% profit target
            stopLossPct: 0.0050, // 0.50% SL (1:3 R:R)
        },
        ETH: {
            name: 'ETH',
            tradeSizeUsd: 1000,
            tickSize: 0.1,
            lotSize: 0.001,
            obiThreshold: 0.22,
            zScoreThreshold: 0.8,
            takeProfitPct: 0.0180, // 1.80% profit target
            stopLossPct: 0.0060, // 0.60% SL (1:3 R:R)
        },
        SOL: {
            name: 'SOL',
            tradeSizeUsd: 1000,
            tickSize: 0.01,
            lotSize: 0.01,
            obiThreshold: 0.25,
            zScoreThreshold: 0.9,
            takeProfitPct: 0.0240, // 2.40% profit target
            stopLossPct: 0.0080, // 0.80% SL (1:3 R:R)
        },
        SUI: {
            name: 'SUI',
            tradeSizeUsd: 1000,
            tickSize: 0.0001,
            lotSize: 0.1,
            obiThreshold: 0.35,
            zScoreThreshold: 0.9,
            takeProfitPct: 0.0300, // 3.00% profit target
            stopLossPct: 0.0100, // 1.00% SL (1:3 R:R)
        },
        XRP: {
            name: 'XRP',
            tradeSizeUsd: 1000,
            tickSize: 0.0001,
            lotSize: 1.0,
            obiThreshold: 0.25,
            zScoreThreshold: 0.9,
            takeProfitPct: 0.0200, // 2.00% profit target
            stopLossPct: 0.0060, // 0.60% SL (1:3.3 R:R)
        },
        HYPE: {
            name: 'HYPE',
            tradeSizeUsd: 1000,
            tickSize: 0.001,
            lotSize: 0.1,
            obiThreshold: 0.35,
            zScoreThreshold: 0.9,
            takeProfitPct: 0.0300, // 3.00% profit target
            stopLossPct: 0.0100, // 1.00% SL (1:3 R:R)
        },
        DOGE: {
            name: 'DOGE',
            tradeSizeUsd: 1000,
            tickSize: 0.00001,
            lotSize: 1.0,
            obiThreshold: 0.25,
            zScoreThreshold: 0.9,
            takeProfitPct: 0.0240, // 2.40% profit target
            stopLossPct: 0.0080, // 0.80% SL (1:3 R:R)
        },
        XAUT: {
            name: 'XAUT',
            tradeSizeUsd: 1000,
            tickSize: 0.1,
            lotSize: 0.0001,
            obiThreshold: 0.25,
            zScoreThreshold: 0.9,
            takeProfitPct: 0.0120, // 1.20% profit target (Gold)
            stopLossPct: 0.0040, // 0.40% SL (1:3 R:R)
        },
        XAG: {
            name: 'XAG',
            tradeSizeUsd: 1000,
            tickSize: 0.0001,
            lotSize: 0.1,
            obiThreshold: 0.25,
            zScoreThreshold: 0.9,
            takeProfitPct: 0.0150, // 1.50% profit target (Silver)
            stopLossPct: 0.0050, // 0.50% SL (1:3 R:R)
        }
    },
    // Strategy Core Constants
    ROLLING_WINDOW_SIZE: 30, // Window for historical calculations
    EMA_FAST_PERIOD: 10, // Period for trend tracking
    MAX_HOLD_DURATION_SEC: 86400, // Extended hold duration: 24 hours (for scalping/swing)
    // Spacing and Downside Safeguards
    MIN_ENTRY_SPACING_PCT: 0.01, // Minimum spacing between grid entries (1.0%)
    ENTRY_COOLDOWN_SEC: 300, // Cooldown between entries (5 minutes)
    CUMULATIVE_DRAWDOWN_LIMIT_PCT: 0.020, // Max cumulative loss per coin (2.0%)
    RUNAWAY_TRAILING_SL_MULTIPLIER: 0.30, // Extremely tight trailing SL multiplier once TP breached (30% of stopLossPct)
    // ============================================================
    // NEW: ADVANCED RISK MANAGEMENT & STRATEGY ENHANCEMENTS
    // ============================================================
    // --- Risk Management ---
    DAILY_DRAWDOWN_LIMIT_PCT: 0.05, // Max -5% total portfolio drawdown per day -> auto pause
    MAX_POSITION_RISK_PCT: 0.01, // Max risk per trade = 1% of capital
    ACCOUNT_BALANCE_USD: 10000, // Estimated account balance for Kelly sizing
    // --- Partial Take Profit (Scale Out) ---
    TP1_PCT: 0.30, // Close 30% at TP1
    TP2_PCT: 0.30, // Close 30% at TP2
    TP3_TRAIL_PCT: 0.40, // Let 40% run with trailing
    // --- Volatility-Based Sizing ---
    ATR_PERIOD: 14, // ATR calculation period
    ATR_MULTIPLIER_MIN: 0.5, // Min position size multiplier (low vol)
    ATR_MULTIPLIER_MAX: 1.5, // Max position size multiplier (high vol)
    BASE_RISK_PER_TRADE_USD: 100, // Base risk amount per trade
    // --- Kelly Criterion ---
    KELLY_FRACTION: 0.25, // Use 25% Kelly (conservative) to avoid overbetting
    // --- Time-Based Filtering ---
    // Trading sessions that overlap with high liquidity (UTC)
    TRADING_SESSION_START_HOUR_UTC: 1, // 01:00 UTC (Asian session overlap)
    TRADING_SESSION_END_HOUR_UTC: 21, // 21:00 UTC (US session close)
    // --- Liquidity Sweep Detection ---
    LIQUIDITY_SWEEP_WINDOW_TICKS: 50, // Lookback for sweep pattern
    SWEEP_BODY_THRESHOLD_PCT: 0.001, // 0.1% wick threshold for sweep detection
    // --- Regime Detection (HMM-inspired adaptive) ---
    REGIME_LOOKBACK_CANDLES: 50, // Candles for trend strength calc
    REGIME_EMA_PERIOD: 20, // For trend vs ranging detection
    REGIME_TREND_STRENGTH_THRESHOLD: 0.3, // ADX-like threshold
    // --- Market Microstructure ---
    OFI_WINDOW_TICKS: 10, // Order Flow Imbalance window
    CVD_WINDOW_TICKS: 20, // Cumulative Volume Delta window
    // --- VWAP & Volume Profile ---
    VWAP_PERIOD_CANDLES: 24, // 24-hour VWAP
    VALUE_AREA_PCT: 0.70, // 70% Value Area
    // --- Pairs Trading / Statistical Arbitrage ---
    PAIRS_ZSCORE_ENTRY: 2.0, // Entry when z-score > 2.0
    PAIRS_ZSCORE_EXIT: 0.5, // Exit when z-score < 0.5
    PAIRS_LOOKBACK_PERIODS: 100, // Correlation lookback
    TRADABLE_PAIRS: [
        ['BTC', 'ETH'],
        ['BTC', 'SOL'],
        ['ETH', 'SOL'],
        ['SOL', 'SUI'],
    ],
    // --- Performance Attribution ---
    PERFORMANCE_TRACKING_ENABLED: true,
    // Hyperliquid Fee Rates
    MAKER_FEE_PCT: 0.0001, // Hyperliquid Maker Fee (0.01%)
    TAKER_FEE_PCT: 0.0003, // Hyperliquid Retail Taker Fee (0.03%)
    // Logging Configuration
    LOG_LEVEL: 'info' // 'info' | 'debug'
};
