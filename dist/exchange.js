import WebSocket from 'ws';
import { CONFIG } from './config.js';
export class ExchangeConnector {
    ws = null;
    onBookUpdateCallback = null;
    isReconnecting = false;
    constructor() { }
    /**
     * Set callback for order book updates
     */
    onBookUpdate(callback) {
        this.onBookUpdateCallback = callback;
    }
    /**
     * Start the live WebSocket connection to Hyperliquid API
     */
    connect() {
        const wsUrl = CONFIG.HYPERLIQUID_WS_URL;
        console.log(`[EXCHANGE] Connecting to Hyperliquid WebSocket: ${wsUrl}`);
        this.ws = new WebSocket(wsUrl);
        this.ws.on('open', () => {
            console.log('[EXCHANGE] Hyperliquid WebSocket connected.');
            this.isReconnecting = false;
            // Subscribe to L2 Book updates for all configured perp assets dynamically
            for (const symbolConfig of Object.values(CONFIG.SYMBOLS)) {
                this.subscribeToCoin(symbolConfig.name);
            }
        });
        this.ws.on('message', (data) => {
            try {
                const rawMessage = JSON.parse(data.toString());
                // Hyperliquid L2 Book format filter
                if (rawMessage.channel === 'l2Book' && rawMessage.data) {
                    const bookData = rawMessage.data;
                    const symbol = bookData.coin; // 'BTC' or 'ETH'
                    const bids = bookData.levels[0]; // Array of { px, sz, n }
                    const asks = bookData.levels[1];
                    if (bids && bids.length > 0 && asks && asks.length > 0) {
                        const bestBidPrice = parseFloat(bids[0].px);
                        const bestBidQty = parseFloat(bids[0].sz);
                        const bestAskPrice = parseFloat(asks[0].px);
                        const bestAskQty = parseFloat(asks[0].sz);
                        const book = {
                            symbol,
                            bids: [[bestBidPrice, bestBidQty]],
                            asks: [[bestAskPrice, bestAskQty]],
                            updatedAt: bookData.time,
                        };
                        if (this.onBookUpdateCallback) {
                            this.onBookUpdateCallback(book);
                        }
                    }
                }
            }
            catch (err) {
                console.error('[EXCHANGE] Error parsing Hyperliquid WebSocket message:', err);
            }
        });
        this.ws.on('close', () => {
            console.warn('[EXCHANGE] Hyperliquid WebSocket connection closed.');
            this.reconnect();
        });
        this.ws.on('error', (err) => {
            console.error('[EXCHANGE] Hyperliquid WebSocket error:', err.message);
            this.ws?.close();
        });
    }
    /**
     * Helper to subscribe to L2 Book for a specific coin perp
     */
    subscribeToCoin(coin) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
            return;
        const subMessage = {
            method: 'subscribe',
            subscription: {
                type: 'l2Book',
                coin: coin
            }
        };
        console.log(`[EXCHANGE] Subscribing to Hyperliquid L2 Book: ${coin}`);
        this.ws.send(JSON.stringify(subMessage));
    }
    /**
     * Simple reconnection with backoff
     */
    reconnect() {
        if (this.isReconnecting)
            return;
        this.isReconnecting = true;
        console.log('[EXCHANGE] Reconnecting to Hyperliquid in 3 seconds...');
        setTimeout(() => {
            this.connect();
        }, 3000);
    }
    /**
     * Simulated Order Placement on Hyperliquid - incorporates standard maker/taker fee structure
     */
    async submitSimulatedOrder(symbol, side, price, quantity, isMaker = true // Executing as Maker Limit orders saves 66% on Hyperliquid fees!
    ) {
        return new Promise((resolve) => {
            // Simulate ultra-low internal engine execution delay of 2-5ms
            const executionDelay = Math.floor(Math.random() * 4) + 2;
            setTimeout(() => {
                const orderId = 'hl-' + Math.random().toString(36).substring(2, 11).toUpperCase();
                // Fee calculations: uses Maker rate (0.01%) if limit order, otherwise Taker rate (0.03%)
                const orderValue = price * quantity;
                const feeRate = isMaker ? CONFIG.MAKER_FEE_PCT : CONFIG.TAKER_FEE_PCT;
                const feeUsd = orderValue * feeRate;
                resolve({
                    orderId,
                    success: true,
                    executedPrice: price,
                    feeUsd
                });
            }, executionDelay);
        });
    }
    /**
     * Fetch historical candles from Hyperliquid REST API
     */
    async getCandleSnapshot(coin, interval, limit = 10) {
        const url = `${CONFIG.HYPERLIQUID_REST_URL}/info`;
        const now = Date.now();
        let intervalMs = 60 * 1000;
        if (interval === '5m')
            intervalMs = 5 * 60 * 1000;
        else if (interval === '15m')
            intervalMs = 15 * 60 * 1000;
        else if (interval === '30m')
            intervalMs = 30 * 60 * 1000;
        else if (interval === '1h')
            intervalMs = 60 * 60 * 1000;
        else if (interval === '4h')
            intervalMs = 4 * 60 * 60 * 1000;
        else if (interval === '1d')
            intervalMs = 24 * 60 * 60 * 1000;
        else if (interval === '1w')
            intervalMs = 7 * 24 * 60 * 60 * 1000;
        else if (interval === '1M')
            intervalMs = 30 * 24 * 60 * 60 * 1000;
        const startTime = now - (limit * 2) * intervalMs;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    type: 'candleSnapshot',
                    req: {
                        coin,
                        interval,
                        startTime,
                        endTime: now
                    }
                })
            });
            if (!response.ok) {
                throw new Error(`REST API error: ${response.status} ${response.statusText}`);
            }
            const candles = (await response.json());
            if (!Array.isArray(candles))
                return [];
            return candles.slice(-limit).map(c => ({
                time: c.t,
                open: parseFloat(c.o),
                high: parseFloat(c.h),
                low: parseFloat(c.l),
                close: parseFloat(c.c),
                volume: parseFloat(c.v)
            }));
        }
        catch (err) {
            console.error(`[EXCHANGE] Failed to fetch candles for ${coin} (${interval}): ${err.message}`);
            return [];
        }
    }
    /**
     * Production Hyperliquid Order Execution placeholder.
     * In Hyperliquid, executing live trades requires:
     * 1. Setting up an Ethereum wallet with the wallet private key.
     * 2. Signing the order payload using the Ethereum private key according to EIP-712.
     * 3. POSTing to the `/exchange` endpoint of the Hyperliquid REST API.
     */
    async submitLiveOrder(symbol, side, quantity) {
        if (!CONFIG.WALLET_PRIVATE_KEY) {
            throw new Error('[EXCHANGE] Cannot execute live Hyperliquid trade: WALLET_PRIVATE_KEY is missing.');
        }
        console.log(`[EXCHANGE] [LIVE ORDER] Sending ${side} signed order for ${quantity} ${symbol} perp to Hyperliquid...`);
        // Full production implementation would sign the order utilizing ethers or viem, 
        // construct the JSON-RPC request and post to https://api.hyperliquid.xyz/exchange.
        return { success: false, error: 'Live trade not active. Turn on simulation.' };
    }
}
