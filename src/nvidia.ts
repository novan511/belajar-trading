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
    activeSymbols: string[]
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

    // Build current parameters snapshot to give LLM a reference point
    const currentParamsSnapshot: Record<string, any> = {};
    for (const symbol of activeSymbols) {
      const symConf = (CONFIG.SYMBOLS as any)[symbol];
      if (symConf) {
        currentParamsSnapshot[symbol] = {
          obiThreshold: symConf.obiThreshold,
          zScoreThreshold: symConf.zScoreThreshold,
          takeProfitPct: symConf.takeProfitPct,
          stopLossPct: symConf.stopLossPct
        };
      }
    }

    const systemPrompt = `You are a quantitative strategist AI Observer for an in-memory sub-second high-frequency trading (HFT) bot.
Your role is to analyze trading session results, determine market bias/tension per coin, and optimize parameters dynamically for the next trading window.

PARAMETER REFERENCE:
1. obiThreshold: [0.10 to 0.40] - Imbalance sensitivity. Higher means more selective entry.
2. zScoreThreshold: [0.5 to 1.8] - Mean-reversion trigger depth. Higher means waiting for a deeper market pullback before entry.
3. takeProfitPct: [0.0020 to 0.0200] (0.20% to 2.0%) - Hard profit target.
4. stopLossPct: [0.0015 to 0.0150] (0.15% to 1.5%) - Absolute stop loss. Usually set at 0.5x to 0.8x of takeProfitPct.

STRATEGY ADJUSTMENT RATIONALE:
- If a symbol has a high win rate (>70%) and positive net USD, keep parameters stable or slightly widen takeProfitPct to ride larger swings.
- If a symbol has a low win rate (<50%) or negative P&L, it is likely executing mean-reversion entries in a strong trending market (causes stop losses). Widen thresholds (increase obiThreshold by +0.02 to +0.05, increase zScoreThreshold by +0.1 to +0.3) to make entries highly selective, and widen stopLossPct/takeProfitPct slightly to bypass short-term noise.
- ALWAYS optimize parameters dynamically for each symbol in the request.

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
      "rationale": "Provide a concise 1-2 sentence quantitative reason in INDONESIAN explaining the parameters adjustment based on recent trades or lack thereof." 
    }
  }
}

Example Response:
{
  "parameters": {
    "BTC": { "obiThreshold": 0.22, "zScoreThreshold": 0.85, "takeProfitPct": 0.0045, "stopLossPct": 0.0035 },
    "ETH": { "obiThreshold": 0.25, "zScoreThreshold": 0.90, "takeProfitPct": 0.0050, "stopLossPct": 0.0040 }
  },
  "analysis": {
    "BTC": { "bias": "BULLISH", "confidence": 85, "rationale": "Performa trading BTC sangat kuat dengan win rate tinggi. Parameter dijaga ketat dengan sedikit memperlebar takeProfit untuk mengoptimalkan profit run." },
    "ETH": { "bias": "BEARISH", "confidence": 65, "rationale": "Mengalami kerugian beruntun akibat tren turun yang kuat. Meningkatkan ambang batas OBI dan Z-Score agar kriteria entri menjadi jauh lebih selektif." }
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

    const userPrompt = {
      allTimeStats: {
        totalTrades: stats.totalTrades,
        winningTrades: stats.winningTrades,
        losingTrades: stats.losingTrades,
        winRate: `${stats.winRate.toFixed(2)}%`,
        netProfitUsd: parseFloat(stats.netProfitUsd.toFixed(4)),
        totalFeesUsd: parseFloat(stats.totalFeesUsd.toFixed(4))
      },
      currentParameters: currentParamsSnapshot,
      allTimePerformancePerCoin: longTermStatsPerSymbol,
      recentTradesMicroContext: subsetTrades, // last 15 trades
      symbolsToOptimize: activeSymbols
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
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(userPrompt, null, 2) }
          ],
          max_tokens: 1800, // Slightly expanded to accommodate rationales
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
