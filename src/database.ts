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
import { TradeRecord, Position, Side, ExecutionStats } from './types.js';
import { CONFIG } from './config.js';
import Database from 'better-sqlite3';

function supabaseFetch(table: string, method: string, body: any) {
  if (!CONFIG.SUPABASE_ENABLED) return Promise.resolve();
  const url = `${CONFIG.SUPABASE_URL}${table}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': CONFIG.SUPABASE_SERVICE_ROLE_KEY || CONFIG.SUPABASE_ANON_KEY,
    'Prefer': 'return=minimal',
  };
  if (CONFIG.SUPABASE_SERVICE_ROLE_KEY) {
    headers['Authorization'] = `Bearer ${CONFIG.SUPABASE_SERVICE_ROLE_KEY}`;
  }
  return fetch(url, {
    method,
    headers,
    body: JSON.stringify(body),
  }).catch(() => {});
}

export class TradeDatabase {
  private db: any;
  private modelId: string;

  constructor(modelId: string) {
    this.modelId = modelId;
    const dbPath = path.join(process.cwd(), `hft_${modelId}.db`);
    
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    
    this.initializeTables();
    console.log(`\x1b[32m[DATABASE] SQLite initialized: ${dbPath}\x1b[0m`);
  }

  private initializeTables() {
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
    `);
  }

  // ============================================================
  // TRADES
  // ============================================================

  saveTrade(record: TradeRecord) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO trades 
        (id, symbol, side, entry_price, exit_price, quantity, entry_time, exit_time,
         hold_time_sec, gross_profit, fees, net_profit, result, entry_reason, exit_reason, model_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      record.id,
      record.symbol,
      record.side,
      record.entryPrice,
      record.exitPrice || 0,
      record.quantity,
      record.entryTime,
      record.exitTime || 0,
      record.holdTimeSec || 0,
      record.grossProfitUsd || 0,
      record.feesUsd || 0,
      record.netProfitUsd || 0,
      record.result || 'PENDING',
      record.entryReason || null,
      record.exitReason || null,
      this.modelId
    );

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

  getTradeHistory(limit: number = 100, offset: number = 0): TradeRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM trades 
      WHERE model_id = ? 
      ORDER BY entry_time DESC 
      LIMIT ? OFFSET ?
    `).all(this.modelId, limit, offset);

    return rows.map(this.mapTradeRow);
  }

  getTradeHistoryBySymbol(symbol: string, limit: number = 50): TradeRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM trades 
      WHERE model_id = ? AND symbol = ? 
      ORDER BY entry_time DESC 
      LIMIT ?
    `).all(this.modelId, symbol, limit);

    return rows.map(this.mapTradeRow);
  }

  getTradeHistoryByDateRange(startTime: number, endTime: number, symbol?: string): TradeRecord[] {
    let query = `SELECT * FROM trades WHERE model_id = ? AND entry_time >= ? AND entry_time <= ?`;
    const params: any[] = [this.modelId, startTime, endTime];
    
    if (symbol) {
      query += ` AND symbol = ?`;
      params.push(symbol);
    }
    
    query += ` ORDER BY entry_time ASC`;
    
    const rows = this.db.prepare(query).all(...params);
    return rows.map(this.mapTradeRow);
  }

  getTotalTrades(): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM trades WHERE model_id = ?`
    ).get(this.modelId);
    return row?.count || 0;
  }

  // ============================================================
  // ACTIVE POSITIONS
  // ============================================================

  savePosition(position: Position) {
    const existing = this.db.prepare(`SELECT id FROM active_positions WHERE id = ?`).get(position.id);
    if (existing) return;

    const stmt = this.db.prepare(`
      INSERT INTO active_positions
        (id, symbol, side, entry_price, quantity, entry_time, 
         take_profit_price, stop_loss_price, highest_price, lowest_price,
         entry_reason, is_tp_triggered, model_id, remaining_qty, partial_tps, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
    `);

    stmt.run(
      position.id,
      position.symbol,
      position.side,
      position.entryPrice,
      position.quantity,
      position.entryTime,
      position.takeProfitPrice,
      position.stopLossPrice,
      position.highestPrice || position.entryPrice,
      position.lowestPrice || position.entryPrice,
      position.entryReason || null,
      position.isTakeProfitTriggered ? 1 : 0,
      this.modelId,
      position.remainingQty || position.quantity,
      position.partialTPs ? JSON.stringify(position.partialTPs) : null
    );

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

  closePosition(positionId: string) {
    this.db.prepare(`
      UPDATE active_positions 
      SET status = 'CLOSED', updated_at = strftime('%s','now')
      WHERE id = ?
    `).run(positionId);

    fetch(
      `${CONFIG.SUPABASE_URL}positions?id=eq.${encodeURIComponent(positionId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': CONFIG.SUPABASE_SERVICE_ROLE_KEY || CONFIG.SUPABASE_ANON_KEY,
          'Prefer': 'return=minimal',
          ...(CONFIG.SUPABASE_SERVICE_ROLE_KEY ? { 'Authorization': `Bearer ${CONFIG.SUPABASE_SERVICE_ROLE_KEY}` } : {}),
        },
        body: JSON.stringify({ status: 'CLOSED', updated_at: Math.floor(Date.now() / 1000) }),
      }
    ).catch(() => {});
  }

  getAllActivePositions(): Position[] {
    const rows = this.db.prepare(`
      SELECT * FROM active_positions 
      WHERE model_id = ? AND status = 'OPEN'
    `).all(this.modelId);

    return rows.map((row: any) => this.mapPositionRow(row));
  }

  getActivePositionsBySymbol(symbol: string): Position[] {
    const rows = this.db.prepare(`
      SELECT * FROM active_positions 
      WHERE model_id = ? AND symbol = ? AND status = 'OPEN'
    `).all(this.modelId, symbol);

    return rows.map((row: any) => this.mapPositionRow(row));
  }

  updatePositionStopLoss(positionId: string, newStopLoss: number, highestPrice?: number) {
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

  saveEquitySnapshot(balance: number, unrealizedPnl: number) {
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

  getEquityCurve(limit: number = 500): { time: number; equity: number }[] {
    const rows = this.db.prepare(`
      SELECT timestamp, total_equity FROM equity_snapshots 
      WHERE model_id = ? 
      ORDER BY timestamp ASC 
      LIMIT ?
    `).all(this.modelId, limit);

    return rows.map((r: any) => ({ time: r.timestamp, equity: r.total_equity }));
  }

  // ============================================================
  // PERFORMANCE METRICS
  // ============================================================

  savePerformanceMetrics(metrics: {
    sharpeRatio: number;
    sortinoRatio: number;
    maxDrawdown: number;
    profitFactor: number;
    var95: number;
    consecutiveLosses: number;
    avgWin: number;
    avgLoss: number;
  }) {
    const date = new Date().toISOString().split('T')[0];
    
    this.db.prepare(`
      INSERT OR REPLACE INTO performance_metrics 
        (model_id, date, sharpe_ratio, sortino_ratio, max_drawdown, profit_factor, 
         var_95, consecutive_losses, avg_win, avg_loss)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.modelId, date,
      metrics.sharpeRatio, metrics.sortinoRatio, metrics.maxDrawdown,
      metrics.profitFactor, metrics.var95, metrics.consecutiveLosses,
      metrics.avgWin, metrics.avgLoss
    );

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

  getLatestPerformanceMetrics(): any {
    return this.db.prepare(`
      SELECT * FROM performance_metrics 
      WHERE model_id = ? 
      ORDER BY date DESC LIMIT 1
    `).get(this.modelId);
  }

  // ============================================================
  // AGGREGATION
  // ============================================================

  getStats(): ExecutionStats {
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

  getSymbolPerformance(): { symbol: string; trades: number; wins: number; netPnl: number }[] {
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

  private mapTradeRow(row: any): TradeRecord {
    return {
      id: row.id,
      symbol: row.symbol,
      side: row.side as Side,
      entryPrice: row.entry_price,
      exitPrice: row.exit_price,
      quantity: row.quantity,
      entryTime: row.entry_time,
      exitTime: row.exit_time || 0,
      holdTimeSec: row.hold_time_sec || 0,
      grossProfitUsd: row.gross_profit || 0,
      feesUsd: row.fees || 0,
      netProfitUsd: row.net_profit || 0,
      result: row.result as 'WIN' | 'LOSS' | 'BREAKEVEN',
      entryReason: row.entry_reason || undefined,
      exitReason: row.exit_reason || undefined,
      modelId: row.model_id
    };
  }

  private mapPositionRow(row: any): Position {
    return {
      id: row.id,
      symbol: row.symbol,
      side: row.side as Side,
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
