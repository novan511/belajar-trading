// src/trade_memory.ts
/**
 * TradeMemory manages a rolling window of recent trades for a given model.
 * It provides utilities to append a TradeRecord, prune old entries, and
 * generate a concise textual summary for Llama prompts.
 */
import { TradeRecord } from './types.js';
import path from 'path';
import fs from 'fs';

export class TradeMemory {
  private readonly maxEntries: number;
  private records: TradeRecord[] = [];
  private readonly filePath: string;

  constructor(modelId: string, maxEntries = 100) {
    this.maxEntries = maxEntries;
    this.filePath = path.join(process.cwd(), `trades_memory_${modelId}.json`);
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        this.records = JSON.parse(data);
      }
    } catch {
      this.records = [];
    }
  }

  private save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.records, null, 2), 'utf-8');
    } catch {}
  }

  public add(record: TradeRecord) {
    this.records.push(record);
    if (this.records.length > this.maxEntries) this.records.shift();
    this.save();
  }

  /**
   * Returns a short markdown summary of the recent trades.
   * The summary caps at ~500 tokens to keep the Llama prompt within limits.
   */
  public getSummary(): string {
    if (this.records.length === 0) return 'No trade history available.';
    const win = this.records.filter(r => r.result === 'WIN').length;
    const loss = this.records.filter(r => r.result === 'LOSS').length;
    const total = this.records.length;
    const winPct = ((win / total) * 100).toFixed(1);
    const lossPct = ((loss / total) * 100).toFixed(1);
    const avgProfit = (this.records.reduce((s, r) => s + r.netProfitUsd, 0) / total).toFixed(2);
    const recent = this.records
      .slice(-5)
      .map(r => `${r.symbol} ${r.side} ${r.result} $${r.netProfitUsd.toFixed(2)}`)
      .join('; ');
    return `Last ${total} trades: ${win} wins (${winPct}%), ${loss} losses (${lossPct}%). Avg P/L: $${avgProfit}. Recent: ${recent}.`;
  }
}
