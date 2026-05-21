import dotenv from 'dotenv';
dotenv.config();

import { NvidiaObserver } from '../src/nvidia.js';
import { ExchangeConnector } from '../src/exchange.js';
import { CONFIG } from '../src/config.js';
import { ExecutionStats, TradeRecord } from '../src/types.js';

const observer = new NvidiaObserver();
const exchange = new ExchangeConnector();

const mockStats: ExecutionStats = {
  totalTrades: 10,
  winningTrades: 7,
  losingTrades: 3,
  winRate: 70.0,
  grossProfitUsd: 11.1547, // netProfit + totalFees
  netProfitUsd: 8.7544,
  totalFeesUsd: 2.4003,
  averageHoldTimeSec: 0
};

const mockTrades: TradeRecord[] = [];

async function run() {
  console.log('Fetching live candle snapshot for all symbols...');
  const activeSymbols = Object.keys(CONFIG.SYMBOLS);
  const timeframes = ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];
  const candleData: Record<string, Record<string, any[]>> = {};

  for (const symbol of activeSymbols) {
    candleData[symbol] = {};
  }

  const fetchPromises: Promise<void>[] = [];
  for (const symbol of activeSymbols) {
    for (const tf of timeframes) {
      fetchPromises.push(
        exchange.getCandleSnapshot(symbol, tf, 10).then(candles => {
          candleData[symbol][tf] = candles;
        }).catch(err => {
          console.error(`Error fetching candles for ${symbol} (${tf}):`, err.message);
        })
      );
    }
  }
  await Promise.all(fetchPromises);
  console.log('Candles fetched successfully. Invoking Llama 3.1 8B...');

  const apiKey = process.env.NVIDIA_API_KEY || '';
  const subsetTrades = mockTrades.slice(-15);
  
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
}`;

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
    allTimeStats: mockStats,
    currentParameters: currentParamsSnapshot,
    allTimePerformancePerCoin: {},
    recentTradesMicroContext: subsetTrades,
    symbolsToOptimize: activeSymbols,
    multiTimeframeCandles: summarizedCandles
  };

  const payload = {
    model: 'meta/llama-3.1-8b-instruct',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(userPrompt) }
    ],
    max_tokens: 4096,
    temperature: 0.2
  };

  console.log('Sending request to Nvidia API, payload size:', JSON.stringify(payload).length, 'bytes');

  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    console.log('Response Status:', response.status, response.statusText);
    const body = await response.text();
    console.log('Response Body snippet (first 1000 chars):', body.substring(0, 1000));
    console.log('Response Body snippet (last 500 chars):', body.substring(body.length - 500));
  } catch (err: any) {
    console.error('Error sending optimization request:', err.message);
  }
}

run();
