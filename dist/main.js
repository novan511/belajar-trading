import fs from 'fs';
import path from 'path';
import { ExchangeConnector } from './exchange.js';
import { StrategyManager } from './strategy.js';
import { ExecutionEngine } from './execution.js';
import { WebDashboardServer } from './server.js';
import { CONFIG } from './config.js';
import { NvidiaObserver } from './nvidia.js';
// Setup file debug logging to bypass console.clear() wiping diagnostic history
const logFilePath = path.join(process.cwd(), 'hft_debug.log');
fs.writeFileSync(logFilePath, `[SYSTEM] --- HFT Bot Startup Debug Log | ${new Date().toISOString()} ---\n`);
function logDebug(message) {
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
process.on('unhandledRejection', (reason) => {
    logDebug(`CRITICAL UNHANDLED REJECTION: ${reason?.message || reason}`);
    console.error('CRITICAL UNHANDLED REJECTION:', reason);
});
async function main() {
    logDebug('Initializing High-Frequency Trading Bot...');
    // 1. Initialize core system components
    const exchange = new ExchangeConnector();
    const strategy = new StrategyManager();
    const execution = new ExecutionEngine(exchange);
    const nvidiaObserver = new NvidiaObserver();
    // 2. Start the Premium Real-time HTML Dashboard server on port 3000
    const dashboardServer = new WebDashboardServer(3000);
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
    }
    catch (err) {
        logDebug(`[SYSTEM STATE] Error reading state file: ${err.message}`);
    }
    // Register dashboard status toggle WebSocket callback
    dashboardServer.registerToggleStatusCallback(() => {
        isTradingActive = !isTradingActive;
        logDebug(`[SYSTEM STATE] Toggle request received. isTradingActive is now: ${isTradingActive}`);
        try {
            fs.writeFileSync(stateFilePath, JSON.stringify({ isTradingActive }, null, 2), 'utf-8');
        }
        catch (err) {
            logDebug(`[SYSTEM STATE] Error writing state file: ${err.message}`);
        }
        // Instantly push update to refresh UI
        sendDashboardUpdate();
    });
    let tickCount = 0;
    const symbolTickCounts = {};
    // Keep track of the last known price packets for active safeguard evaluations
    const lastKnownPrices = {};
    let latestAiInsights = {};
    // Helper to send real-time states to browser dashboard
    const sendDashboardUpdate = () => {
        const mappedPositions = execution.getActivePositions().map(p => {
            const lastPrice = lastKnownPrices[p.symbol];
            const currentPrice = lastPrice ? (p.side === 'BUY' ? lastPrice.bid : lastPrice.ask) : p.entryPrice;
            let floatingPnlPct = 0;
            let floatingPnlUsd = 0;
            if (p.side === 'BUY') {
                floatingPnlPct = (currentPrice - p.entryPrice) / p.entryPrice;
                floatingPnlUsd = (currentPrice - p.entryPrice) * p.quantity;
            }
            else {
                floatingPnlPct = (p.entryPrice - currentPrice) / p.entryPrice;
                floatingPnlUsd = (p.entryPrice - currentPrice) * p.quantity;
            }
            return {
                ...p,
                floatingPnlPct,
                floatingPnlUsd
            };
        });
        dashboardServer.broadcastUpdate({
            stats: execution.getStats(),
            activePositions: mappedPositions,
            tradesHistory: execution.getTradesHistory(),
            aiInsights: latestAiInsights,
            isTradingActive
        });
    };
    // 2b. Listen to browser manual position close signals
    dashboardServer.registerManualCloseCallback((symbol) => {
        logDebug(`[MANUAL CLOSE] Browser requested close for ${symbol}`);
        const activePositions = execution.getActivePositions();
        const position = activePositions.find(p => p.symbol === symbol);
        if (!position) {
            logDebug(`[MANUAL CLOSE] Failed: No active position in ${symbol}`);
            return;
        }
        const lastPrice = lastKnownPrices[symbol];
        const exitPrice = lastPrice
            ? (position.side === 'BUY' ? lastPrice.bid : lastPrice.ask)
            : position.entryPrice;
        execution.forceClosePosition(symbol, exitPrice, 'MANUAL CLOSE FROM DASHBOARD');
        logDebug(`[MANUAL CLOSE] Position ${symbol} closed at market price ${exitPrice}`);
        // Instantly push update to refresh UI
        sendDashboardUpdate();
    });
    // 3. Set up live WebSocket order book updates
    exchange.onBookUpdate((book) => {
        tickCount++;
        symbolTickCounts[book.symbol] = (symbolTickCounts[book.symbol] || 0) + 1;
        // Flash the live browser LED indicator
        dashboardServer.broadcastTick();
        // Cache the latest bid and ask prices for this symbol
        const bestBid = book.bids[0][0];
        const bestAsk = book.asks[0][0];
        lastKnownPrices[book.symbol] = { bid: bestBid, ask: bestAsk };
        // Log the first few ticks to confirm ingestion is fully working
        if (tickCount <= 10 || tickCount % 500 === 0) {
            logDebug(`WS Packet Ingested #${tickCount} | Symbol: ${book.symbol} | Bid: ${bestBid} | Ask: ${bestAsk}`);
        }
        // A. Evaluate active position exits on tick level (real-time risk management)
        execution.evaluatePositions(book.symbol, bestBid, bestAsk);
        // B. Process tick in quantitative strategy to check for entry signals
        try {
            const signal = strategy.processTick(book);
            // C. If an entry signal is generated, execute it immediately
            if (signal) {
                if (!isTradingActive) {
                    if (tickCount % 200 === 0) {
                        logDebug(`[SYSTEM STATE] Signal generated for ${signal.symbol} but ignored because HFT system is PAUSED.`);
                    }
                    return;
                }
                logDebug(`[SIGNAL GENERATED] ${signal.symbol} | ${signal.side} | Price: ${signal.price} | Reason: ${signal.reason}`);
                execution.executeSignal(signal).then(() => {
                    // Immediately update browser UI upon entry execution
                    sendDashboardUpdate();
                });
            }
        }
        catch (err) {
            logDebug(`ERROR in strategy or execution tick processing: ${err.message}`);
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
    }
    catch (err) {
        logDebug(`Connection error on startup: ${err.message}`);
        process.exit(1);
    }
    // 5. Set up periodic dashboard redrawing and Safeguard Position Evaluator (once per second)
    const dashboardInterval = setInterval(() => {
        // Proactive Safeguard Evaluator: force position risk evaluation using cached prices 
        // to handle slow-ticking assets like MANTA networks or during low liquidity periods.
        const activePositions = execution.getActivePositions();
        for (const pos of activePositions) {
            const lastPrice = lastKnownPrices[pos.symbol];
            if (lastPrice) {
                execution.evaluatePositions(pos.symbol, lastPrice.bid, lastPrice.ask);
            }
        }
        execution.renderDashboard();
        // Inject a live heartbeat directly into the dashboard output
        console.log(`\x1b[36m Heartbeat  : Active \x1b[0m`);
        console.log(`\x1b[36m Tick Count : ${tickCount} live price packets processed\x1b[0m`);
        console.log(`\x1b[90m Active Markets Ingesting: [${Object.keys(symbolTickCounts).join(', ')}]\x1b[0m`);
        console.log(`\x1b[90m Web Dashboard URL         : http://localhost:3000/\x1b[0m`);
        console.log(`\x1b[90m Diagnostic log written to : ${logFilePath}\x1b[0m`);
        console.log('\x1b[35m================================================================================\x1b[0m');
    }, 1000);
    // 5b. Dynamic AI Parameter Optimizer Loop (Every 3 minutes)
    const runParameterOptimization = async () => {
        logDebug('Triggering dynamic AI parameter optimization with NVIDIA Llama 3.1 8B...');
        const activeSymbols = Object.keys(CONFIG.SYMBOLS);
        const timeframes = ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];
        const candleData = {};
        logDebug('Fetching multi-timeframe candles from Hyperliquid in parallel...');
        // Initialize structure
        for (const symbol of activeSymbols) {
            candleData[symbol] = {};
        }
        try {
            const fetchPromises = [];
            for (const symbol of activeSymbols) {
                for (const tf of timeframes) {
                    fetchPromises.push(exchange.getCandleSnapshot(symbol, tf, 10).then(candles => {
                        candleData[symbol][tf] = candles;
                    }).catch(err => {
                        logDebug(`Error fetching candles for ${symbol} (${tf}): ${err.message}`);
                        candleData[symbol][tf] = [];
                    }));
                }
            }
            await Promise.all(fetchPromises);
            logDebug('Successfully fetched all multi-timeframe candles.');
        }
        catch (err) {
            logDebug(`Error during parallel candle fetching: ${err.message}`);
        }
        const optimized = await nvidiaObserver.optimizeParameters(execution.getStats(), execution.getTradesHistory(), activeSymbols, candleData);
        if (optimized && optimized.parameters) {
            logDebug(`[AI OPTIMIZER] Received parameters shift from Llama: ${JSON.stringify(optimized.parameters)}`);
            // Save the latest analytical thoughts of the AI
            latestAiInsights = optimized.analysis || {};
            strategy.setAiBiases(latestAiInsights);
            for (const [symbol, params] of Object.entries(optimized.parameters)) {
                const symbolConfig = CONFIG.SYMBOLS[symbol];
                if (symbolConfig) {
                    symbolConfig.obiThreshold = params.obiThreshold;
                    symbolConfig.zScoreThreshold = params.zScoreThreshold;
                    symbolConfig.takeProfitPct = params.takeProfitPct;
                    symbolConfig.stopLossPct = params.stopLossPct;
                    logDebug(`[AI OPTIMIZER] Applied updated params for ${symbol}: OBI=${params.obiThreshold}, Z=${params.zScoreThreshold}, TP=${(params.takeProfitPct * 100).toFixed(2)}%, SL=${(params.stopLossPct * 100).toFixed(2)}%`);
                }
            }
            console.log('\n\x1b[32m[AI OPTIMIZER] Meta Llama 3.1 8B successfully optimized all parameters and updated market insights!\x1b[0m');
            // Instantly push update to refresh UI with AI reasons
            sendDashboardUpdate();
        }
        else {
            logDebug('[AI OPTIMIZER] No optimization returned (fallback to default parameters).');
        }
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
        execution.renderDashboard();
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
