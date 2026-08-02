/**
 * SQLite Database Layer — Persistent Storage untuk HFT Bot
 *
 * Features:
 * - Trade history (ganti file JSON)
 * - Active positions state
 * - Daily P&L tracking
 * - Equity curve snapshots
 * - Performance metrics cache
 * - Graceful recovery setelah restart
 */
import path from 'path';
import { CONFIG } from './config.js';
import Database from 'better-sqlite3';
let lastSupabaseRequest = 0;
const SUPABASE_RATE_LIMIT_MS = 200;
async function rateLimitedFetch(url, init) {
    const now = Date.now();
    const elapsed = now - lastSupabaseRequest;
    if (elapsed < SUPABASE_RATE_LIMIT_MS) {
        await new Promise(resolve => setTimeout(resolve, SUPABASE_RATE_LIMIT_MS - elapsed));
    }
    lastSupabaseRequest = Date.now();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(url, { ...init, signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
    }
    catch {
        return null;
    }
}
function supabaseFetch(table, method, body) {
    if (!CONFIG.SUPABASE_ENABLED)
        return Promise.resolve();
    const url = `${CONFIG.SUPABASE_URL}${table}`;
    const headers = {
        'Content-Type': 'application/json',
        'apikey': CONFIG.SUPABASE_SERVICE_ROLE_KEY || CONFIG.SUPABASE_ANON_KEY,
        'Prefer': 'return=minimal',
    };
    if (CONFIG.SUPABASE_SERVICE_ROLE_KEY) {
        headers['Authorization'] = `Bearer ${CONFIG.SUPABASE_SERVICE_ROLE_KEY}`;
    }
    return rateLimitedFetch(url, {
        method,
        headers,
        body: JSON.stringify(body),
    }).then(response => {
        if (!response)
            return;
        return response.text();
    }).catch(() => { });
}
async function supabaseFetchGet(table, queryParams) {
    if (!CONFIG.SUPABASE_ENABLED)
        return [];
    const url = `${CONFIG.SUPABASE_URL}${table}?${queryParams}`;
    const headers = {
        'Content-Type': 'application/json',
        'apikey': CONFIG.SUPABASE_SERVICE_ROLE_KEY || CONFIG.SUPABASE_ANON_KEY,
    };
    if (CONFIG.SUPABASE_SERVICE_ROLE_KEY) {
        headers['Authorization'] = `Bearer ${CONFIG.SUPABASE_SERVICE_ROLE_KEY}`;
    }
    try {
        const timeoutMs = 3000;
        const fetchPromise = rateLimitedFetch(url, { method: 'GET', headers });
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Supabase fetch timeout')), timeoutMs);
        });
        const response = await Promise.race([fetchPromise, timeoutPromise]);
        if (!response)
            return [];
        try {
            return (await response.json());
        }
        catch {
            return [];
        }
    }
    catch {
        return [];
    }
}
export class TradeDatabase {
    db;
    modelId;
    constructor(modelId) {
        this.modelId = modelId;
        const dbPath = path.join(process.cwd(), `hft_${modelId}.db`);
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this.initializeTables();
        console.log(`\x1b[32m[DATABASE] SQLite initialized: ${dbPath}\x1b[0m`);
    }
    initializeTables() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        entry_price REAL NOT NULL,
        exit_price REAL,
        quantity REAL NOT NULL,
        entry_time INTEGER NOT NULL,
        exit_time INTEGER,
        hold_time_sec REAL,
        gross_profit REAL,
        fees REAL,
        net_profit REAL,
        result TEXT,
        entry_reason TEXT,
        exit_reason TEXT,
        model_id TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS active_positions (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        entry_price REAL NOT NULL,
        quantity REAL NOT NULL,
        entry_time INTEGER NOT NULL,
        take_profit_price REAL NOT NULL,
        stop_loss_price REAL NOT NULL,
        highest_price REAL,
        lowest_price REAL,
        entry_reason TEXT,
        is_tp_triggered INTEGER DEFAULT 0,
        model_id TEXT NOT NULL,
        remaining_qty REAL,
        partial_tps TEXT,
        status TEXT DEFAULT 'OPEN',
        updated_at INTEGER DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS equity_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        balance REAL NOT NULL,
        unrealized_pnl REAL DEFAULT 0,
        total_equity REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS performance_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_id TEXT NOT NULL,
        date TEXT NOT NULL,
        sharpe_ratio REAL DEFAULT 0,
        sortino_ratio REAL DEFAULT 0,
        max_drawdown REAL DEFAULT 0,
        profit_factor REAL DEFAULT 0,
        var_95 REAL DEFAULT 0,
        consecutive_losses INTEGER DEFAULT 0,
        avg_win REAL DEFAULT 0,
        avg_loss REAL DEFAULT 0,
        UNIQUE(model_id, date)
      );

       CREATE INDEX IF NOT EXISTS idx_trades_model ON trades(model_id);
       CREATE INDEX IF NOT EXISTS idx_trades_time ON trades(entry_time);
       CREATE INDEX IF NOT EXISTS idx_positions_model ON active_positions(model_id);
       CREATE INDEX IF NOT EXISTS idx_positions_status ON active_positions(status);

       CREATE TABLE IF NOT EXISTS ai_feedback (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         model_id TEXT NOT NULL,
         insight_type TEXT NOT NULL,
         insight_data TEXT NOT NULL,
         feedback TEXT NOT NULL,
         rating INTEGER NOT NULL,
         created_at INTEGER DEFAULT (strftime('%s','now'))
       );

       CREATE TABLE IF NOT EXISTS parameter_history (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         model_id TEXT NOT NULL,
         symbol TEXT NOT NULL,
         obi_threshold REAL,
         z_score_threshold REAL,
         take_profit_pct REAL,
         stop_loss_pct REAL,
         win_rate REAL,
         profit_factor REAL,
         net_profit_usd REAL,
         trade_count INTEGER,
         source TEXT DEFAULT 'manual',
         created_at INTEGER DEFAULT (strftime('%s','now'))
       );

       CREATE TABLE IF NOT EXISTS session_performance (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         model_id TEXT NOT NULL,
         session TEXT NOT NULL,
         trades INTEGER DEFAULT 0,
         wins INTEGER DEFAULT 0,
         losses INTEGER DEFAULT 0,
         net_profit_usd REAL DEFAULT 0,
         win_rate REAL DEFAULT 0,
         created_at INTEGER DEFAULT (strftime('%s','now'))
       );
     `);
        // Create indexes for new tables
        this.db.exec(`
       CREATE INDEX IF NOT EXISTS idx_feedback_model ON ai_feedback(model_id);
       CREATE INDEX IF NOT EXISTS idx_param_history_model ON parameter_history(model_id);
       CREATE INDEX IF NOT EXISTS idx_session_perf_model ON session_performance(model_id);
     `);
    }
    // ============================================================
    // TRADES
    // ============================================================
    saveTrade(record) {
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO trades 
        (id, symbol, side, entry_price, exit_price, quantity, entry_time, exit_time,
         hold_time_sec, gross_profit, fees, net_profit, result, entry_reason, exit_reason, model_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(record.id, record.symbol, record.side, record.entryPrice, record.exitPrice || 0, record.quantity, record.entryTime, record.exitTime || 0, record.holdTimeSec || 0, record.grossProfitUsd || 0, record.feesUsd || 0, record.netProfitUsd || 0, record.result || 'PENDING', record.entryReason || null, record.exitReason || null, this.modelId);
        supabaseFetch('trades', 'POST', {
            id: record.id,
            symbol: record.symbol,
            side: record.side,
            entry_price: record.entryPrice,
            exit_price: record.exitPrice || 0,
            quantity: record.quantity,
            entry_time: record.entryTime,
            exit_time: record.exitTime || 0,
            hold_time_sec: record.holdTimeSec || 0,
            gross_profit: record.grossProfitUsd || 0,
            fees: record.feesUsd || 0,
            net_profit: record.netProfitUsd || 0,
            result: record.result || 'PENDING',
            entry_reason: record.entryReason || null,
            exit_reason: record.exitReason || null,
            model_id: this.modelId,
        });
    }
    getTradeHistory(limit = 100, offset = 0) {
        const rows = this.db.prepare(`
      SELECT * FROM trades 
      WHERE model_id = ? 
      ORDER BY entry_time DESC 
      LIMIT ? OFFSET ?
    `).all(this.modelId, limit, offset);
        return rows.map(this.mapTradeRow);
    }
    getTradeHistoryBySymbol(symbol, limit = 50) {
        const rows = this.db.prepare(`
      SELECT * FROM trades 
      WHERE model_id = ? AND symbol = ? 
      ORDER BY entry_time DESC 
      LIMIT ?
    `).all(this.modelId, symbol, limit);
        return rows.map(this.mapTradeRow);
    }
    getTradeHistoryByDateRange(startTime, endTime, symbol) {
        let query = `SELECT * FROM trades WHERE model_id = ? AND entry_time >= ? AND entry_time <= ?`;
        const params = [this.modelId, startTime, endTime];
        if (symbol) {
            query += ` AND symbol = ?`;
            params.push(symbol);
        }
        query += ` ORDER BY entry_time ASC`;
        const rows = this.db.prepare(query).all(...params);
        return rows.map(this.mapTradeRow);
    }
    getTotalTrades() {
        const row = this.db.prepare(`SELECT COUNT(*) as count FROM trades WHERE model_id = ?`).get(this.modelId);
        return row?.count || 0;
    }
    // ============================================================
    // ACTIVE POSITIONS
    // ============================================================
    savePosition(position) {
        const existing = this.db.prepare(`SELECT id FROM active_positions WHERE id = ?`).get(position.id);
        if (existing)
            return;
        const stmt = this.db.prepare(`
      INSERT INTO active_positions
        (id, symbol, side, entry_price, quantity, entry_time, 
         take_profit_price, stop_loss_price, highest_price, lowest_price,
         entry_reason, is_tp_triggered, model_id, remaining_qty, partial_tps, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
    `);
        stmt.run(position.id, position.symbol, position.side, position.entryPrice, position.quantity, position.entryTime, position.takeProfitPrice, position.stopLossPrice, position.highestPrice || position.entryPrice, position.lowestPrice || position.entryPrice, position.entryReason || null, position.isTakeProfitTriggered ? 1 : 0, this.modelId, position.remainingQty || position.quantity, position.partialTPs ? JSON.stringify(position.partialTPs) : null);
        supabaseFetch('positions', 'POST', {
            id: position.id,
            symbol: position.symbol,
            side: position.side,
            entry_price: position.entryPrice,
            quantity: position.quantity,
            entry_time: position.entryTime,
            take_profit_price: position.takeProfitPrice,
            stop_loss_price: position.stopLossPrice,
            highest_price: position.highestPrice || position.entryPrice,
            lowest_price: position.lowestPrice || position.entryPrice,
            entry_reason: position.entryReason || null,
            is_tp_triggered: position.isTakeProfitTriggered ? 1 : 0,
            model_id: this.modelId,
            remaining_qty: position.remainingQty || position.quantity,
            partial_tps: position.partialTPs ? JSON.stringify(position.partialTPs) : null,
            status: 'OPEN',
        });
    }
    closePosition(positionId) {
        this.db.prepare(`
      UPDATE active_positions 
      SET status = 'CLOSED', updated_at = strftime('%s','now')
      WHERE id = ?
    `).run(positionId);
        supabaseFetch('positions', 'PATCH', {
            id: positionId,
            status: 'CLOSED',
            updated_at: Math.floor(Date.now() / 1000),
        });
    }
    getAllActivePositions() {
        const rows = this.db.prepare(`
      SELECT * FROM active_positions 
      WHERE model_id = ? AND status = 'OPEN'
    `).all(this.modelId);
        return rows.map((row) => this.mapPositionRow(row));
    }
    // ============================================================
    // AI FEEDBACK
    // ============================================================
    saveFeedback(insightType, insightData, feedback, rating) {
        const stmt = this.db.prepare(`
      INSERT INTO ai_feedback (model_id, insight_type, insight_data, feedback, rating)
      VALUES (?, ?, ?, ?, ?)
    `);
        stmt.run(this.modelId, insightType, JSON.stringify(insightData), feedback, rating);
    }
    getFeedback(limit = 50) {
        const rows = this.db.prepare(`
      SELECT * FROM ai_feedback 
      WHERE model_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(this.modelId, limit);
        return rows.map((row) => ({
            id: row.id,
            insightType: row.insight_type,
            insightData: JSON.parse(row.insight_data),
            feedback: row.feedback,
            rating: row.rating,
            createdAt: row.created_at,
        }));
    }
    // ============================================================
    // PARAMETER HISTORY (for continuous learning)
    // ============================================================
    saveParameterSnapshot(symbol, params, performance, source = 'manual') {
        const stmt = this.db.prepare(`
      INSERT INTO parameter_history 
        (model_id, symbol, obi_threshold, z_score_threshold, take_profit_pct, stop_loss_pct,
         win_rate, profit_factor, net_profit_usd, trade_count, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(this.modelId, symbol, params.obiThreshold ?? null, params.zScoreThreshold ?? null, params.takeProfitPct ?? null, params.stopLossPct ?? null, performance.winRate ?? null, performance.profitFactor ?? null, performance.netProfitUsd ?? null, performance.tradeCount ?? null, source);
    }
    getParameterHistory(symbol, limit = 100) {
        let query = `SELECT * FROM parameter_history WHERE model_id = ?`;
        const params = [this.modelId];
        if (symbol) {
            query += ` AND symbol = ?`;
            params.push(symbol);
        }
        query += ` ORDER BY created_at DESC LIMIT ?`;
        params.push(limit);
        const rows = this.db.prepare(query).all(...params);
        return rows.map((row) => ({
            id: row.id,
            symbol: row.symbol,
            obiThreshold: row.obi_threshold,
            zScoreThreshold: row.z_score_threshold,
            takeProfitPct: row.take_profit_pct,
            stopLossPct: row.stop_loss_pct,
            winRate: row.win_rate,
            profitFactor: row.profit_factor,
            netProfitUsd: row.net_profit_usd,
            tradeCount: row.trade_count,
            source: row.source,
            createdAt: row.created_at,
        }));
    }
    getBestParameters(symbol) {
        const row = this.db.prepare(`
      SELECT obi_threshold, z_score_threshold, take_profit_pct, stop_loss_pct
      FROM parameter_history 
      WHERE model_id = ? AND symbol = ? AND win_rate > 0
      ORDER BY (win_rate * profit_factor) DESC
      LIMIT 1
    `).get(this.modelId, symbol);
        return row ? {
            obiThreshold: row.obi_threshold,
            zScoreThreshold: row.z_score_threshold,
            takeProfitPct: row.take_profit_pct,
            stopLossPct: row.stop_loss_pct,
        } : null;
    }
    saveManualParameterOverride(symbol, params) {
        const stmt = this.db.prepare(`
      INSERT INTO parameter_history 
        (model_id, symbol, obi_threshold, z_score_threshold, take_profit_pct, stop_loss_pct, source)
      VALUES (?, ?, ?, ?, ?, ?, 'manual_override')
    `);
        stmt.run(this.modelId, symbol, params.obiThreshold, params.zScoreThreshold, params.takeProfitPct, params.stopLossPct);
    }
    getLatestParameterSnapshot(symbol) {
        const query = symbol
            ? `SELECT * FROM parameter_history WHERE model_id = ? AND symbol = ? ORDER BY created_at DESC LIMIT 1`
            : `SELECT * FROM parameter_history WHERE model_id = ? ORDER BY created_at DESC LIMIT 1`;
        const row = this.db.prepare(query).all(this.modelId, ...(symbol ? [symbol] : []));
        if (!row || row.length === 0)
            return null;
        const r = row[0];
        return {
            symbol: r.symbol,
            obiThreshold: r.obi_threshold,
            zScoreThreshold: r.z_score_threshold,
            takeProfitPct: r.take_profit_pct,
            stopLossPct: r.stop_loss_pct,
            source: r.source,
            createdAt: r.created_at,
        };
    }
    // ============================================================
    // SESSION PERFORMANCE (for session-based learning)
    // ============================================================
    saveSessionPerformance(session, trades, wins, losses, netProfitUsd) {
        const winRate = trades > 0 ? (wins / trades) * 100 : 0;
        const stmt = this.db.prepare(`
      INSERT INTO session_performance (model_id, session, trades, wins, losses, net_profit_usd, win_rate)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(this.modelId, session, trades, wins, losses, netProfitUsd, winRate);
    }
    getSessionPerformance(limit = 30) {
        const rows = this.db.prepare(`
      SELECT * FROM session_performance 
      WHERE model_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(this.modelId, limit);
        return rows.map((row) => ({
            session: row.session,
            trades: row.trades,
            wins: row.wins,
            losses: row.losses,
            netProfitUsd: row.net_profit_usd,
            winRate: row.win_rate,
            createdAt: row.created_at,
        }));
    }
    // ============================================================
    // LOAD POSITIONS FROM SUPABASE
    // ============================================================
    async loadPositionsFromSupabase() {
        try {
            const timeoutMs = 3000;
            const fetchPromise = supabaseFetchGet('positions', `model_id=eq.${encodeURIComponent(this.modelId)}&status=eq.OPEN`);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Supabase fetch timeout')), timeoutMs);
            });
            const remotePositions = await Promise.race([fetchPromise, timeoutPromise]);
            if (!remotePositions || remotePositions.length === 0) {
                return 0;
            }
            const insertStmt = this.db.prepare(`
        INSERT OR REPLACE INTO active_positions
          (id, symbol, side, entry_price, quantity, entry_time,
           take_profit_price, stop_loss_price, highest_price, lowest_price,
           entry_reason, is_tp_triggered, model_id, remaining_qty, partial_tps, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            const insertMany = this.db.transaction((positions) => {
                for (const row of positions) {
                    insertStmt.run(row.id, row.symbol, row.side, row.entry_price, row.quantity, row.entry_time, row.take_profit_price, row.stop_loss_price, row.highest_price || row.entry_price, row.lowest_price || row.entry_price, row.entry_reason || null, row.is_tp_triggered ? 1 : 0, row.model_id, row.remaining_qty || row.quantity, row.partial_tps ? JSON.stringify(row.partial_tps) : null, row.status || 'OPEN');
                }
            });
            insertMany(remotePositions);
            console.log(`\x1b[36m[DATABASE] Loaded ${remotePositions.length} positions from Supabase for ${this.modelId}\x1b[0m`);
            return remotePositions.length;
        }
        catch {
            return 0;
        }
    }
    getActivePositionsBySymbol(symbol) {
        const rows = this.db.prepare(`
      SELECT * FROM active_positions 
      WHERE model_id = ? AND symbol = ? AND status = 'OPEN'
    `).all(this.modelId, symbol);
        return rows.map((row) => this.mapPositionRow(row));
    }
    updatePositionStopLoss(positionId, newStopLoss, highestPrice) {
        this.db.prepare(`
      UPDATE active_positions 
      SET stop_loss_price = ?, 
          highest_price = COALESCE(?, highest_price),
          updated_at = strftime('%s','now')
      WHERE id = ?
    `).run(newStopLoss, highestPrice || null, positionId);
    }
    // ============================================================
    // EQUITY CURVE
    // ============================================================
    saveEquitySnapshot(balance, unrealizedPnl) {
        this.db.prepare(`
      INSERT INTO equity_snapshots (model_id, timestamp, balance, unrealized_pnl, total_equity)
      VALUES (?, ?, ?, ?, ?)
    `).run(this.modelId, Date.now(), balance, unrealizedPnl, balance + unrealizedPnl);
        supabaseFetch('equity_snapshots', 'POST', {
            model_id: this.modelId,
            timestamp: Date.now(),
            balance,
            unrealized_pnl: unrealizedPnl,
            total_equity: balance + unrealizedPnl,
        });
    }
    getEquityCurve(limit = 500) {
        const rows = this.db.prepare(`
      SELECT timestamp, total_equity FROM equity_snapshots 
      WHERE model_id = ? 
      ORDER BY timestamp ASC 
      LIMIT ?
    `).all(this.modelId, limit);
        return rows.map((r) => ({ time: r.timestamp, equity: r.total_equity }));
    }
    // ============================================================
    // PERFORMANCE METRICS
    // ============================================================
    savePerformanceMetrics(metrics) {
        const date = new Date().toISOString().split('T')[0];
        this.db.prepare(`
      INSERT OR REPLACE INTO performance_metrics 
        (model_id, date, sharpe_ratio, sortino_ratio, max_drawdown, profit_factor, 
         var_95, consecutive_losses, avg_win, avg_loss)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(this.modelId, date, metrics.sharpeRatio, metrics.sortinoRatio, metrics.maxDrawdown, metrics.profitFactor, metrics.var95, metrics.consecutiveLosses, metrics.avgWin, metrics.avgLoss);
        supabaseFetch('performance_metrics', 'POST', {
            model_id: this.modelId,
            date,
            sharpe_ratio: metrics.sharpeRatio,
            sortino_ratio: metrics.sortinoRatio,
            max_drawdown: metrics.maxDrawdown,
            profit_factor: metrics.profitFactor,
            var_95: metrics.var95,
            consecutive_losses: metrics.consecutiveLosses,
            avg_win: metrics.avgWin,
            avg_loss: metrics.avgLoss,
        });
    }
    getLatestPerformanceMetrics() {
        return this.db.prepare(`
      SELECT * FROM performance_metrics 
      WHERE model_id = ? 
      ORDER BY date DESC LIMIT 1
    `).get(this.modelId);
    }
    // ============================================================
    // AGGREGATION
    // ============================================================
    getStats() {
        const row = this.db.prepare(`
      SELECT 
        COUNT(*) as totalTrades,
        SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END) as winningTrades,
        SUM(CASE WHEN result = 'LOSS' THEN 1 ELSE 0 END) as losingTrades,
        COALESCE(SUM(net_profit), 0) as netProfitUsd
      FROM trades WHERE model_id = ?
    `).get(this.modelId);
        return {
            totalTrades: row?.totalTrades || 0,
            winningTrades: row?.winningTrades || 0,
            losingTrades: row?.losingTrades || 0,
            winRate: row?.totalTrades > 0 ? ((row.winningTrades / row.totalTrades) * 100) : 0,
            grossProfitUsd: 0,
            totalFeesUsd: 0,
            netProfitUsd: row?.netProfitUsd || 0,
            averageHoldTimeSec: 0
        };
    }
    getSymbolPerformance() {
        return this.db.prepare(`
      SELECT symbol, 
             COUNT(*) as trades,
             SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END) as wins,
             SUM(net_profit) as netPnl
      FROM trades 
      WHERE model_id = ?
      GROUP BY symbol
      ORDER BY netPnl DESC
    `).all(this.modelId);
    }
    // ============================================================
    // BACKTESTING HELPERS
    // ============================================================
    clearBacktestData() {
        this.db.exec(`
      DELETE FROM trades WHERE model_id = ?;
      DELETE FROM active_positions WHERE model_id = ?;
      DELETE FROM equity_snapshots WHERE model_id = ?;
    `);
    }
    // ============================================================
    // MISC
    // ============================================================
    close() {
        this.db.close();
    }
    mapTradeRow(row) {
        return {
            id: row.id,
            symbol: row.symbol,
            side: row.side,
            entryPrice: row.entry_price,
            exitPrice: row.exit_price,
            quantity: row.quantity,
            entryTime: row.entry_time,
            exitTime: row.exit_time || 0,
            holdTimeSec: row.hold_time_sec || 0,
            grossProfitUsd: row.gross_profit || 0,
            feesUsd: row.fees || 0,
            netProfitUsd: row.net_profit || 0,
            result: row.result,
            entryReason: row.entry_reason || undefined,
            exitReason: row.exit_reason || undefined,
            modelId: row.model_id
        };
    }
    mapPositionRow(row) {
        return {
            id: row.id,
            symbol: row.symbol,
            side: row.side,
            entryPrice: row.entry_price,
            quantity: row.quantity,
            entryTime: row.entry_time,
            takeProfitPrice: row.take_profit_price,
            stopLossPrice: row.stop_loss_price,
            highestPrice: row.highest_price,
            lowestPrice: row.lowest_price,
            entryReason: row.entry_reason || undefined,
            isTakeProfitTriggered: row.is_tp_triggered === 1,
            modelId: row.model_id,
            remainingQty: row.remaining_qty,
            partialTPs: row.partial_tps ? JSON.parse(row.partial_tps) : undefined
        };
    }
}
