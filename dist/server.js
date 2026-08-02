import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from './config.js';
import { AITradeAnalyzer } from './ai_trade_analyzer.js';
const getSymbolConfig = (symbol) => CONFIG.SYMBOLS[symbol];
export class WebDashboardServer {
    server;
    wss;
    clients = new Set();
    tickCount = 0;
    lastUpdateData = null;
    onManualCloseCallback = null;
    onToggleStatusCallback = null;
    exchange;
    performanceDataProvider = null;
    constructor(port = 3000, exchange) {
        this.exchange = exchange;
        this.server = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }
            const url = req.url || '/';
            if (url === '/' || url === '/index.html') {
                this.serveFile('index.html', res);
                return;
            }
            if (url === '/performance' || url === '/performance.html') {
                this.serveFile('performance.html', res);
                return;
            }
            if (url === '/performance-lab' || url === '/performance-lab.html') {
                this.serveFile('performance-lab.html', res);
                return;
            }
            if (url.startsWith('/thinking-hub')) {
                this.serveFile('thinking-hub.html', res);
                return;
            }
            if (req.method === 'GET' && url.startsWith('/api/performance')) {
                this.handlePerformanceApi(req, res);
                return;
            }
            if (req.method === 'GET' && url.startsWith('/api/indicator-config')) {
                this.handleIndicatorConfig(req, res);
                return;
            }
            if (req.method === 'GET' && url.startsWith('/api/indicator-recommendations')) {
                this.handleIndicatorRecommendations(req, res);
                return;
            }
            if (req.method === 'POST' && url.startsWith('/api/ai-feedback')) {
                this.handleAIFeedback(req, res);
                return;
            }
            if (req.method === 'POST' && url.startsWith('/api/parameter-override')) {
                this.handleParameterOverride(req, res);
                return;
            }
            if (req.method === 'GET' && url.startsWith('/api/parameter-override')) {
                this.handleParameterOverrideGet(req, res);
                return;
            }
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        });
        // 2. Create WebSocket server sharing the same port / HTTP server
        this.wss = new WebSocketServer({ noServer: true });
        // Handle WebSocket upgrade handshakes
        this.server.on('upgrade', (request, socket, head) => {
            const pathname = request.url ? new URL(request.url, `http://${request.headers.host}`).pathname : '';
            if (pathname === '/dashboard') {
                this.wss.handleUpgrade(request, socket, head, (ws) => {
                    this.wss.emit('connection', ws, request);
                });
            }
            else {
                socket.destroy();
            }
        });
        // Monitor browser client connections
        this.wss.on('connection', (ws, request) => {
            this.clients.add(ws);
            // Send initial data packet immediately on connection
            if (this.lastUpdateData) {
                ws.send(JSON.stringify({
                    type: 'dashboard_update',
                    data: this.lastUpdateData
                }));
            }
            ws.on('message', (message) => {
                try {
                    const parsed = JSON.parse(message.toString());
                    if (parsed.type === 'manual_close' && parsed.symbol && parsed.modelId) {
                        console.log(`\x1b[35m[WEB-UI] Received manual close request for model ${parsed.modelId} symbol ${parsed.symbol}\x1b[0m`);
                        if (this.onManualCloseCallback) {
                            this.onManualCloseCallback(parsed.modelId, parsed.symbol);
                        }
                    }
                    else if (parsed.type === 'toggle_system_status') {
                        console.log(`\x1b[35m[WEB-UI] Received system ON/OFF status toggle request\x1b[0m`);
                        if (this.onToggleStatusCallback) {
                            this.onToggleStatusCallback();
                        }
                    }
                    else if (parsed.type === 'request_thinking_detail' && parsed.symbol) {
                        if (this.lastUpdateData) {
                            const models = this.lastUpdateData.models || {};
                            const details = {};
                            for (const [modelId, modelData] of Object.entries(models)) {
                                const aiInsights = modelData.aiInsights || {};
                                const activePos = (modelData.activePositions || []).find((p) => p.symbol === parsed.symbol);
                                const insight = aiInsights[parsed.symbol];
                                if (insight || activePos) {
                                    details[modelId] = {
                                        insight: insight || null,
                                        position: activePos || null,
                                        stats: modelData.stats || null
                                    };
                                }
                            }
                            ws.send(JSON.stringify({
                                type: 'thinking_detail',
                                symbol: parsed.symbol,
                                details
                            }));
                        }
                    }
                    else if (parsed.type === 'request_risk_metrics' && parsed.modelId) {
                        ws.send(JSON.stringify({
                            type: 'risk_metrics_response',
                            modelId: parsed.modelId,
                            data: this.lastUpdateData?.models?.[parsed.modelId]?.riskMetrics || null
                        }));
                    }
                    else if (parsed.type === 'request_equity_curve' && parsed.modelId) {
                        ws.send(JSON.stringify({
                            type: 'equity_curve_response',
                            modelId: parsed.modelId,
                            data: this.lastUpdateData?.models?.[parsed.modelId]?.equityCurve || []
                        }));
                    }
                    else if (parsed.type === 'request_performance_attribution' && parsed.modelId) {
                        ws.send(JSON.stringify({
                            type: 'performance_attribution_response',
                            modelId: parsed.modelId,
                            data: this.lastUpdateData?.models?.[parsed.modelId]?.performanceAttribution || []
                        }));
                    }
                }
                catch (err) {
                    console.error('[WEB-UI] Error parsing WebSocket message:', err.message);
                }
            });
            ws.on('close', () => {
                this.clients.delete(ws);
            });
            ws.on('error', (err) => {
                console.error('[WEB-UI] WebSocket Client Error:', err.message);
                this.clients.delete(ws);
            });
        });
        // 3. Start the Server
        this.server.listen(port, () => {
            console.log(`\n\x1b[32m\x1b[1m[WEB-UI] Premium Real-time HTML Dashboard is now online!`);
            console.log(`[WEB-UI] Open this link in your browser to view it live:`);
            console.log(`\x1b[36m\x1b[4mhttp://localhost:${port}/\x1b[0m`);
        });
    }
    // ================================================================
    // FILE SERVING
    // ================================================================
    serveFile(filename, res) {
        const filePath = path.join(process.cwd(), 'public', filename);
        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error loading UI: ' + err.message);
                return;
            }
            const ext = path.extname(filename);
            const mimeTypes = {
                '.html': 'text/html',
                '.js': 'text/javascript',
                '.css': 'text/css',
                '.json': 'application/json',
                '.png': 'image/png',
                '.jpg': 'image/jpg',
                '.gif': 'image/gif',
                '.svg': 'image/svg+xml',
            };
            const headers = {
                'Content-Type': mimeTypes[ext] || 'text/html',
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': '0',
            };
            res.writeHead(200, headers);
            res.end(content);
        });
    }
    /**
     * Broadcasts a sub-millisecond price heartbeat tick to flash the browser LED
     */
    broadcastTick() {
        this.tickCount++;
        const payload = JSON.stringify({
            type: 'heartbeat',
            tickCount: this.tickCount
        });
        this.broadcast(payload);
    }
    /**
     * Broadcasts a full dashboard data packet (stats, active positions, trades history) to the UI
     */
    broadcastUpdate(engineData) {
        this.lastUpdateData = {
            simMode: CONFIG.SIMULATION_MODE,
            models: engineData.models,
            isTradingActive: engineData.isTradingActive,
            globalDominance: engineData.globalDominance
        };
        const payload = JSON.stringify({
            type: 'dashboard_update',
            data: this.lastUpdateData
        });
        this.broadcast(payload);
    }
    broadcast(payload) {
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        }
    }
    registerManualCloseCallback(callback) {
        this.onManualCloseCallback = callback;
    }
    registerToggleStatusCallback(callback) {
        this.onToggleStatusCallback = callback;
    }
    registerPerformanceDataProvider(provider) {
        this.performanceDataProvider = provider;
    }
    handlePerformanceApi(req, res) {
        if (!this.performanceDataProvider) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Performance data not available' }));
            return;
        }
        try {
            const url = new URL(req.url || '/api/performance', `http://${req.headers.host}`);
            const meta = url.searchParams.get('meta') === '1';
            const data = this.performanceDataProvider();
            if (meta) {
                const models = {};
                for (const [id, runner] of Object.entries(data.runners || {})) {
                    try {
                        const execution = runner.execution;
                        const stats = execution && execution.getStats ? execution.getStats() : {};
                        models[id] = { stats };
                    }
                    catch {
                        models[id] = { stats: {} };
                    }
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ models }));
                return;
            }
            const analyzer = new AITradeAnalyzer();
            const allTrades = [];
            const runners = data.runners || {};
            for (const runner of Object.values(runners)) {
                try {
                    const execution = runner.execution;
                    if (execution) {
                        const trades = execution.getTradesHistory ? execution.getTradesHistory() : [];
                        allTrades.push(...trades);
                    }
                }
                catch { }
            }
            const riskMetrics = null;
            const analysis = analyzer.analyze(allTrades, riskMetrics);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ trades: allTrades, analysis, models: runners }));
        }
        catch (err) {
            if (!res.writable || res.headersSent) {
                return;
            }
            try {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
            catch { }
        }
    }
    async handleAIFeedback(req, res) {
        try {
            const body = await this.readBody(req);
            const { type, rating } = JSON.parse(body);
            if (type && (rating === 1 || rating === -1)) {
                const data = this.performanceDataProvider ? this.performanceDataProvider() : null;
                const modelId = data?.models ? Object.keys(data.models)[0] : 'Llama_8B';
                const database = data?.models?.[modelId]?.database;
                if (database) {
                    database.saveFeedback(type, { rating, timestamp: Date.now() }, type === 'positive' ? 'User confirmed insight accuracy' : 'User flagged insight as inaccurate', rating);
                }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        }
        catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
    }
    async handleParameterOverride(req, res) {
        try {
            const body = await this.readBody(req);
            const params = JSON.parse(body);
            if (params.reset) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Parameters reset to defaults' }));
                return;
            }
            const { modelId, symbol, obiThreshold, zScoreThreshold, takeProfitPct, stopLossPct } = params;
            const targetModel = modelId || 'Llama_8B';
            const targetSymbol = symbol || 'BTC';
            if (obiThreshold !== undefined)
                (CONFIG.SYMBOLS[targetSymbol]?.obiThreshold && CONFIG.SYMBOLS[targetSymbol].obiThreshold !== undefined) && CONFIG.SYMBOLS[targetSymbol].obiThreshold !== undefined && (obiThreshold !== undefined) && (CONFIG.SYMBOLS[targetSymbol].obiThreshold = obiThreshold);
            if (zScoreThreshold !== undefined)
                (CONFIG.SYMBOLS[targetSymbol]?.zScoreThreshold && CONFIG.SYMBOLS[targetSymbol].zScoreThreshold !== undefined) && CONFIG.SYMBOLS[targetSymbol].zScoreThreshold !== undefined && (zScoreThreshold !== undefined) && (CONFIG.SYMBOLS[targetSymbol].zScoreThreshold = zScoreThreshold);
            if (takeProfitPct !== undefined)
                (CONFIG.SYMBOLS[targetSymbol]?.takeProfitPct && CONFIG.SYMBOLS[targetSymbol].takeProfitPct !== undefined) && CONFIG.SYMBOLS[targetSymbol].takeProfitPct !== undefined && (takeProfitPct !== undefined) && (CONFIG.SYMBOLS[targetSymbol].takeProfitPct = takeProfitPct);
            if (stopLossPct !== undefined)
                (CONFIG.SYMBOLS[targetSymbol]?.stopLossPct && CONFIG.SYMBOLS[targetSymbol].stopLossPct !== undefined) && CONFIG.SYMBOLS[targetSymbol].stopLossPct !== undefined && (stopLossPct !== undefined) && (CONFIG.SYMBOLS[targetSymbol].stopLossPct = stopLossPct);
            if (this.performanceDataProvider) {
                try {
                    const data = this.performanceDataProvider();
                    const db = data?.models?.[targetModel]?.database;
                    if (db && db.saveManualParameterOverride) {
                        db.saveManualParameterOverride(targetSymbol, {
                            obiThreshold: obiThreshold ?? getSymbolConfig(targetSymbol)?.obiThreshold,
                            zScoreThreshold: zScoreThreshold ?? getSymbolConfig(targetSymbol)?.zScoreThreshold,
                            takeProfitPct: takeProfitPct ?? getSymbolConfig(targetSymbol)?.takeProfitPct,
                            stopLossPct: stopLossPct ?? getSymbolConfig(targetSymbol)?.stopLossPct,
                        });
                    }
                }
                catch { }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Parameters updated and saved', modelId: targetModel, symbol: targetSymbol }));
        }
        catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
    }
    handleParameterOverrideGet(req, res) {
        try {
            const url = new URL(req.url || '/api/parameter-override', `http://${req.headers.host}`);
            const modelId = url.searchParams.get('modelId') || 'Llama_8B';
            const symbol = url.searchParams.get('symbol') || 'BTC';
            let currentParams = null;
            if (this.performanceDataProvider) {
                try {
                    const data = this.performanceDataProvider();
                    const db = data?.models?.[modelId]?.database;
                    if (db && db.getLatestParameterSnapshot) {
                        currentParams = db.getLatestParameterSnapshot(symbol);
                    }
                }
                catch { }
            }
            if (!currentParams) {
                currentParams = {
                    symbol,
                    obiThreshold: getSymbolConfig(symbol)?.obiThreshold ?? 0.2,
                    zScoreThreshold: getSymbolConfig(symbol)?.zScoreThreshold ?? 0.8,
                    takeProfitPct: getSymbolConfig(symbol)?.takeProfitPct ?? 0.015,
                    stopLossPct: getSymbolConfig(symbol)?.stopLossPct ?? 0.005,
                };
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, params: currentParams }));
        }
        catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
    }
    async handleIndicatorConfig(req, res) {
        try {
            const indicators = [
                { id: 'obi', name: 'Order Book Imbalance (OBI)', category: 'Microstructure', description: 'Mendeteksi tekanan jual/beli dari imbalance volume di order book. Nilai > 0.20 = tekanan beli kuat.', enabled: true, range: [0.05, 0.80], default: 0.20, unit: '', param: 'obiThreshold' },
                { id: 'zscore', name: 'Z-Score Mean Reversion', category: 'Statistical', description: 'Mengukur seberapa jauh harga saat ini dari rata-rata rolling. Z < -0.8 = oversold, Z > 0.8 = overbought.', enabled: true, range: [0.3, 2.0], default: 0.8, unit: 'σ', param: 'zScoreThreshold' },
                { id: 'ema', name: 'Fast/Slow EMA Crossover', category: 'Trend', description: 'EMA cepat (10) vs EMA lambat (30). Fast > Slow = tren naik, sebaliknya turun. Momentum confirmation.', enabled: true, range: [5, 50], default: 10, unit: 'periods', param: 'emaFast' },
                { id: 'vwap', name: 'VWAP Proximity Filter', category: 'Volume', description: 'Harga di bawah VWAP = entry long lebih favorable. Di atas VWAP = entry short lebih favorable.', enabled: true, range: [0, 1], default: 1, unit: '', param: 'vwapEnabled' },
                { id: 'volProfile', name: 'Volume Profile (VAH/VAL)', category: 'Volume', description: 'Value Area High/Low menunjukkan zona volume tertinggi. Entry di dalam value area = konfirmasi ekstra.', enabled: true, range: [0, 1], default: 1, unit: '', param: 'volProfileEnabled' },
                { id: 'fibonacci', name: 'Fibonacci Retracement', category: 'Technical', description: 'Level 0.618, 0.786 sebagai support; 0.236, 0.382 sebagai resistance. Entry dekat level ini = konfirmasi teknikal.', enabled: true, range: [0, 1], default: 1, unit: '', param: 'fibEnabled' },
                { id: 'srLevels', name: 'Swing Support/Resistance', category: 'Technical', description: 'Deteksi level S/R dari swing high/low. Entry dekat support/resistance = konfirmasi teknikal.', enabled: true, range: [0, 1], default: 1, unit: '', param: 'srEnabled' },
                { id: 'fvg', name: 'Fair Value Gap (FVG)', category: 'Technical', description: 'Zona FVG bullish/bearish yang belum terisi. Entry di dalam zona FVG = konfirmasi imbalance harga.', enabled: true, range: [0, 1], default: 1, unit: '', param: 'fvgEnabled' },
                { id: 'cvd', name: 'CVD Divergence', category: 'Microstructure', description: 'Cumulative Volume Delta divergence dengan harga. Bullish/Bearish divergence = sinyal reversi kuat.', enabled: true, range: [0, 1], default: 1, unit: '', param: 'cvdEnabled' },
                { id: 'liquiditySweep', name: 'Liquidity Sweep Detection', category: 'Microstructure', description: 'Deteksi stop hunt (fake breakdown/breakout). Sweep + reversal = entry sinyal kuat.', enabled: true, range: [0, 1], default: 1, unit: '', param: 'sweepEnabled' },
                { id: 'obiTrend', name: 'OBI Trend Momentum', category: 'Microstructure', description: 'Tren akumulasi/distribusi dari OBI. ACCUMULATING = beli, DISTRIBUTING = jual.', enabled: true, range: [0, 1], default: 1, unit: '', param: 'obiTrendEnabled' },
                { id: 'marketRegime', name: 'Market Regime Filter', category: 'Regime', description: 'Deteksi regime: TRENDING_BULL/BEAR, RANGING, HIGH/LOW_VOLATILITY. Filter entry sesuai kondisi pasar.', enabled: true, range: [0, 1], default: 1, unit: '', param: 'regimeEnabled' },
                { id: 'pairsTrading', name: 'Pairs Trading', category: 'Arbitrage', description: 'Statistical arbitrage antara pair terkorelasi (BTC/ETH, BTC/SOL, dll). Entry spread deviation.', enabled: false, range: [0, 1], default: 0, unit: '', param: 'pairsEnabled' },
                { id: 'macd', name: 'MACD', category: 'Trend', description: 'Moving Average Convergence Divergence. Konfirmasi tren dan momentum.', enabled: false, range: [0, 1], default: 0, unit: '', param: 'macdEnabled' },
                { id: 'rsi', name: 'RSI (14)', category: 'Momentum', description: 'Relative Strength Index. Oversold < 30, Overbought > 70.', enabled: false, range: [0, 1], default: 0, unit: '', param: 'rsiEnabled' },
                { id: 'bollinger', name: 'Bollinger Bands', category: 'Volatility', description: 'Bands atas/bawah berdasarkan std dev. Harga di bawah lower band = oversold.', enabled: false, range: [0, 1], default: 0, unit: '', param: 'bollingerEnabled' },
                { id: 'atr', name: 'ATR Position Sizing', category: 'Volatility', description: 'Average True Range untuk position sizing dinamis. Lebih besar ATR = lebih kecil posisi.', enabled: true, range: [0, 1], default: 1, unit: '', param: 'atrEnabled' },
                { id: 'kelly', name: 'Kelly Criterion Sizing', category: 'Risk', description: 'Optimal position sizing berdasarkan win rate dan avg win/loss ratio.', enabled: true, range: [0, 1], default: 1, unit: '', param: 'kellyEnabled' },
                { id: 'trailingSL', name: 'Trailing Stop Loss', category: 'Risk', description: 'Stop loss mengikuti harga naik/turun. Progressive tightening saat profit meningkat.', enabled: true, range: [0, 1], default: 1, unit: '', param: 'trailingSLEnabled' },
                { id: 'partialTP', name: 'Partial Take Profit', category: 'Risk', description: 'Scale out: 30% di TP1, 30% di TP2, 40% trail. Lock profit gradual.', enabled: true, range: [0, 1], default: 1, unit: '', param: 'partialTPEnabled' },
                { id: 'dailyDD', name: 'Daily Drawdown Guard', category: 'Risk', description: 'Auto-pause trading jika daily drawdown melebihi batas (default 5%). Proteksi akun.', enabled: true, range: [0, 1], default: 1, unit: '', param: 'dailyDDEnabled' },
                { id: 'sessionFilter', name: 'Session Time Filter', category: 'Time', description: 'Hanya allow trading di sesi tertentu (default UTC 01:00-21:00).', enabled: true, range: [0, 1], default: 1, unit: '', param: 'sessionFilterEnabled' },
                { id: 'macroBTC', name: 'BTC Macro Trend Filter', category: 'Macro', description: 'Blokir LONG jika BTC macro bearish, blokir SHORT jika BTC macro bullish.', enabled: true, range: [0, 1], default: 1, unit: '', param: 'macroBTCEnabled' },
                { id: 'aiBias', name: 'AI Bias Filter', category: 'AI', description: 'Gunakan bias AI (BULLISH/BEARISH/NEUTRAL) untuk filter entry. Bisa di-override manual.', enabled: true, range: [0, 1], default: 1, unit: '', param: 'aiBiasEnabled' },
                { id: 'sor', name: 'Smart Order Router', category: 'Execution', description: 'Slippage protection: skip entry jika spread > 0.5% atau depth < $1000. TWAP slicing untuk order besar.', enabled: true, range: [0, 1], default: 1, unit: '', param: 'sorEnabled' },
            ];
            const url = new URL(req.url || '/api/indicator-config', `http://${req.headers.host}`);
            const symbol = url.searchParams.get('symbol') || 'BTC';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ indicators, symbol }));
        }
        catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
    }
    async handleIndicatorRecommendations(req, res) {
        try {
            const data = this.performanceDataProvider ? this.performanceDataProvider() : null;
            const runners = data?.models || {};
            const allTrades = [];
            for (const runner of Object.values(runners)) {
                try {
                    const execution = runner.execution;
                    if (execution) {
                        const trades = execution.getTradesHistory ? execution.getTradesHistory() : [];
                        allTrades.push(...trades);
                    }
                }
                catch { }
            }
            const recommendations = [];
            const indicatorStats = {};
            if (allTrades.length < 5) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    recommendations: [{ type: 'info', text: 'Butuh minimal 5 trade untuk analisis rekomendasi indikator.', confidence: 'LOW' }],
                    indicatorStats,
                    totalTrades: allTrades.length
                }));
                return;
            }
            const wins = allTrades.filter(t => t.result === 'WIN');
            const losses = allTrades.filter(t => t.result === 'LOSS');
            const overallWinRate = wins.length / allTrades.length;
            const analyzeReason = (trades, keyword) => {
                const matched = trades.filter(t => (t.entryReason || '').toLowerCase().includes(keyword));
                if (matched.length < 2)
                    return null;
                const wins = matched.filter(t => t.result === 'WIN').length;
                const wr = matched.length > 0 ? (wins / matched.length) * 100 : 0;
                return { count: matched.length, winRate: wr, netProfit: matched.reduce((s, t) => s + (parseFloat(t.netProfitUsd) || 0), 0) };
            };
            const liquiditySweep = analyzeReason(allTrades, 'liquidity sweep');
            if (liquiditySweep && liquiditySweep.winRate >= 60) {
                recommendations.push({ type: 'positive', text: `Liquidity Sweep: WR ${liquiditySweep.winRate.toFixed(0)}% pada ${liquiditySweep.count} trade. Pertahankan indikator ini.`, confidence: liquiditySweep.count >= 5 ? 'HIGH' : 'LOW' });
            }
            else if (liquiditySweep && liquiditySweep.winRate < 40) {
                recommendations.push({ type: 'negative', text: `Liquidity Sweep: WR hanya ${liquiditySweep.winRate.toFixed(0)}% pada ${liquiditySweep.count} trade. Pertimbangkan kurangi bobot atau nonaktifkan.`, confidence: liquiditySweep.count >= 5 ? 'HIGH' : 'LOW' });
            }
            const cvd = analyzeReason(allTrades, 'cvd');
            if (cvd && cvd.winRate >= 60) {
                recommendations.push({ type: 'positive', text: `CVD Divergence: WR ${cvd.winRate.toFixed(0)}% pada ${cvd.count} trade. Indikator ini berkontribusi positively.`, confidence: cvd.count >= 5 ? 'HIGH' : 'LOW' });
            }
            else if (cvd && cvd.winRate < 40) {
                recommendations.push({ type: 'negative', text: `CVD Divergence: WR ${cvd.winRate.toFixed(0)}% pada ${cvd.count} trade. Berpotensi false signal.`, confidence: cvd.count >= 5 ? 'HIGH' : 'LOW' });
            }
            const obi = analyzeReason(allTrades, 'obi');
            if (obi) {
                if (obi.winRate >= 60)
                    recommendations.push({ type: 'positive', text: `OBI threshold efektif: WR ${obi.winRate.toFixed(0)}% pada ${obi.count} trade.`, confidence: 'MEDIUM' });
                else if (obi.winRate < 40)
                    recommendations.push({ type: 'negative', text: `OBI threshold kurang efektif: WR ${obi.winRate.toFixed(0)}%. Pertimbangkan turunkan threshold.`, confidence: 'MEDIUM' });
            }
            const vwap = analyzeReason(allTrades, 'vwap');
            if (vwap && vwap.winRate >= 60)
                recommendations.push({ type: 'positive', text: `VWAP filter membantu: WR ${vwap.winRate.toFixed(0)}% pada ${vwap.count} trade.`, confidence: 'MEDIUM' });
            const fib = analyzeReason(allTrades, 'fib');
            if (fib && fib.winRate < 40)
                recommendations.push({ type: 'negative', text: `Fibonacci levels kurang relevan: WR ${fib.winRate.toFixed(0)}% pada ${fib.count} trade.`, confidence: 'MEDIUM' });
            const obiTrend = analyzeReason(allTrades, 'obi trend');
            if (obiTrend && obiTrend.winRate >= 60)
                recommendations.push({ type: 'positive', text: `OBI Trend momentum efektif: WR ${obiTrend.winRate.toFixed(0)}% pada ${obiTrend.count} trade.`, confidence: 'MEDIUM' });
            if (overallWinRate >= 65) {
                recommendations.push({ type: 'info', text: `Win rate overall bagus (${overallWinRate.toFixed(0)}%). Pertimbangkan TAMBAH indikator untuk meningkatkan konfirmasi entry.`, confidence: 'MEDIUM' });
            }
            else if (overallWinRate < 45 && allTrades.length >= 20) {
                recommendations.push({ type: 'warning', text: `Win rate ${overallWinRate.toFixed(0)}% terlalu rendah. KURANGI jumlah indikator untuk mengurangi over-filtering, atau perkecil threshold.`, confidence: 'HIGH' });
            }
            const activeIndicators = allTrades.filter(t => t.entryReason && t.entryReason.length > 20);
            if (activeIndicators.length < allTrades.length * 0.5 && allTrades.length >= 10) {
                recommendations.push({ type: 'warning', text: 'Banyak trade dengan entryReason pendek — sinyal terlalu sederhana. Tambah indikator konfirmasi bisa meningkatkan kualitas entry.', confidence: 'MEDIUM' });
            }
            if (recommendations.length === 0) {
                recommendations.push({ type: 'info', text: 'Belum cukup pola terbentuk. Lanjutkan trading dan kumpulkan lebih banyak data untuk evaluasi indikator.', confidence: 'LOW' });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ recommendations, indicatorStats, totalTrades: allTrades.length }));
        }
        catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
    }
    readBody(req) {
        return new Promise((resolve, reject) => {
            let data = '';
            req.on('data', chunk => { data += chunk; });
            req.on('end', () => resolve(data));
            req.on('error', reject);
        });
    }
    close() {
        this.wss.close();
        this.server.close();
    }
}
