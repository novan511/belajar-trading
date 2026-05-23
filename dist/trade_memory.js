import path from 'path';
import fs from 'fs';
export class TradeMemory {
    maxEntries;
    records = [];
    filePath;
    constructor(modelId, maxEntries = 100) {
        this.maxEntries = maxEntries;
        this.filePath = path.join(process.cwd(), `trades_memory_${modelId}.json`);
        this.load();
    }
    load() {
        try {
            if (fs.existsSync(this.filePath)) {
                const data = fs.readFileSync(this.filePath, 'utf-8');
                this.records = JSON.parse(data);
            }
        }
        catch {
            this.records = [];
        }
    }
    save() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.records, null, 2), 'utf-8');
        }
        catch { }
    }
    add(record) {
        this.records.push(record);
        if (this.records.length > this.maxEntries)
            this.records.shift();
        this.save();
    }
    /**
     * Returns a short markdown summary of the recent trades.
     * The summary caps at ~500 tokens to keep the Llama prompt within limits.
     */
    getSummary() {
        if (this.records.length === 0)
            return 'No trade history available.';
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
