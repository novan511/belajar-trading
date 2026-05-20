import dotenv from 'dotenv';
dotenv.config();

import { NvidiaObserver } from '../src/nvidia.js';
import { ExecutionStats, TradeRecord } from '../src/types.js';

const observer = new NvidiaObserver();

const mockStats: ExecutionStats = {
  totalTrades: 10,
  winningTrades: 7,
  losingTrades: 3,
  winRate: 70.0,
  netProfitUsd: 8.7544,
  totalFeesUsd: 2.4003
};

const mockTrades: TradeRecord[] = [
  {
    id: '1',
    symbol: 'ETH',
    side: 'BUY',
    entryPrice: 2111.6,
    exitPrice: 2112.8,
    quantity: 0.5,
    netProfitUsd: 0.369,
    holdTimeSec: 120,
    exitTime: Date.now() - 100000,
    result: 'WIN',
    isTakeProfitTriggered: false
  }
];

const mockCandleData: Record<string, Record<string, any[]>> = {
  ETH: {
    '5m': [{ t: Date.now(), o: 2111.6, h: 2112.8, l: 2111.0, c: 2112.4, v: 10 }],
    '15m': [{ t: Date.now(), o: 2111.6, h: 2112.8, l: 2111.0, c: 2112.4, v: 10 }],
    '30m': [{ t: Date.now(), o: 2111.6, h: 2112.8, l: 2111.0, c: 2112.4, v: 10 }],
    '1h': [{ t: Date.now(), o: 2111.6, h: 2112.8, l: 2111.0, c: 2112.4, v: 10 }],
    '4h': [{ t: Date.now(), o: 2111.6, h: 2112.8, l: 2111.0, c: 2112.4, v: 10 }],
    '1d': [{ t: Date.now(), o: 2111.6, h: 2112.8, l: 2111.0, c: 2112.4, v: 10 }],
    '1w': [{ t: Date.now(), o: 2111.6, h: 2112.8, l: 2111.0, c: 2112.4, v: 10 }],
    '1M': [{ t: Date.now(), o: 2111.6, h: 2112.8, l: 2111.0, c: 2112.4, v: 10 }]
  }
};

async function run() {
  console.log('Running test optimizeParameters...');
  
  // We will patch optimizeParameters temporarily in the console to print raw response
  const originalOptimize = observer.optimizeParameters.bind(observer);
  
  // Let's call the original optimize
  const result = await originalOptimize(
    mockStats,
    mockTrades,
    ['ETH'],
    mockCandleData
  );
  
  console.log('Result:', JSON.stringify(result, null, 2));
}

run();
