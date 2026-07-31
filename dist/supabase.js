import { CONFIG } from './config.js';
export const SUPABASE_URL = CONFIG.SUPABASE_URL || 'https://myvuvhagzvrfkbcwekqs.supabase.co/rest/v1/';
export const SUPABASE_ANON_KEY = CONFIG.SUPABASE_ANON_KEY || '';
export const SUPABASE_SERVICE_ROLE_KEY = CONFIG.SUPABASE_SERVICE_ROLE_KEY || '';
export const SUPABASE_TABLES = {
    trades: 'trades',
    active_positions: 'active_positions',
    equity_snapshots: 'equity_snapshots',
    performance_metrics: 'performance_metrics',
};
