import { CONFIG } from './config.js';
import { ExecutionStats, TradeRecord } from './types.js';

export interface SymbolOptimizedParams {
  obiThreshold: number;
  zScoreThreshold: number;
  takeProfitPct: number;
  stopLossPct: number;
}

export interface SymbolAnalysis {
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  rationale: string;
}

export interface NvidiaObserverResponse {
  parameters: Record<string, SymbolOptimizedParams>;
  analysis: Record<string, SymbolAnalysis>;
}

export class NvidiaObserver {
  private apiKey: string;
  private endpoint = 'https://integrate.api.nvidia.com/v1/chat/completions';
  private model = 'meta/llama-3.1-8b-instruct';

  constructor() {
    this.apiKey = process.env.NVIDIA_API_KEY || '';
    if (!this.apiKey) {
      console.warn('\x1b[33m[NVIDIA OBSERVER] Warning: NVIDIA_API_KEY is not set. Dynamic optimization will fallback to defaults.\x1b[0m');
    }
  }

  /**
   * Invokes Llama 3.1 8B to analyze the HFT session stats & trades, returning optimized parameters and qualitative analyses.
   */
  public async optimizeParameters(
    stats: ExecutionStats,
    recentTrades: TradeRecord[],
    activeSymbols: string[],
    candleData: Record<string, Record<string, any[]>>,
    modelOverride?: string,
    currentParamsSnapshot?: Record<string, any>
  ): Promise<NvidiaObserverResponse | null> {
    if (!this.apiKey) return null;

    // Filter down to the last 15 trades to avoid prompt bloat while retaining high context density
    const subsetTrades = recentTrades.slice(-15).map(t => ({
      symbol: t.symbol,
      side: t.side,
      entry: t.entryPrice,
      exit: t.exitPrice,
      netUsd: parseFloat(t.netProfitUsd.toFixed(4)),
      result: t.result,
      holdTimeSec: Math.round(t.holdTimeSec)
    }));

    // Build current parameters snapshot to give LLM a reference point if not provided
    const paramsSnapshot = currentParamsSnapshot || {};
    if (!currentParamsSnapshot) {
      for (const symbol of activeSymbols) {
        const symConf = (CONFIG.SYMBOLS as any)[symbol];
        if (symConf) {
          paramsSnapshot[symbol] = {
            obiThreshold: symConf.obiThreshold,
            zScoreThreshold: symConf.zScoreThreshold,
            takeProfitPct: symConf.takeProfitPct,
            stopLossPct: symConf.stopLossPct
          };
        }
      }
    }

    const systemPrompt = `You are a quantitative strategist AI Observer for an in-memory sub-second high-frequency trading (HFT) bot.
Your role is to analyze multi-timeframe candlestick data (5m, 15m, 30m, 1h, 4h, 1d, 1w, 1M), analyze trading session results, determine the macro-to-micro market bias per coin, and optimize parameters dynamically for the next trading window.

MULTI-TIMEFRAME ANALYSIS MANDATE (TOP-DOWN ANALYSIS):
Analyze the provided multiTimeframeCandles for each coin across:
- Macro Trend: Monthly (1M), Weekly (1w), and Daily (1d). Is the coin in a long-term bull market or bear market?
- Medium Trend: 4-Hour (4h), 1-Hour (1h), and 30-Minute (30m). What is the intermediate swing structure?
- Micro Trend: 15-Minute (15m) and 5-Minute (5m). What is the immediate direction?

You must synthesize these timeframes:
- If Macro (1M, 1w, 1d), Medium (4h, 1h, 30m), and Micro (15m, 5m) are strongly bullish, lock the bias as "BULLISH".
- If they are strongly bearish, lock the bias as "BEARISH".
- If they are conflicting or flat, set the bias to "NEUTRAL".

RISK MANAGEMENT & TIGHTENING RULE:
1. Fee Protection: Taker fees eat up HFT profits. If win rate is low, or to generally protect capital, widen the entry thresholds (obiThreshold, zScoreThreshold) to make the HFT executor highly selective (trade only at key levels, reducing trade count and saving transaction fees).
2. Tight Stop Loss: To prevent a few bad trades from erasing many small wins, you MUST enforce a tight stopLossPct relative to takeProfitPct. Keep stopLossPct at 0.4x to 0.6x of takeProfitPct (e.g. if takeProfitPct is 0.0100 (1.0%), stopLossPct must be between 0.0040 (0.4%) and 0.0060 (0.6%)). NEVER allow stopLossPct to exceed 0.7x of takeProfitPct.

PARAMETER REFERENCE:
1. obiThreshold: [0.12 to 0.40] - Imbalance sensitivity. Higher means more selective entry.
2. zScoreThreshold: [0.6 to 1.8] - Mean-reversion trigger depth. Higher means waiting for a deeper market pullback before entry.
3. takeProfitPct: [0.0020 to 0.0200] (0.20% to 2.0%) - Hard profit target.
4. stopLossPct: [0.0010 to 0.0120] (0.10% to 1.20%) - Stop loss. MUST be 0.4x to 0.6x of takeProfitPct.

OUTPUT FORMAT:
Return ONLY a valid, raw JSON object matching the exact schema below. Do not output markdown code fences, do not write explanations outside JSON, do not add text before or after the JSON.

REQUIRED JSON SCHEMA:
{
  "parameters": {
    "SYMBOL": { "obiThreshold": number, "zScoreThreshold": number, "takeProfitPct": number, "stopLossPct": number }
  },
  "analysis": {
    "SYMBOL": { 
      "bias": "BULLISH" | "BEARISH" | "NEUTRAL", 
      "confidence": number, 
      "rationale": "Provide a very concise quantitative rationale in INDONESIAN explaining the trend (e.g., 'Tren bulanan s.d. 5m BULLISH kuat, parameter disesuaikan'). Keep it under 15 words." 
    }
  }
}

Example Response:
{
  "parameters": {
    "BTC": { "obiThreshold": 0.22, "zScoreThreshold": 0.85, "takeProfitPct": 0.0045, "stopLossPct": 0.0025 }
  },
  "analysis": {
    "BTC": { "bias": "BULLISH", "confidence": 85, "rationale": "Tren makro mingguan dan harian BULLISH kuat, sementara tren mikro menunjukkan koreksi jangka pendek. Mengunci bias BULLISH dan merapatkan SL ke 0.55x dari TP untuk mempertahankan rasio R:R yang optimal." }
  }
}`;

    // Build a long-term summary per symbol from the entire trade history
    const longTermStatsPerSymbol: Record<string, any> = {};
    for (const symbol of activeSymbols) {
      const symbolTrades = recentTrades.filter(t => t.symbol === symbol);
      if (symbolTrades.length > 0) {
        const wins = symbolTrades.filter(t => t.result === 'WIN').length;
        const total = symbolTrades.length;
        const netProfit = symbolTrades.reduce((sum, t) => sum + t.netProfitUsd, 0);
        longTermStatsPerSymbol[symbol] = {
          allTimeTradesCount: total,
          allTimeWinRate: `${((wins / total) * 100).toFixed(1)}%`,
          allTimeNetProfitUsd: parseFloat(netProfit.toFixed(4))
        };
      } else {
        longTermStatsPerSymbol[symbol] = {
          allTimeTradesCount: 0,
          allTimeWinRate: '0.0%',
          allTimeNetProfitUsd: 0
        };
      }
    }

    const summarizedCandles: Record<string, Record<string, { close: number; changePct: string; trend: string }>> = {};
    for (const [symbol, timeframesData] of Object.entries(candleData)) {
      summarizedCandles[symbol] = {};
      for (const [tf, candles] of Object.entries(timeframesData)) {
        if (!candles || candles.length === 0) {
          summarizedCandles[symbol][tf] = { close: 0, changePct: '0.00%', trend: 'NEUTRAL' };
          continue;
        }
        const latestCandle = candles[candles.length - 1];
        const oldestCandle = candles[0];
        const latestClose = latestCandle.close;
        const oldestOpen = oldestCandle.open;
        
        const changePct = oldestOpen !== 0 ? ((latestClose - oldestOpen) / oldestOpen) * 100 : 0;
        let trend = 'NEUTRAL';
        if (changePct > 0.05) trend = 'BULLISH';
        else if (changePct < -0.05) trend = 'BEARISH';
        
        summarizedCandles[symbol][tf] = {
          close: parseFloat(latestClose.toFixed(4)),
          changePct: `${changePct.toFixed(2)}%`,
          trend
        };
      }
    }

    const userPrompt = {
      allTimeStats: {
        totalTrades: stats.totalTrades,
        winningTrades: stats.winningTrades,
        losingTrades: stats.losingTrades,
        winRate: `${stats.winRate.toFixed(2)}%`,
        netProfitUsd: parseFloat(stats.netProfitUsd.toFixed(4)),
        totalFeesUsd: parseFloat(stats.totalFeesUsd.toFixed(4))
      },
      currentParameters: paramsSnapshot,
      allTimePerformancePerCoin: longTermStatsPerSymbol,
      recentTradesMicroContext: subsetTrades, // last 15 trades
      symbolsToOptimize: activeSymbols,
      multiTimeframeCandles: summarizedCandles // Summarized trend data for each symbol
    };

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          model: modelOverride || this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(userPrompt, null, 2) }
          ],
          max_tokens: 4096, // Expanded to accommodate full multi-symbol payload without truncation
          temperature: 0.2
        }),
        signal: AbortSignal.timeout(35000)
      });

      if (!response.ok) {
        console.error(`[NVIDIA OBSERVER] API Error: ${response.status} ${response.statusText}`);
        return null;
      }

      const responseBody = (await response.json()) as any;
      const content = responseBody.choices?.[0]?.message?.content?.trim();

      if (!content) {
        console.error('[NVIDIA OBSERVER] Empty response content from API.');
        return null;
      }

      // Strip markdown code fences if Llama wrapped the output in ```json ... ```
      let cleanedJson = content;
      if (cleanedJson.includes('```')) {
        const matches = cleanedJson.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (matches && matches[1]) {
          cleanedJson = matches[1].trim();
        }
      }

      const parsed: NvidiaObserverResponse = JSON.parse(cleanedJson);
      if (!parsed.parameters || !parsed.analysis) {
        console.error('[NVIDIA OBSERVER] Received JSON missing required properties.', parsed);
        return null;
      }
      return parsed;

    } catch (err: any) {
      console.error(`[NVIDIA OBSERVER] Dynamic parameter optimization failed gracefully: ${err.message}`);
      return null;
    }
  }
}
