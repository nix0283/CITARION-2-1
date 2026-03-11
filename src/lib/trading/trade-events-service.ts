/**
 * Trade Events Service
 * 
 * Production-ready WebSocket confirmation system for trade events.
 * Provides real-time trade notifications via WebSocket + Telegram + UI.
 * 
 * Features:
 * - WebSocket trade confirmations with idempotency
 * - Telegram notifications for all trade events
 * - UI real-time updates via event emitter
 * - Trade event persistence for audit
 * - Rate limiting for notifications
 */

import { EventEmitter } from 'events';
import { db } from '@/lib/db';
import { 
  notifyAll, 
  notifyTelegram, 
  notifyUI,
  NotificationEvent,
  NotificationType
} from '@/lib/notification-service';

// ==================== TYPES ====================

export type TradeEventType = 
  | 'TRADE_SUBMITTED'
  | 'TRADE_CONFIRMED'
  | 'TRADE_REJECTED'
  | 'TRADE_FILLED'
  | 'TRADE_PARTIALLY_FILLED'
  | 'TRADE_CANCELLED'
  | 'POSITION_OPENED'
  | 'POSITION_CLOSED'
  | 'POSITION_UPDATED'
  | 'TP_HIT'
  | 'SL_HIT'
  | 'TRAILING_ACTIVATED'
  | 'LIQUIDATION_WARNING';

export interface TradeEvent {
  id: string;
  type: TradeEventType;
  timestamp: Date;
  userId: string;
  accountId: string;
  
  // Trade details
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
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED';
  reason?: string;
  errorCode?: string;
  errorMessage?: string;
  
  // Confirmation
  confirmations?: TradeConfirmation[];
  confirmedAt?: Date;
  
  // Metadata
  isDemo: boolean;
  tradingMode: 'DEMO' | 'TESTNET' | 'LIVE';
  metadata?: Record<string, unknown>;
}

export interface TradeConfirmation {
  source: 'WEBSOCKET' | 'EXCHANGE' | 'MANUAL';
  timestamp: Date;
  confirmedBy?: string;
  data?: Record<string, unknown>;
}

export interface TradeEventSubscriber {
  id: string;
  userId?: string;  // If set, only receive events for this user
  callback: (event: TradeEvent) => void | Promise<void>;
  filter?: (event: TradeEvent) => boolean;
}

export interface TradeEventStats {
  totalEvents: number;
  byType: Record<TradeEventType, number>;
  byExchange: Record<string, number>;
  successRate: number;
  avgConfirmationTime: number;
}

// ==================== TRADE EVENTS MANAGER ====================

class TradeEventsManager extends EventEmitter {
  private subscribers: Map<string, TradeEventSubscriber> = new Map();
  private pendingEvents: Map<string, TradeEvent> = new Map();
  private confirmationTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private eventHistory: TradeEvent[] = [];
  private maxHistorySize: number = 1000;
  
  // Rate limiting
  private notificationCounts: Map<string, number[]> = new Map();
  private readonly RATE_LIMIT_WINDOW = 60000; // 1 minute
  private readonly RATE_LIMIT_MAX = 30; // 30 notifications per minute per user

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  // ==================== EVENT EMISSION ====================

  /**
   * Emit a trade event with confirmation tracking
   */
  async emitTradeEvent(event: TradeEvent): Promise<TradeEvent> {
    // Generate ID if not present
    if (!event.id) {
      event.id = `trade_evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    event.timestamp = event.timestamp || new Date();
    
    // Store in history
    this.addToHistory(event);
    
    // Store pending if awaiting confirmation
    if (event.status === 'PENDING') {
      this.pendingEvents.set(event.id, event);
      this.setupConfirmationTimeout(event);
    }
    
    // Emit to local subscribers
    this.emit('tradeEvent', event);
    this.emit(event.type, event);
    
    // Notify subscribers
    await this.notifySubscribers(event);
    
    // Send notifications (WebSocket + Telegram + UI)
    await this.sendNotifications(event);
    
    // Log to database
    await this.logEventToDatabase(event);
    
    return event;
  }

  /**
   * Confirm a trade event
   */
  async confirmEvent(
    eventId: string, 
    confirmation: TradeConfirmation
  ): Promise<TradeEvent | null> {
    const event = this.pendingEvents.get(eventId);
    if (!event) {
      console.warn(`[TradeEvents] Event not found: ${eventId}`);
      return null;
    }
    
    // Add confirmation
    event.confirmations = event.confirmations || [];
    event.confirmations.push(confirmation);
    
    // Update status
    event.status = 'CONFIRMED';
    event.confirmedAt = new Date();
    
    // Clear timeout
    const timeout = this.confirmationTimeouts.get(eventId);
    if (timeout) {
      clearTimeout(timeout);
      this.confirmationTimeouts.delete(eventId);
    }
    
    // Remove from pending
    this.pendingEvents.delete(eventId);
    
    // Emit confirmation event
    await this.emitTradeEvent({
      ...event,
      type: 'TRADE_CONFIRMED',
    });
    
    console.log(`[TradeEvents] Event confirmed: ${eventId} via ${confirmation.source}`);
    
    return event;
  }

  /**
   * Reject a trade event
   */
  async rejectEvent(
    eventId: string,
    reason: string,
    errorCode?: string
  ): Promise<TradeEvent | null> {
    const event = this.pendingEvents.get(eventId);
    if (!event) return null;
    
    event.status = 'FAILED';
    event.reason = reason;
    event.errorCode = errorCode;
    event.errorMessage = reason;
    
    // Clear timeout
    const timeout = this.confirmationTimeouts.get(eventId);
    if (timeout) {
      clearTimeout(timeout);
      this.confirmationTimeouts.delete(eventId);
    }
    
    // Remove from pending
    this.pendingEvents.delete(eventId);
    
    // Emit rejection event
    await this.emitTradeEvent({
      ...event,
      type: 'TRADE_REJECTED',
    });
    
    return event;
  }

  // ==================== SUBSCRIPTIONS ====================

  /**
   * Subscribe to trade events
   */
  subscribe(subscriber: TradeEventSubscriber): () => void {
    this.subscribers.set(subscriber.id, subscriber);
    
    return () => {
      this.subscribers.delete(subscriber.id);
    };
  }

  /**
   * Subscribe to events for a specific user
   */
  subscribeToUserEvents(
    userId: string,
    callback: (event: TradeEvent) => void | Promise<void>
  ): () => void {
    return this.subscribe({
      id: `user_${userId}_${Date.now()}`,
      userId,
      callback,
    });
  }

  /**
   * Subscribe to WebSocket trade confirmations
   */
  subscribeToWebSocketConfirmations(
    wsId: string,
    callback: (event: TradeEvent) => void
  ): () => void {
    return this.subscribe({
      id: `ws_${wsId}`,
      filter: (event) => event.status === 'CONFIRMED' || event.status === 'FAILED',
      callback,
    });
  }

  // ==================== NOTIFICATIONS ====================

  /**
   * Send notifications via all channels
   */
  private async sendNotifications(event: TradeEvent): Promise<void> {
    // Check rate limit
    if (!this.checkRateLimit(event.userId)) {
      console.warn(`[TradeEvents] Rate limited for user: ${event.userId}`);
      return;
    }
    
    // Create notification event
    const notificationType = this.mapToNotificationType(event.type);
    const notificationEvent: NotificationEvent = {
      type: notificationType,
      title: this.getEventTitle(event),
      message: this.getEventMessage(event),
      data: {
        tradeId: event.tradeId,
        positionId: event.positionId,
        symbol: event.symbol,
        direction: event.direction,
        price: event.price,
        pnl: event.pnl,
        isDemo: event.isDemo,
        tradingMode: event.tradingMode,
      },
      priority: this.getEventPriority(event.type),
      timestamp: event.timestamp,
    };
    
    // Send to all channels
    try {
      await notifyAll(notificationEvent);
    } catch (error) {
      console.error('[TradeEvents] Notification error:', error);
    }
  }

  /**
   * Notify local subscribers
   */
  private async notifySubscribers(event: TradeEvent): Promise<void> {
    const promises = Array.from(this.subscribers.values()).map(async (subscriber) => {
      try {
        // Filter by user if set
        if (subscriber.userId && subscriber.userId !== event.userId) {
          return;
        }
        
        // Apply custom filter
        if (subscriber.filter && !subscriber.filter(event)) {
          return;
        }
        
        await subscriber.callback(event);
      } catch (error) {
        console.error(`[TradeEvents] Subscriber ${subscriber.id} error:`, error);
      }
    });
    
    await Promise.allSettled(promises);
  }

  // ==================== RATE LIMITING ====================

  /**
   * Check rate limit for user
   */
  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const windowStart = now - this.RATE_LIMIT_WINDOW;
    
    let timestamps = this.notificationCounts.get(userId) || [];
    
    // Remove old timestamps
    timestamps = timestamps.filter(t => t > windowStart);
    
    if (timestamps.length >= this.RATE_LIMIT_MAX) {
      return false;
    }
    
    timestamps.push(now);
    this.notificationCounts.set(userId, timestamps);
    
    return true;
  }

  // ==================== TIMEOUT HANDLING ====================

  /**
   * Setup confirmation timeout
   */
  private setupConfirmationTimeout(event: TradeEvent): void {
    const timeout = setTimeout(async () => {
      const pendingEvent = this.pendingEvents.get(event.id);
      if (pendingEvent && pendingEvent.status === 'PENDING') {
        await this.rejectEvent(
          event.id,
          'Confirmation timeout',
          'TIMEOUT'
        );
      }
    }, 30000); // 30 seconds timeout
    
    this.confirmationTimeouts.set(event.id, timeout);
  }

  // ==================== PERSISTENCE ====================

  /**
   * Log event to database
   */
  private async logEventToDatabase(event: TradeEvent): Promise<void> {
    try {
      await db.systemLog.create({
        data: {
          level: event.status === 'FAILED' ? 'ERROR' : 'INFO',
          category: 'TRADE',
          userId: event.userId,
          tradeId: event.tradeId,
          message: `[${event.type}] ${event.symbol} ${event.direction}`,
          details: JSON.stringify({
            eventId: event.id,
            type: event.type,
            status: event.status,
            price: event.price,
            quantity: event.quantity,
            pnl: event.pnl,
            reason: event.reason,
            confirmations: event.confirmations,
            isDemo: event.isDemo,
            tradingMode: event.tradingMode,
          }),
        },
      });
    } catch (error) {
      console.error('[TradeEvents] Failed to log to database:', error);
    }
  }

  // ==================== HISTORY ====================

  /**
   * Add event to history
   */
  private addToHistory(event: TradeEvent): void {
    this.eventHistory.push(event);
    
    // Trim history
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Get event history
   */
  getHistory(options?: {
    userId?: string;
    type?: TradeEventType;
    symbol?: string;
    limit?: number;
  }): TradeEvent[] {
    let events = [...this.eventHistory];
    
    if (options?.userId) {
      events = events.filter(e => e.userId === options.userId);
    }
    if (options?.type) {
      events = events.filter(e => e.type === options.type);
    }
    if (options?.symbol) {
      events = events.filter(e => e.symbol === options.symbol);
    }
    
    if (options?.limit) {
      events = events.slice(-options.limit);
    }
    
    return events;
  }

  // ==================== STATISTICS ====================

  /**
   * Get event statistics
   */
  getStats(): TradeEventStats {
    const events = this.eventHistory;
    
    const byType: Record<TradeEventType, number> = {} as any;
    const byExchange: Record<string, number> = {};
    
    let confirmed = 0;
    let total = 0;
    let totalConfirmationTime = 0;
    
    for (const event of events) {
      // By type
      byType[event.type] = (byType[event.type] || 0) + 1;
      
      // By exchange
      byExchange[event.exchange] = (byExchange[event.exchange] || 0) + 1;
      
      // Success rate
      if (event.status === 'CONFIRMED' || event.status === 'FAILED') {
        total++;
        if (event.status === 'CONFIRMED') {
          confirmed++;
          
          // Confirmation time
          if (event.confirmations && event.confirmations.length > 0 && event.timestamp) {
            const confirmationTime = event.confirmations[0].timestamp.getTime() - event.timestamp.getTime();
            totalConfirmationTime += confirmationTime;
          }
        }
      }
    }
    
    return {
      totalEvents: events.length,
      byType,
      byExchange,
      successRate: total > 0 ? confirmed / total : 0,
      avgConfirmationTime: confirmed > 0 ? totalConfirmationTime / confirmed : 0,
    };
  }

  // ==================== HELPERS ====================

  /**
   * Map trade event type to notification type
   */
  private mapToNotificationType(type: TradeEventType): NotificationType {
    const mapping: Record<TradeEventType, NotificationType> = {
      TRADE_SUBMITTED: 'ORDER_OPENED',
      TRADE_CONFIRMED: 'ORDER_FILLED',
      TRADE_REJECTED: 'ORDER_REJECTED',
      TRADE_FILLED: 'ORDER_FILLED',
      TRADE_PARTIALLY_FILLED: 'ORDER_PARTIAL',
      TRADE_CANCELLED: 'ORDER_REJECTED',
      POSITION_OPENED: 'POSITION_OPENED',
      POSITION_CLOSED: 'POSITION_CLOSED',
      POSITION_UPDATED: 'POSITION_UPDATED',
      TP_HIT: 'TP_HIT',
      SL_HIT: 'SL_HIT',
      TRAILING_ACTIVATED: 'POSITION_UPDATED',
      LIQUIDATION_WARNING: 'LIQUIDATION_WARNING',
    };
    
    return mapping[type] || 'SYSTEM_ERROR';
  }

  /**
   * Get event title for notification
   */
  private getEventTitle(event: TradeEvent): string {
    const modeLabel = event.isDemo ? '[DEMO] ' : `[${event.tradingMode}] `;
    const directionEmoji = event.direction === 'LONG' ? '🟢' : '🔴';
    
    switch (event.type) {
      case 'TRADE_SUBMITTED':
        return `${modeLabel}📋 Trade Submitted`;
      case 'TRADE_CONFIRMED':
        return `${modeLabel}✅ Trade Confirmed`;
      case 'TRADE_REJECTED':
        return `${modeLabel}❌ Trade Rejected`;
      case 'TRADE_FILLED':
        return `${modeLabel}✅ Order Filled`;
      case 'TRADE_PARTIALLY_FILLED':
        return `${modeLabel}🔄 Partial Fill`;
      case 'POSITION_OPENED':
        return `${modeLabel}📊 Position Opened`;
      case 'POSITION_CLOSED':
        return `${modeLabel}🚪 Position Closed`;
      case 'TP_HIT':
        return `${modeLabel}🎯 Take Profit!`;
      case 'SL_HIT':
        return `${modeLabel}🛑 Stop Loss`;
      case 'LIQUIDATION_WARNING':
        return `⚠️ LIQUIDATION WARNING`;
      default:
        return `${modeLabel}📢 Trade Event`;
    }
  }

  /**
   * Get event message for notification
   */
  private getEventMessage(event: TradeEvent): string {
    const directionEmoji = event.direction === 'LONG' ? '🟢' : '🔴';
    const pnlSign = (event.pnl || 0) >= 0 ? '+' : '';
    
    let message = `${directionEmoji} ${event.symbol} ${event.direction}\n`;
    message += `Exchange: ${event.exchange}\n`;
    
    if (event.price) {
      message += `Price: $${event.price.toLocaleString()}\n`;
    }
    
    if (event.quantity) {
      message += `Size: ${event.quantity.toFixed(6)}\n`;
    }
    
    if (event.pnl !== undefined) {
      message += `PnL: ${pnlSign}$${event.pnl.toFixed(2)}\n`;
    }
    
    if (event.reason) {
      message += `Reason: ${event.reason}\n`;
    }
    
    return message.trim();
  }

  /**
   * Get event priority
   */
  private getEventPriority(type: TradeEventType): 'low' | 'normal' | 'high' | 'critical' {
    const highPriority: TradeEventType[] = ['TP_HIT', 'SL_HIT', 'LIQUIDATION_WARNING'];
    const criticalPriority: TradeEventType[] = ['TRADE_REJECTED'];
    
    if (criticalPriority.includes(type)) return 'critical';
    if (highPriority.includes(type)) return 'high';
    return 'normal';
  }
}

// ==================== SINGLETON EXPORT ====================

export const tradeEventsManager = new TradeEventsManager();

// ==================== CONVENIENCE FUNCTIONS ====================

/**
 * Emit a trade submitted event
 */
export async function emitTradeSubmitted(
  userId: string,
  accountId: string,
  symbol: string,
  exchange: string,
  direction: 'LONG' | 'SHORT',
  options: Partial<TradeEvent> = {}
): Promise<TradeEvent> {
  return tradeEventsManager.emitTradeEvent({
    type: 'TRADE_SUBMITTED',
    userId,
    accountId,
    symbol,
    exchange,
    direction,
    status: 'PENDING',
    isDemo: options.isDemo ?? true,
    tradingMode: options.tradingMode || 'DEMO',
    ...options,
  });
}

/**
 * Emit a trade confirmed event
 */
export async function emitTradeConfirmed(
  eventId: string,
  confirmation: TradeConfirmation
): Promise<TradeEvent | null> {
  return tradeEventsManager.confirmEvent(eventId, confirmation);
}

/**
 * Emit a position opened event
 */
export async function emitPositionOpened(
  userId: string,
  accountId: string,
  positionId: string,
  symbol: string,
  exchange: string,
  direction: 'LONG' | 'SHORT',
  entryPrice: number,
  quantity: number,
  leverage: number,
  options: Partial<TradeEvent> = {}
): Promise<TradeEvent> {
  return tradeEventsManager.emitTradeEvent({
    type: 'POSITION_OPENED',
    userId,
    accountId,
    positionId,
    symbol,
    exchange,
    direction,
    entryPrice,
    price: entryPrice,
    quantity,
    leverage,
    status: 'CONFIRMED',
    isDemo: options.isDemo ?? true,
    tradingMode: options.tradingMode || 'DEMO',
    ...options,
  });
}

/**
 * Emit a position closed event
 */
export async function emitPositionClosed(
  userId: string,
  accountId: string,
  positionId: string,
  symbol: string,
  exchange: string,
  direction: 'LONG' | 'SHORT',
  exitPrice: number,
  pnl: number,
  pnlPercent: number,
  reason: string,
  options: Partial<TradeEvent> = {}
): Promise<TradeEvent> {
  return tradeEventsManager.emitTradeEvent({
    type: 'POSITION_CLOSED',
    userId,
    accountId,
    positionId,
    symbol,
    exchange,
    direction,
    exitPrice,
    price: exitPrice,
    pnl,
    pnlPercent,
    reason,
    status: 'CONFIRMED',
    isDemo: options.isDemo ?? true,
    tradingMode: options.tradingMode || 'DEMO',
    ...options,
  });
}

/**
 * Emit a TP hit event
 */
export async function emitTakeProfitHit(
  userId: string,
  accountId: string,
  positionId: string,
  symbol: string,
  exchange: string,
  direction: 'LONG' | 'SHORT',
  tpPrice: number,
  pnl: number,
  options: Partial<TradeEvent> = {}
): Promise<TradeEvent> {
  return tradeEventsManager.emitTradeEvent({
    type: 'TP_HIT',
    userId,
    accountId,
    positionId,
    symbol,
    exchange,
    direction,
    price: tpPrice,
    pnl,
    status: 'CONFIRMED',
    isDemo: options.isDemo ?? true,
    tradingMode: options.tradingMode || 'DEMO',
    ...options,
  });
}

/**
 * Emit a SL hit event
 */
export async function emitStopLossHit(
  userId: string,
  accountId: string,
  positionId: string,
  symbol: string,
  exchange: string,
  direction: 'LONG' | 'SHORT',
  slPrice: number,
  pnl: number,
  options: Partial<TradeEvent> = {}
): Promise<TradeEvent> {
  return tradeEventsManager.emitTradeEvent({
    type: 'SL_HIT',
    userId,
    accountId,
    positionId,
    symbol,
    exchange,
    direction,
    price: slPrice,
    pnl,
    status: 'CONFIRMED',
    isDemo: options.isDemo ?? true,
    tradingMode: options.tradingMode || 'DEMO',
    ...options,
  });
}

// ==================== EXPORTS ====================

export type { TradeEvent as TradeEventType, TradeConfirmation, TradeEventSubscriber };
export default tradeEventsManager;
