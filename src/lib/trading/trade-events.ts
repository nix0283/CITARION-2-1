/**
 * Trade Event Emitter
 * 
 * Production-ready trade event emission for the CITARION trading platform.
 * Provides a clean interface for emitting trade events to WebSocket clients
 * and integrates with the execution engine.
 * 
 * Events:
 * - order_placed: Order submitted to exchange
 * - order_filled: Order executed successfully
 * - order_cancelled: Order cancelled
 * - order_rejected: Order rejected by exchange
 * - position_opened: New position opened
 * - position_closed: Position closed
 * - tp_hit: Take profit hit
 * - sl_hit: Stop loss hit
 */

import { EventEmitter } from 'events';
import { db } from '@/lib/db';

// ==================== TYPES ====================

export type TradeEventType =
  | 'order_placed'
  | 'order_filled'
  | 'order_cancelled'
  | 'order_rejected'
  | 'position_opened'
  | 'position_closed'
  | 'tp_hit'
  | 'sl_hit';

export type TradeEventStatus = 'pending' | 'confirmed' | 'failed' | 'cancelled';

export interface TradeEventPayload {
  // Identifiers
  userId: string;
  accountId: string;
  tradeId?: string;
  positionId?: string;
  orderId?: string;
  clientOrderId?: string;
  
  // Symbol info
  symbol: string;
  exchange: string;
  direction: 'LONG' | 'SHORT';
  
  // Price info
  price?: number;
  entryPrice?: number;
  exitPrice?: number;
  avgPrice?: number;
  
  // Size info
  quantity?: number;
  amount?: number;
  leverage?: number;
  
  // PnL
  pnl?: number;
  pnlPercent?: number;
  fee?: number;
  
  // Status
  status: TradeEventStatus;
  reason?: string;
  errorCode?: string;
  errorMessage?: string;
  
  // Mode
  isDemo: boolean;
  tradingMode: 'DEMO' | 'TESTNET' | 'LIVE';
  
  // Additional data
  metadata?: Record<string, unknown>;
}

export interface TradeEvent extends TradeEventPayload {
  id: string;
  type: TradeEventType;
  timestamp: Date;
  confirmations?: TradeConfirmation[];
  confirmedAt?: Date;
}

export interface TradeConfirmation {
  source: 'WEBSOCKET' | 'EXCHANGE' | 'MANUAL';
  timestamp: Date;
  confirmedBy?: string;
  data?: Record<string, unknown>;
}

export interface TradeEventFilter {
  userId?: string;
  accountId?: string;
  symbol?: string;
  exchange?: string;
  eventTypes?: TradeEventType[];
}

export interface TradeEventListener {
  (event: TradeEvent): void | Promise<void>;
}

// ==================== CONFIGURATION ====================

const WEBSOCKET_SERVICE_URL = process.env.TRADE_EVENTS_SERVICE_URL || 'http://localhost:3003';
const MAX_EVENT_HISTORY = 500;
const EVENT_TIMEOUT_MS = 30000;

// ==================== TRADE EVENT EMITTER CLASS ====================

/**
 * TradeEventEmitter
 * 
 * Centralized event emitter for trade events.
 * Provides:
 * - Local event emission (EventEmitter)
 * - WebSocket broadcast to connected clients
 * - Database logging for audit trail
 * - Event history tracking
 */
export class TradeEventEmitter extends EventEmitter {
  private static instance: TradeEventEmitter | null = null;
  private eventHistory: TradeEvent[] = [];
  private pendingEvents: Map<string, { event: TradeEvent; timeout: NodeJS.Timeout }> = new Map();
  private isInitialized: boolean = false;

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  /**
   * Get singleton instance
   */
  static getInstance(): TradeEventEmitter {
    if (!TradeEventEmitter.instance) {
      TradeEventEmitter.instance = new TradeEventEmitter();
    }
    return TradeEventEmitter.instance;
  }

  /**
   * Initialize the emitter
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    this.isInitialized = true;
    console.log('[TradeEventEmitter] Initialized');
  }

  // ==================== EVENT EMISSION ====================

  /**
   * Emit a trade event
   */
  async emitEvent(type: TradeEventType, payload: TradeEventPayload): Promise<TradeEvent> {
    const event: TradeEvent = {
      ...payload,
      id: this.generateEventId(),
      type,
      timestamp: new Date(),
    };

    // Add to history
    this.addToHistory(event);

    // Setup confirmation timeout if pending
    if (event.status === 'pending') {
      this.setupConfirmationTimeout(event);
    }

    // Emit locally
    this.emit('tradeEvent', event);
    this.emit(type, event);

    // Broadcast to WebSocket service
    await this.broadcastToWebSocket(event);

    // Log to database
    await this.logToDatabase(event);

    console.log(`[TradeEventEmitter] Event emitted: ${event.id} (${type}) ${payload.symbol}`);
    
    return event;
  }

  /**
   * Emit order placed event
   */
  async emitOrderPlaced(payload: TradeEventPayload): Promise<TradeEvent> {
    return this.emitEvent('order_placed', { ...payload, status: payload.status || 'pending' });
  }

  /**
   * Emit order filled event
   */
  async emitOrderFilled(payload: TradeEventPayload): Promise<TradeEvent> {
    return this.emitEvent('order_filled', { ...payload, status: 'confirmed' });
  }

  /**
   * Emit order cancelled event
   */
  async emitOrderCancelled(payload: TradeEventPayload): Promise<TradeEvent> {
    return this.emitEvent('order_cancelled', { ...payload, status: 'cancelled' });
  }

  /**
   * Emit order rejected event
   */
  async emitOrderRejected(payload: TradeEventPayload): Promise<TradeEvent> {
    return this.emitEvent('order_rejected', { ...payload, status: 'failed' });
  }

  /**
   * Emit position opened event
   */
  async emitPositionOpened(payload: TradeEventPayload): Promise<TradeEvent> {
    return this.emitEvent('position_opened', { ...payload, status: 'confirmed' });
  }

  /**
   * Emit position closed event
   */
  async emitPositionClosed(payload: TradeEventPayload): Promise<TradeEvent> {
    return this.emitEvent('position_closed', { ...payload, status: 'confirmed' });
  }

  /**
   * Emit TP hit event
   */
  async emitTpHit(payload: TradeEventPayload): Promise<TradeEvent> {
    return this.emitEvent('tp_hit', { ...payload, status: 'confirmed' });
  }

  /**
   * Emit SL hit event
   */
  async emitSlHit(payload: TradeEventPayload): Promise<TradeEvent> {
    return this.emitEvent('sl_hit', { ...payload, status: 'confirmed' });
  }

  // ==================== CONFIRMATION ====================

  /**
   * Confirm a pending event
   */
  async confirmEvent(eventId: string, confirmation: TradeConfirmation): Promise<TradeEvent | null> {
    const pending = this.pendingEvents.get(eventId);
    if (!pending) {
      console.warn(`[TradeEventEmitter] Event not found or already confirmed: ${eventId}`);
      return null;
    }

    // Update event
    const event = pending.event;
    event.status = 'confirmed';
    event.confirmations = [confirmation];
    event.confirmedAt = new Date();

    // Clear timeout
    clearTimeout(pending.timeout);
    this.pendingEvents.delete(eventId);

    // Update history
    const historyIndex = this.eventHistory.findIndex(e => e.id === eventId);
    if (historyIndex !== -1) {
      this.eventHistory[historyIndex] = event;
    }

    // Emit confirmation
    this.emit('eventConfirmed', event);
    
    // Broadcast update
    await this.broadcastToWebSocket(event);
    
    console.log(`[TradeEventEmitter] Event confirmed: ${eventId}`);
    
    return event;
  }

  /**
   * Reject a pending event
   */
  async rejectEvent(eventId: string, reason: string, errorCode?: string): Promise<TradeEvent | null> {
    const pending = this.pendingEvents.get(eventId);
    if (!pending) return null;

    const event = pending.event;
    event.status = 'failed';
    event.reason = reason;
    event.errorCode = errorCode;

    // Clear timeout
    clearTimeout(pending.timeout);
    this.pendingEvents.delete(eventId);

    // Update history
    const historyIndex = this.eventHistory.findIndex(e => e.id === eventId);
    if (historyIndex !== -1) {
      this.eventHistory[historyIndex] = event;
    }

    // Emit rejection
    this.emit('eventRejected', event);
    
    // Broadcast update
    await this.broadcastToWebSocket(event);
    
    console.log(`[TradeEventEmitter] Event rejected: ${eventId} - ${reason}`);
    
    return event;
  }

  // ==================== SUBSCRIPTION ====================

  /**
   * Subscribe to all trade events
   */
  subscribe(listener: TradeEventListener): () => void {
    this.on('tradeEvent', listener);
    return () => this.off('tradeEvent', listener);
  }

  /**
   * Subscribe to specific event types
   */
  subscribeToTypes(types: TradeEventType[], listener: TradeEventListener): () => void {
    const handlers = types.map(type => {
      const handler = (event: TradeEvent) => listener(event);
      this.on(type, handler);
      return { type, handler };
    });

    return () => {
      handlers.forEach(({ type, handler }) => this.off(type, handler));
    };
  }

  /**
   * Subscribe to events for a specific user
   */
  subscribeToUser(userId: string, listener: TradeEventListener): () => void {
    const handler = (event: TradeEvent) => {
      if (event.userId === userId) {
        listener(event);
      }
    };
    
    this.on('tradeEvent', handler);
    return () => this.off('tradeEvent', handler);
  }

  /**
   * Subscribe to events for a specific account
   */
  subscribeToAccount(accountId: string, listener: TradeEventListener): () => void {
    const handler = (event: TradeEvent) => {
      if (event.accountId === accountId) {
        listener(event);
      }
    };
    
    this.on('tradeEvent', handler);
    return () => this.off('tradeEvent', handler);
  }

  /**
   * Subscribe to events for a specific symbol
   */
  subscribeToSymbol(symbol: string, listener: TradeEventListener): () => void {
    const handler = (event: TradeEvent) => {
      if (event.symbol === symbol) {
        listener(event);
      }
    };
    
    this.on('tradeEvent', handler);
    return () => this.off('tradeEvent', handler);
  }

  // ==================== QUERY ====================

  /**
   * Get event history
   */
  getHistory(filter?: TradeEventFilter, limit?: number): TradeEvent[] {
    let events = [...this.eventHistory];

    if (filter?.userId) {
      events = events.filter(e => e.userId === filter.userId);
    }
    if (filter?.accountId) {
      events = events.filter(e => e.accountId === filter.accountId);
    }
    if (filter?.symbol) {
      events = events.filter(e => e.symbol === filter.symbol);
    }
    if (filter?.exchange) {
      events = events.filter(e => e.exchange === filter.exchange);
    }
    if (filter?.eventTypes && filter.eventTypes.length > 0) {
      events = events.filter(e => filter.eventTypes!.includes(e.type));
    }

    if (limit) {
      events = events.slice(-limit);
    }

    return events;
  }

  /**
   * Get pending events
   */
  getPendingEvents(): TradeEvent[] {
    return Array.from(this.pendingEvents.values()).map(p => p.event);
  }

  /**
   * Get event by ID
   */
  getEvent(eventId: string): TradeEvent | undefined {
    return this.eventHistory.find(e => e.id === eventId);
  }

  // ==================== STATISTICS ====================

  /**
   * Get statistics
   */
  getStats(): {
    totalEvents: number;
    pendingEvents: number;
    byType: Record<TradeEventType, number>;
    byExchange: Record<string, number>;
    byStatus: Record<TradeEventStatus, number>;
  } {
    const byType: Record<TradeEventType, number> = {} as any;
    const byExchange: Record<string, number> = {};
    const byStatus: Record<TradeEventStatus, number> = {} as any;

    for (const event of this.eventHistory) {
      byType[event.type] = (byType[event.type] || 0) + 1;
      byExchange[event.exchange] = (byExchange[event.exchange] || 0) + 1;
      byStatus[event.status] = (byStatus[event.status] || 0) + 1;
    }

    return {
      totalEvents: this.eventHistory.length,
      pendingEvents: this.pendingEvents.size,
      byType,
      byExchange,
      byStatus,
    };
  }

  // ==================== PRIVATE METHODS ====================

  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private addToHistory(event: TradeEvent): void {
    this.eventHistory.push(event);
    if (this.eventHistory.length > MAX_EVENT_HISTORY) {
      this.eventHistory.shift();
    }
  }

  private setupConfirmationTimeout(event: TradeEvent): void {
    const timeout = setTimeout(async () => {
      const pending = this.pendingEvents.get(event.id);
      if (pending) {
        await this.rejectEvent(event.id, 'Confirmation timeout', 'TIMEOUT');
      }
    }, EVENT_TIMEOUT_MS);

    this.pendingEvents.set(event.id, { event, timeout });
  }

  private async broadcastToWebSocket(event: TradeEvent): Promise<void> {
    try {
      // Use fetch to call the WebSocket service
      const response = await fetch(`${WEBSOCKET_SERVICE_URL}/emit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        console.warn(`[TradeEventEmitter] Failed to broadcast to WebSocket: ${response.status}`);
      }
    } catch (error) {
      // Don't throw - WebSocket service might not be running
      console.warn('[TradeEventEmitter] WebSocket service unavailable:', error);
    }
  }

  private async logToDatabase(event: TradeEvent): Promise<void> {
    try {
      await db.systemLog.create({
        data: {
          level: event.status === 'failed' ? 'ERROR' : 'INFO',
          category: 'TRADE_EVENT',
          userId: event.userId,
          tradeId: event.tradeId,
          message: `[${event.type}] ${event.symbol} ${event.direction}`,
          details: JSON.stringify({
            eventId: event.id,
            type: event.type,
            status: event.status,
            orderId: event.orderId,
            positionId: event.positionId,
            price: event.price,
            quantity: event.quantity,
            pnl: event.pnl,
            isDemo: event.isDemo,
            tradingMode: event.tradingMode,
          }),
        },
      });
    } catch (error) {
      console.error('[TradeEventEmitter] Failed to log to database:', error);
    }
  }
}

// ==================== SINGLETON EXPORT ====================

export const tradeEventEmitter = TradeEventEmitter.getInstance();

// ==================== CONVENIENCE FUNCTIONS ====================

/**
 * Emit an order placed event
 */
export function emitOrderPlaced(payload: TradeEventPayload): Promise<TradeEvent> {
  return tradeEventEmitter.emitOrderPlaced(payload);
}

/**
 * Emit an order filled event
 */
export function emitOrderFilled(payload: TradeEventPayload): Promise<TradeEvent> {
  return tradeEventEmitter.emitOrderFilled(payload);
}

/**
 * Emit an order cancelled event
 */
export function emitOrderCancelled(payload: TradeEventPayload): Promise<TradeEvent> {
  return tradeEventEmitter.emitOrderCancelled(payload);
}

/**
 * Emit an order rejected event
 */
export function emitOrderRejected(payload: TradeEventPayload): Promise<TradeEvent> {
  return tradeEventEmitter.emitOrderRejected(payload);
}

/**
 * Emit a position opened event
 */
export function emitPositionOpened(payload: TradeEventPayload): Promise<TradeEvent> {
  return tradeEventEmitter.emitPositionOpened(payload);
}

/**
 * Emit a position closed event
 */
export function emitPositionClosed(payload: TradeEventPayload): Promise<TradeEvent> {
  return tradeEventEmitter.emitPositionClosed(payload);
}

/**
 * Emit a TP hit event
 */
export function emitTpHit(payload: TradeEventPayload): Promise<TradeEvent> {
  return tradeEventEmitter.emitTpHit(payload);
}

/**
 * Emit an SL hit event
 */
export function emitSlHit(payload: TradeEventPayload): Promise<TradeEvent> {
  return tradeEventEmitter.emitSlHit(payload);
}

// ==================== EXPORTS ====================

export default tradeEventEmitter;
