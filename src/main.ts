import fs from 'fs';
import path from 'path';
import { ExchangeConnector } from './exchange.js';
import { StrategyManager } from './strategy.js';
import { ExecutionEngine } from './execution.js';
import { WebDashboardServer } from './server.js';
import { CONFIG } from './config.js';
import { NvidiaObserver } from './nvidia.js';
import { GeminiObserver } from './gemini.js';


// Setup file debug logging to bypass console.clear() wiping diagnostic history
const logFilePath = path.join(process.cwd(), 'hft_debug.log');
fs.writeFileSync(logFilePath, `[SYSTEM] --- HFT Bot Startup Debug Log | ${new Date().toISOString()} ---\n`);

function logDebug(message: string) {
  const time = new Date().toLocaleTimeString();
  const logMsg = `[${time}] ${message}\n`;
  fs.appendFileSync(logFilePath, logMsg);
}

// Global Exception Catching to record silent failures
process.on('uncaughtException', (err) => {
  logDebug(`CRITICAL UNCAUGHT EXCEPTION: ${err.message}\nStack: ${err.stack}`);
  console.error('CRITICAL UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  logDebug(`CRITICAL UNHANDLED REJECTION: ${reason?.message || reason}`);
  console.error('CRITICAL UNHANDLED REJECTION:', reason);
});

async function main() {
  logDebug('Initializing Multi-Model HFT Bot...');

  // 1. Initialize core system components
  const exchange = new ExchangeConnector();
  const nvidiaObserver = new NvidiaObserver();
const geminiObserver = new GeminiObserver();

  // Create strategy manager and execution engine instances for each configured model
  const models: Record<string, { strategy: StrategyManager; execution: ExecutionEngine }> = {};
  const latestAiInsights: Record<string, any> = {};

  for (const modelId of Object.keys(CONFIG.MODELS)) {
    models[modelId] = {
      strategy: new StrategyManager(),
      execution: new ExecutionEngine(modelId, exchange)
    };
    latestAiInsights[modelId] = {};
  }
  
  // 2. Start the Premium Real-time HTML Dashboard server on port 3000
  const dashboardServer = new WebDashboardServer(10001);

  // Load system active status from persistent file system_state.json
  let isTradingActive = true;
  const stateFilePath = path.join(process.cwd(), 'system_state.json');
  try {
    if (fs.existsSync(stateFilePath)) {
      const stateData = fs.readFileSync(stateFilePath, 'utf-8');
      const parsedState = JSON.parse(stateData);
      isTradingActive = parsedState.isTradingActive !== false;
      logDebug(`[SYSTEM STATE] Hydrated isTradingActive = ${isTradingActive} from system_state.json`);
    }
  } catch (err: any) {
    logDebug(`[SYSTEM STATE] Error reading state file: ${err.message}`);
  }

  // Helper to send real-time states to browser dashboard
  const lastKnownPrices: Record<string, { bid: number; ask: number }> = {};

  const sendDashboardUpdate = () => {
    const payload: Record<string, any> = {};

    for (const [modelId, model] of Object.entries(models)) {
      const mappedPositions = model.execution.getActivePositions().map(p => {
        const lastPrice = lastKnownPrices[p.symbol];
        const currentPrice = lastPrice ? (p.side === 'BUY' ? lastPrice.bid : lastPrice.ask) : p.entryPrice;
        
        let floatingPnlPct = 0;
        let floatingPnlUsd = 0;
        
        if (p.side === 'BUY') {
          floatingPnlPct = (currentPrice - p.entryPrice) / p.entryPrice;
          floatingPnlUsd = (currentPrice - p.entryPrice) * p.quantity;
        } else {
          floatingPnlPct = (p.entryPrice - currentPrice) / p.entryPrice;
          floatingPnlUsd = (p.entryPrice - currentPrice) * p.quantity;
        }

        return {
          ...p,
          floatingPnlPct,
          floatingPnlUsd
        };
      });

      payload[modelId] = {
        stats: model.execution.getStats(),
        activePositions: mappedPositions,
        tradesHistory: model.execution.getTradesHistory(),
        aiInsights: latestAiInsights[modelId] || {}
      };
    }

    dashboardServer.broadcastUpdate({
      models: payload,
      isTradingActive
    });
  };

  // Register dashboard status toggle WebSocket callback
  dashboardServer.registerToggleStatusCallback(() => {
    isTradingActive = !isTradingActive;
    logDebug(`[SYSTEM STATE] Toggle request received. isTradingActive is now: ${isTradingActive}`);
    try {
      fs.writeFileSync(stateFilePath, JSON.stringify({ isTradingActive }, null, 2), 'utf-8');
    } catch (err: any) {
      logDebug(`[SYSTEM STATE] Error writing state file: ${err.message}`);
    }
    // Instantly push update to refresh UI
    sendDashboardUpdate();
  });

  // 2b. Listen to browser manual position close signals
  dashboardServer.registerManualCloseCallback((modelId, symbol) => {
    logDebug(`[MANUAL CLOSE] Browser requested close for model ${modelId} symbol ${symbol}`);
    const model = models[modelId];
    if (!model) {
      logDebug(`[MANUAL CLOSE] Failed: Model ${modelId} not found.`);
      return;
    }

    const activePositions = model.execution.getActivePositions();
    const position = activePositions.find(p => p.symbol === symbol);
    if (!position) {
      logDebug(`[MANUAL CLOSE] Failed: No active position for model ${modelId} in ${symbol}`);
      return;
    }

    const lastPrice = lastKnownPrices[symbol];
    const exitPrice = lastPrice 
      ? (position.side === 'BUY' ? lastPrice.bid : lastPrice.ask) 
      : position.entryPrice;

    model.execution.forceClosePosition(symbol, exitPrice, 'MANUAL CLOSE FROM DASHBOARD');
    logDebug(`[MANUAL CLOSE] Model ${modelId} Position ${symbol} closed at market price ${exitPrice}`);
    
    // Instantly push update to refresh UI
    sendDashboardUpdate();
  });

  let tickCount = 0;
  const symbolTickCounts: Record<string, number> = {};
  
  // Global BTC EMA tracking for macro trend
  const btcMacroState: { ema: number | null; lastUpdate: number } = { ema: null, lastUpdate: 0 };

  // 3. Set up live WebSocket order book updates
  exchange.onBookUpdate((book) => {
    tickCount++;
    symbolTickCounts[book.symbol] = (symbolTickCounts[book.symbol] || 0) + 1;

    // Flash the live browser LED indicator
    dashboardServer.broadcastTick();

    const bestBid = book.bids[0][0];
    const bestAsk = book.asks[0][0];

    // Update BTC macro trend EMA globally
    if (book.symbol === 'BTC') {
      const midPrice = (bestBid + bestAsk) / 2;
      const emaPeriod = CONFIG.EMA_FAST_PERIOD;
      const k = 2 / (emaPeriod + 1);
      if (btcMacroState.ema === null) {
        btcMacroState.ema = midPrice;
      } else {
        btcMacroState.ema = midPrice * k + btcMacroState.ema * (1 - k);
      }
      const trend = midPrice > btcMacroState.ema ? 'BULLISH' : midPrice < btcMacroState.ema ? 'BEARISH' : 'NEUTRAL';
      
      // Update macro trends for all models
      for (const model of Object.values(models)) {
        model.strategy.setMacroTrends({ BTC: trend });
      }
      
      if (tickCount % 500 === 0) {
        logDebug(`[MACRO TREND] BTC ${trend} (mid=${midPrice.toFixed(2)} ema=${btcMacroState.ema.toFixed(2)})`);
      }
    }

    // Cache the latest bid and ask prices for this symbol
    lastKnownPrices[book.symbol] = { bid: bestBid, ask: bestAsk };

    // Log the first few ticks to confirm ingestion is fully working
    if (tickCount <= 10 || tickCount % 1000 === 0) {
      logDebug(`WS Packet Ingested #${tickCount} | Symbol: ${book.symbol} | Bid: ${bestBid} | Ask: ${bestAsk}`);
    }

    // Process tick for all models
    for (const [modelId, model] of Object.entries(models)) {
      try {
        // A. Evaluate active position exits on tick level (real-time risk management)
        model.execution.evaluatePositions(book.symbol, bestBid, bestAsk);

        // B. Process tick in quantitative strategy to check for entry signals
        const signal = model.strategy.processTick(book);
        
        // C. If an entry signal is generated, execute it immediately
        if (signal) {
          if (!isTradingActive) {
            continue;
          }
          logDebug(`[SIGNAL GENERATED] [${modelId}] ${signal.symbol} | ${signal.side} | Price: ${signal.price} | Reason: ${signal.reason}`);
          model.execution.executeSignal(signal).then(() => {
            // Immediately update browser UI upon entry execution
            sendDashboardUpdate();
          });
        }
      } catch (err: any) {
        logDebug(`ERROR in strategy or execution tick processing for ${modelId}: ${err.message}`);
      }
    }

    // Dynamic browser throttle: send general updates every 5 ticks to keep UI smooth and fluid
    if (tickCount % 5 === 0) {
      sendDashboardUpdate();
    }
  });

  // 4. Connect to the WebSocket stream
  try {
    logDebug('Connecting to Hyperliquid WebSocket...');
    exchange.connect();
    logDebug('WS Connection initiated successfully.');
  } catch (err: any) {
    logDebug(`Connection error on startup: ${err.message}`);
    process.exit(1);
  }

  // 5. Set up periodic dashboard redrawing and Safeguard Position Evaluator (once per second)
  const dashboardInterval = setInterval(() => {
    
    // Proactive Safeguard Evaluator for each model
    for (const [modelId, model] of Object.entries(models)) {
      const activePositions = model.execution.getActivePositions();
      for (const pos of activePositions) {
        const lastPrice = lastKnownPrices[pos.symbol];
        if (lastPrice) {
          model.execution.evaluatePositions(pos.symbol, lastPrice.bid, lastPrice.ask);
        }
      }
    }

    // Render consolidated dashboard to console
    console.clear();
    console.log('\x1b[35m================================================================================\x1b[0m');
    console.log('\x1b[1m\x1b[33m               ANTIGRAVITY MULTI-MODEL HFT TRADING SYSTEMS                     \x1b[0m');
    console.log(`\x1b[37m Running Mode   : ${CONFIG.SIMULATION_MODE ? 'LIVE SIMULATION (Safe)' : 'LIVE TRADING (Real API)'}\x1b[0m`);
    console.log(`\x1b[37m Engine Status  : ${isTradingActive ? '\x1b[32mACTIVE\x1b[37m' : '\x1b[31mPAUSED\x1b[37m'} | Ticks Processed: ${tickCount}\x1b[0m`);
    console.log('\x1b[35m================================================================================\x1b[0m');
    console.log('\x1b[1m Model Performance Overview:\x1b[0m');
    console.log('--------------------------------------------------------------------------------');
    console.log('  Model ID       | Net Profit  | Win Rate | Trades | Active Pos');
    console.log('--------------------------------------------------------------------------------');
    for (const [modelId, model] of Object.entries(models)) {
      const stats = model.execution.getStats();
      const activeCount = model.execution.getActivePositions().length;
      const netProfitStr = `${stats.netProfitUsd >= 0 ? '+' : ''}$${stats.netProfitUsd.toFixed(4)}`;
      const pnlColor = stats.netProfitUsd >= 0 ? '\x1b[32m' : '\x1b[31m';
      const wrColor = stats.winRate >= 70 ? '\x1b[32m' : stats.winRate >= 50 ? '\x1b[33m' : '\x1b[31m';
      
      const modelPadded = modelId.padEnd(16);
      const profitPadded = `${pnlColor}${netProfitStr.padEnd(11)}\x1b[0m`;
      const wrPadded = `${wrColor}${stats.winRate.toFixed(2)}%\x1b[0m`.padEnd(19);
      const tradesPadded = stats.totalTrades.toString().padEnd(6);
      
      console.log(`  ${modelPadded} | ${profitPadded} | ${wrPadded} | ${tradesPadded} | ${activeCount}`);
    }
    console.log('\x1b[35m================================================================================\x1b[0m');
    console.log(`\x1b[90m Active Markets Ingesting: [${Object.keys(symbolTickCounts).join(', ')}]\x1b[0m`);
    console.log(`\x1b[90m Web Dashboard URL         : http://localhost:10001/\x1b[0m`);
    console.log(`\x1b[90m Diagnostic log written to : ${logFilePath}\x1b[0m`);
    console.log('\x1b[35m================================================================================\x1b[0m');
  }, 1000);

  // 5b. Dynamic AI Parameter Optimizer Loop (Every 3 minutes)
  const runParameterOptimization = async () => {
    logDebug('Triggering dynamic AI parameter optimization for all active models...');
    const activeSymbols = Object.keys(CONFIG.SYMBOLS);
    const timeframes = ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];
    const candleData: Record<string, Record<string, any[]>> = {};

    logDebug('Fetching multi-timeframe candles from Hyperliquid in parallel...');
    
    // Initialize structure
    for (const symbol of activeSymbols) {
      candleData[symbol] = {};
    }

    try {
      const fetchPromises: Promise<void>[] = [];
      for (const symbol of activeSymbols) {
        for (const tf of timeframes) {
          fetchPromises.push(
            exchange.getCandleSnapshot(symbol, tf, 10).then(candles => {
              candleData[symbol][tf] = candles;
            }).catch(err => {
              logDebug(`Error fetching candles for ${symbol} (${tf}): ${err.message}`);
              candleData[symbol][tf] = [];
            })
          );
        }
      }
      await Promise.all(fetchPromises);
      logDebug('Successfully fetched all multi-timeframe candles.');
    } catch (err: any) {
      logDebug(`Error during parallel candle fetching: ${err.message}`);
    }

    // Run optimization for each AI-configured model in CONFIG.MODELS in parallel
    const optimizationPromises = Object.entries(CONFIG.MODELS).map(async ([modelId, modelConf]) => {
      // If it's static, skip AI optimization
      if (modelConf.modelTag === 'static') {
        return;
      }
      
      const model = models[modelId];
      if (!model) return;

      try {
        logDebug(`[AI OPTIMIZER] [${modelId}] Calling NVIDIA API for model tag: ${modelConf.modelTag}`);
        const currentParams = model.strategy.getAllParams();

        let optimized = null;
        if (modelConf.modelTag === 'gemini-pro') {
          optimized = await geminiObserver.optimizeParameters(
            model.execution.getStats(),
            model.execution.getTradesHistory(),
            activeSymbols,
            candleData,
            modelConf.modelTag,
            currentParams
          );
        } else {
          optimized = await nvidiaObserver.optimizeParameters(
            model.execution.getStats(),
            model.execution.getTradesHistory(),
            activeSymbols,
            candleData,
            modelConf.modelTag,
            currentParams
          );
        }

        if (optimized && optimized.parameters) {
          logDebug(`[AI OPTIMIZER] [${modelId}] Received parameters shift: ${JSON.stringify(optimized.parameters)}`);
          
          latestAiInsights[modelId] = optimized.analysis || {};
          model.strategy.setAiBiases(latestAiInsights[modelId]);

          for (const [symbol, params] of Object.entries(optimized.parameters)) {
            model.strategy.updateParams(symbol, params as any);
            logDebug(`[AI OPTIMIZER] [${modelId}] Applied updated params for ${symbol}: OBI=${params.obiThreshold}, Z=${params.zScoreThreshold}, TP=${((params.takeProfitPct || 0)*100).toFixed(2)}%, SL=${((params.stopLossPct || 0)*100).toFixed(2)}%`);
          }
        }
      } catch (err: any) {
        logDebug(`Error optimizing model ${modelId}: ${err.message}`);
      }
    });

    await Promise.all(optimizationPromises);
    logDebug('Finished parallel parameter optimizations.');
    
    // Instantly push update to refresh UI with AI reasons
    sendDashboardUpdate();
  };

  const aiOptimizationInterval = setInterval(runParameterOptimization, 180000);
  
  // Warm start AI check: trigger the first optimization after 10 seconds of active trade monitoring
  const warmStartTimeout = setTimeout(() => {
    runParameterOptimization().catch(err => {
      logDebug(`Error during warm-start AI optimization: ${err.message}`);
    });
  }, 10000);


  // 6. Handle Graceful Shutdown
  const shutdown = () => {
    clearInterval(dashboardInterval);
    clearInterval(aiOptimizationInterval);
    clearTimeout(warmStartTimeout);
    dashboardServer.close();

    logDebug('Shutdown signal received. Finalizing log.');
    console.log('\n\x1b[33m[SYSTEM] Shutdown signal received. Cleaning up resources...\x1b[0m');
    console.log('\x1b[36m================================================================================\x1b[0m');
    console.log('\x1b[1m\x1b[32m                        FINAL HFT TRADING SESSION SUMMARY                       \x1b[0m');
    console.log('\x1b[36m================================================================================\x1b[0m');
    for (const [modelId, model] of Object.entries(models)) {
      console.log(`\n\x1b[1m[MODEL: ${modelId}]\x1b[0m`);
      model.execution.renderDashboard();
    }
    console.log('\x1b[32m[SYSTEM] Safely offline. Goodbye!\x1b[0m');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Execute the async main entry point
main().catch((err) => {
  logDebug(`Unhandled critical error in main runner: ${err.message}`);
  process.exit(1);
});
