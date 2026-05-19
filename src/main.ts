import fs from 'fs';
import path from 'path';
import { ExchangeConnector } from './exchange.js';
import { StrategyManager } from './strategy.js';
import { ExecutionEngine } from './execution.js';
import { WebDashboardServer } from './server.js';
import { CONFIG } from './config.js';

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
  logDebug('Initializing High-Frequency Trading Bot...');

  // 1. Initialize core system components
  const exchange = new ExchangeConnector();
  const strategy = new StrategyManager();
  const execution = new ExecutionEngine(exchange);
  
  // 2. Start the Premium Real-time HTML Dashboard server on port 3000
  const dashboardServer = new WebDashboardServer(3000);

  let tickCount = 0;
  const symbolTickCounts: Record<string, number> = {};
  
  // Keep track of the last known price packets for active safeguard evaluations
  const lastKnownPrices: Record<string, { bid: number; ask: number }> = {};

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

    dashboardServer.broadcastUpdate({
      stats: execution.getStats(),
      activePositions: mappedPositions,
      tradesHistory: execution.getTradesHistory()
    });
  };

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
        logDebug(`[SIGNAL GENERATED] ${signal.symbol} | ${signal.side} | Price: ${signal.price} | Reason: ${signal.reason}`);
        execution.executeSignal(signal).then(() => {
          // Immediately update browser UI upon entry execution
          sendDashboardUpdate();
        });
      }
    } catch (err: any) {
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
  } catch (err: any) {
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

  // 6. Handle Graceful Shutdown
  const shutdown = () => {
    clearInterval(dashboardInterval);
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
