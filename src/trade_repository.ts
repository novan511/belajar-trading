import { createClient } from '@supabase/supabase-js';
import { TradeRecord } from './types.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[SUPABASE] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env. Trade persistence to Supabase disabled.');
}

export const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

export async function saveTrade(trade: TradeRecord): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from('trades').insert({
      id: trade.id,
      symbol: trade.symbol,
      side: trade.side,
      entry_price: trade.entryPrice,
      exit_price: trade.exitPrice,
      quantity: trade.quantity,
      entry_time: new Date(trade.entryTime).toISOString(),
      exit_time: new Date(trade.exitTime).toISOString(),
      hold_time_sec: trade.holdTimeSec,
      gross_profit_usd: trade.grossProfitUsd,
      fees_usd: trade.feesUsd,
      net_profit_usd: trade.netProfitUsd,
      result: trade.result,
      entry_reason: trade.entryReason || null,
      exit_reason: trade.exitReason || null,
      partial_closes: trade.partialCloses || null,
      model_id: trade.modelId || null
    });
    if (error) {
      console.error('[SUPABASE] Insert trade failed:', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('[SUPABASE] Exception saving trade:', err.message);
    return false;
  }
}
