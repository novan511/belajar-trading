import { createClient } from '@supabase/supabase-js';
import { TradeRecord, Position } from './types.js';

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

export async function upsertPosition(position: Position): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from('positions').upsert({
      id: position.id,
      symbol: position.symbol,
      side: position.side,
      entry_price: position.entryPrice,
      quantity: position.quantity,
      remaining_qty: position.remainingQty ?? position.quantity,
      entry_time: new Date(position.entryTime).toISOString(),
      take_profit_price: position.takeProfitPrice,
      stop_loss_price: position.stopLossPrice,
      highest_price: position.highestPrice ?? position.entryPrice,
      lowest_price: position.lowestPrice ?? position.entryPrice,
      entry_reason: position.entryReason || null,
      model_id: position.modelId || null,
      is_take_profit_triggered: position.isTakeProfitTriggered ?? false,
      is_active: true,
      updated_at: new Date().toISOString()
    });
    if (error) {
      console.error('[SUPABASE] Upsert position failed:', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('[SUPABASE] Exception upserting position:', err.message);
    return false;
  }
}

export async function closePositionRecord(positionId: string, exitPrice: number): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from('positions').update({
      is_active: false,
      remaining_qty: 0,
      closed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', positionId);
    if (error) {
      console.error('[SUPABASE] Close position failed:', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('[SUPABASE] Exception closing position:', err.message);
    return false;
  }
}
