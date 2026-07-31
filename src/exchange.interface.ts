import { OrderBook, TradeSignal, Position, Side } from './types.js';
import { CandleSnapshot } from './types.js';

export interface IExchangeConnector {
  onBookUpdate(callback: (book: OrderBook) => void): void;
  connect(): void;
  disconnect(): void;
  submitSimulatedOrder(symbol: string, side: Side, price: number, quantity: number, isMaker?: boolean): Promise<{ orderId: string; success: boolean; executedPrice: number; feeUsd: number }>;
  submitLiveOrder(symbol: string, side: Side, quantity: number): Promise<any>;
  getCandleSnapshot(coin: string, interval: string, limit?: number): Promise<CandleSnapshot[]>;
  isConnected(): boolean;
}
