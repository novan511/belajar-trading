import { CONFIG } from './config.js';
import { ExecutionStats, TradeRecord } from './types.js';

export interface GeminiObserverResponse {
  parameters: Record<string, { obiThreshold: number; zScoreThreshold: number; takeProfitPct: number; stopLossPct: number }>;
  analysis: Record<string, { bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; confidence: number; rationale: string }>;
}

export class GeminiObserver {
  private apiKey: string;
  private endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';
  private model = 'gemini-pro';

  constructor() {
    this.apiKey = CONFIG.GEMINI_API_KEY || '';
    if (!this.apiKey) {
      console.warn('\x1b[33m[GeminiObserver] Warning: GEMINI_API_KEY is not set. Gemini integration will be disabled.\x1b[0m');
    }
  }

  /**
   * Calls Gemini Pro to generate optimized parameters and analysis.
   * Returns null on failure.
   */
  public async optimizeParameters(
    stats: ExecutionStats,
    recentTrades: TradeRecord[],
    activeSymbols: string[],
    candleData: Record<string, Record<string, any[]>>, // same shape as NvidiaObserver receives
    modelOverride?: string,
    currentParamsSnapshot?: Record<string, any>
  ): Promise<GeminiObserverResponse | null> {
    if (!this.apiKey) return null;

    // Build a concise user prompt similar to NvidiaObserver but tailored for Gemini
    const systemPrompt = `You are a quantitative strategist AI. Analyze the provided multi‑timeframe candle data, recent trade outcomes, and current parameters for each symbol. Return ONLY a JSON object matching the schema:
{ "parameters": { "SYMBOL": { "obiThreshold": number, "zScoreThreshold": number, "takeProfitPct": number, "stopLossPct": number } }, "analysis": { "SYMBOL": { "bias": "BULLISH" | "BEARISH" | "NEUTRAL", "confidence": number, "rationale": string } } }`;

    const userPrompt = { stats, recentTrades, activeSymbols, candleData, currentParamsSnapshot };

    const payload = {
      contents: [
        { role: 'user', parts: [{ text: `${systemPrompt}\n\n${JSON.stringify(userPrompt, null, 2)}` }] }
      ]
    };

    try {
      const response = await fetch(`${this.endpoint}?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(35000)
      });

      if (!response.ok) {
        console.error(`[GeminiObserver] API error ${response.status}: ${response.statusText}`);
        return null;
      }

      const data = await response.json();
      // Gemini returns candidates[0].content.parts[0].text
      const content = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!content) {
        console.error('[GeminiObserver] Empty response content');
        return null;
      }

      // Strip possible markdown fences
      let cleaned = content;
      if (cleaned.includes('```')) {
        const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (match && match[1]) cleaned = match[1].trim();
      }

      const parsed: GeminiObserverResponse = JSON.parse(cleaned);
      if (!parsed.parameters || !parsed.analysis) {
        console.error('[GeminiObserver] Missing required fields in response');
        return null;
      }
      return parsed;
    } catch (err: any) {
      console.error(`[GeminiObserver] Failed: ${err.message}`);
      return null;
    }
  }
}
