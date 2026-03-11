/**
 * Trade Events WebSocket Service
 * 
 * Production-ready WebSocket service for real-time trade confirmations.
 * Provides low-latency trade event broadcasting to connected clients.
 * 
 * Port: 3003
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

import { Server, Socket } from "socket.io";

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
  status: TradeEventStatus;
  reason?: string;
  errorCode?: string;
  errorMessage?: string;
  
  // Confirmation data
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

export interface ClientSubscription {
  userId?: string;
  accountId?: string;
  symbols?: string[];
  exchanges?: string[];
  eventTypes?: TradeEventType[];
}

interface ConnectedClient {
  id: string;
  userId?: string;
  accountIds: string[];
  subscriptions: ClientSubscription;
  connectedAt: Date;
  lastActivity: Date;
}

// ==================== CONFIGURATION ====================

const PORT = 3003;

// CORS Configuration
const getAllowedOrigins = (): string[] => {
  const env = process.env.NODE_ENV || 'development';
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;

  if (allowedOriginsEnv) {
    return allowedOriginsEnv.split(',').map(origin => origin.trim()).filter(Boolean);
  }

  if (env === 'production') {
    console.error(
      '[SECURITY] ALLOWED_ORIGINS not set in production. ' +
      'CORS will block all cross-origin requests.'
    );
    return [];
  }

  return [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ];
};

const allowedOrigins = getAllowedOrigins();

// ==================== IN-MEMORY STORAGE ====================

const connectedClients = new Map<string, ConnectedClient>();
const eventHistory: TradeEvent[] = [];
const pendingConfirmations = new Map<string, { 
  event: TradeEvent; 
  timeout: NodeJS.Timeout;
  attempts: number;
}>();

const MAX_HISTORY_SIZE = 1000;
const CONFIRMATION_TIMEOUT_MS = 30000; // 30 seconds
const MAX_RETRY_ATTEMPTS = 3;

// ==================== HELPER FUNCTIONS ====================

function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

function addToHistory(event: TradeEvent): void {
  eventHistory.push(event);
  if (eventHistory.length > MAX_HISTORY_SIZE) {
    eventHistory.shift();
  }
}

function getEventHistory(options?: {
  userId?: string;
  accountId?: string;
  symbol?: string;
  type?: TradeEventType;
  limit?: number;
}): TradeEvent[] {
  let events = [...eventHistory];

  if (options?.userId) {
    events = events.filter(e => e.userId === options.userId);
  }
  if (options?.accountId) {
    events = events.filter(e => e.accountId === options.accountId);
  }
  if (options?.symbol) {
    events = events.filter(e => e.symbol === options.symbol);
  }
  if (options?.type) {
    events = events.filter(e => e.type === options.type);
  }

  if (options?.limit) {
    events = events.slice(-options.limit);
  }

  return events;
}

function setupConfirmationTimeout(event: TradeEvent): void {
  const timeout = setTimeout(() => {
    const pending = pendingConfirmations.get(event.id);
    if (pending) {
      pending.attempts++;
      
      if (pending.attempts >= MAX_RETRY_ATTEMPTS) {
        // Mark as failed after max retries
        const failedEvent: TradeEvent = {
          ...event,
          status: 'failed',
          reason: 'Confirmation timeout after max retries',
          errorCode: 'TIMEOUT',
        };
        
        pendingConfirmations.delete(event.id);
        addToHistory(failedEvent);
        broadcastTradeEvent(failedEvent);
        
        console.warn(`[TradeEvents] Event ${event.id} failed after ${MAX_RETRY_ATTEMPTS} attempts`);
      } else {
        // Retry - re-emit the event
        console.log(`[TradeEvents] Retrying event ${event.id}, attempt ${pending.attempts}`);
        broadcastTradeEvent(event);
        setupConfirmationTimeout(event);
      }
    }
  }, CONFIRMATION_TIMEOUT_MS);

  pendingConfirmations.set(event.id, { event, timeout, attempts: 0 });
}

function clearConfirmationTimeout(eventId: string): void {
  const pending = pendingConfirmations.get(eventId);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingConfirmations.delete(eventId);
  }
}

function matchesSubscription(event: TradeEvent, subscription: ClientSubscription): boolean {
  // If no specific filters, match all
  if (!subscription.userId && 
      !subscription.accountId && 
      (!subscription.symbols || subscription.symbols.length === 0) &&
      (!subscription.exchanges || subscription.exchanges.length === 0) &&
      (!subscription.eventTypes || subscription.eventTypes.length === 0)) {
    return true;
  }

  // Check each filter
  if (subscription.userId && event.userId !== subscription.userId) {
    return false;
  }
  if (subscription.accountId && event.accountId !== subscription.accountId) {
    return false;
  }
  if (subscription.symbols && subscription.symbols.length > 0 && 
      !subscription.symbols.includes(event.symbol)) {
    return false;
  }
  if (subscription.exchanges && subscription.exchanges.length > 0 && 
      !subscription.exchanges.includes(event.exchange)) {
    return false;
  }
  if (subscription.eventTypes && subscription.eventTypes.length > 0 && 
      !subscription.eventTypes.includes(event.type)) {
    return false;
  }

  return true;
}

// ==================== BROADCASTING ====================

function broadcastTradeEvent(event: TradeEvent): void {
  let recipientCount = 0;

  for (const [socketId, client] of connectedClients) {
    if (matchesSubscription(event, client.subscriptions)) {
      io.to(socketId).emit('trade_event', event);
      recipientCount++;
    }
  }

  console.log(`[TradeEvents] Broadcast ${event.type} event ${event.id} to ${recipientCount} clients`);
}

function broadcastToUser(userId: string, event: TradeEvent): void {
  for (const [socketId, client] of connectedClients) {
    if (client.userId === userId || client.subscriptions.userId === userId) {
      io.to(socketId).emit('trade_event', event);
    }
  }
}

function broadcastToAccount(accountId: string, event: TradeEvent): void {
  for (const [socketId, client] of connectedClients) {
    if (client.accountIds.includes(accountId) || 
        client.subscriptions.accountId === accountId) {
      io.to(socketId).emit('trade_event', event);
    }
  }
}

// ==================== STATISTICS ====================

interface ServiceStats {
  connectedClients: number;
  totalEventsProcessed: number;
  pendingConfirmations: number;
  eventsByType: Record<TradeEventType, number>;
  eventsByExchange: Record<string, number>;
  eventsByStatus: Record<TradeEventStatus, number>;
  uptime: number;
}

function getStats(): ServiceStats {
  const eventsByType: Record<TradeEventType, number> = {} as any;
  const eventsByExchange: Record<string, number> = {};
  const eventsByStatus: Record<TradeEventStatus, number> = {} as any;

  for (const event of eventHistory) {
    eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
    eventsByExchange[event.exchange] = (eventsByExchange[event.exchange] || 0) + 1;
    eventsByStatus[event.status] = (eventsByStatus[event.status] || 0) + 1;
  }

  return {
    connectedClients: connectedClients.size,
    totalEventsProcessed: eventHistory.length,
    pendingConfirmations: pendingConfirmations.size,
    eventsByType,
    eventsByExchange,
    eventsByStatus,
    uptime: process.uptime(),
  };
}

// ==================== INITIALIZE SOCKET.IO SERVER ====================

const io = new Server(PORT, {
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.length === 0) {
        const env = process.env.NODE_ENV || 'development';
        if (env === 'production') {
          callback(new Error('CORS policy: No origins configured'), false);
        } else {
          callback(null, true);
        }
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('CORS policy: Origin not allowed'), false);
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 10000,
});

console.log(`Trade Events Service running on port ${PORT}`);
console.log(`CORS allowed origins: ${allowedOrigins.length > 0 ? allowedOrigins.join(', ') : 'All (development only)'}`);

// ==================== SOCKET EVENT HANDLERS ====================

io.on('connection', (socket: Socket) => {
  const clientId = socket.id;
  console.log(`[TradeEvents] Client connected: ${clientId}`);

  // Initialize client state
  const client: ConnectedClient = {
    id: clientId,
    accountIds: [],
    subscriptions: {},
    connectedAt: new Date(),
    lastActivity: new Date(),
  };
  connectedClients.set(clientId, client);

  // Send initial data
  socket.emit('connected', {
    clientId,
    serverTime: new Date().toISOString(),
    message: 'Connected to Trade Events Service',
  });

  // Send recent events
  const recentEvents = getEventHistory({ limit: 50 });
  socket.emit('initial_events', {
    events: recentEvents,
    count: recentEvents.length,
  });

  // ==================== AUTHENTICATION ====================

  socket.on('authenticate', (data: { userId: string; accountIds?: string[] }) => {
    client.userId = data.userId;
    if (data.accountIds) {
      client.accountIds = data.accountIds;
    }
    client.subscriptions.userId = data.userId;
    client.lastActivity = new Date();

    socket.emit('authenticated', {
      userId: data.userId,
      accountIds: client.accountIds,
    });

    console.log(`[TradeEvents] Client ${clientId} authenticated as user ${data.userId}`);
  });

  // ==================== SUBSCRIPTIONS ====================

  socket.on('subscribe', (subscription: ClientSubscription) => {
    client.subscriptions = { ...client.subscriptions, ...subscription };
    client.lastActivity = new Date();

    socket.emit('subscribed', {
      subscription: client.subscriptions,
    });

    console.log(`[TradeEvents] Client ${clientId} updated subscription:`, subscription);
  });

  socket.on('unsubscribe', () => {
    client.subscriptions = {};
    client.lastActivity = new Date();

    socket.emit('unsubscribed', { message: 'All subscriptions cleared' });
    console.log(`[TradeEvents] Client ${clientId} cleared all subscriptions`);
  });

  // ==================== TRADE EVENT EMISSION ====================

  socket.on('emit_event', (event: Omit<TradeEvent, 'id' | 'timestamp'>) => {
    client.lastActivity = new Date();

    // Create full event
    const fullEvent: TradeEvent = {
      ...event,
      id: generateEventId(),
      timestamp: new Date(),
    };

    // Add to history
    addToHistory(fullEvent);

    // Setup confirmation timeout if pending
    if (fullEvent.status === 'pending') {
      setupConfirmationTimeout(fullEvent);
    }

    // Broadcast to all matching clients
    broadcastTradeEvent(fullEvent);

    // Send confirmation back to emitter
    socket.emit('event_emitted', {
      eventId: fullEvent.id,
      timestamp: fullEvent.timestamp,
    });

    console.log(`[TradeEvents] Event ${fullEvent.id} emitted: ${fullEvent.type} ${fullEvent.symbol}`);
  });

  // ==================== EVENT CONFIRMATION ====================

  socket.on('confirm_event', (data: { 
    eventId: string; 
    confirmation: TradeConfirmation;
  }) => {
    client.lastActivity = new Date();

    const pending = pendingConfirmations.get(data.eventId);
    if (pending) {
      const confirmedEvent: TradeEvent = {
        ...pending.event,
        status: 'confirmed',
        confirmations: [data.confirmation],
        confirmedAt: new Date(),
      };

      clearConfirmationTimeout(data.eventId);
      addToHistory(confirmedEvent);
      broadcastTradeEvent(confirmedEvent);

      socket.emit('event_confirmed', {
        eventId: data.eventId,
        confirmedAt: confirmedEvent.confirmedAt,
      });

      console.log(`[TradeEvents] Event ${data.eventId} confirmed via ${data.confirmation.source}`);
    } else {
      // Check history for the event
      const historyEvent = eventHistory.find(e => e.id === data.eventId);
      if (historyEvent) {
        socket.emit('event_already_confirmed', {
          eventId: data.eventId,
          status: historyEvent.status,
        });
      } else {
        socket.emit('event_not_found', {
          eventId: data.eventId,
          error: 'Event not found',
        });
      }
    }
  });

  socket.on('reject_event', (data: {
    eventId: string;
    reason: string;
    errorCode?: string;
  }) => {
    client.lastActivity = new Date();

    const pending = pendingConfirmations.get(data.eventId);
    if (pending) {
      const rejectedEvent: TradeEvent = {
        ...pending.event,
        status: 'failed',
        reason: data.reason,
        errorCode: data.errorCode,
      };

      clearConfirmationTimeout(data.eventId);
      addToHistory(rejectedEvent);
      broadcastTradeEvent(rejectedEvent);

      socket.emit('event_rejected', {
        eventId: data.eventId,
        reason: data.reason,
      });

      console.log(`[TradeEvents] Event ${data.eventId} rejected: ${data.reason}`);
    }
  });

  // ==================== QUERY EVENTS ====================

  socket.on('get_events', (options?: {
    userId?: string;
    accountId?: string;
    symbol?: string;
    type?: TradeEventType;
    limit?: number;
  }) => {
    client.lastActivity = new Date();
    const events = getEventHistory(options);

    socket.emit('events', {
      events,
      count: events.length,
      filters: options,
    });
  });

  socket.on('get_pending_events', () => {
    client.lastActivity = new Date();
    const pending = Array.from(pendingConfirmations.values()).map(p => p.event);

    socket.emit('pending_events', {
      events: pending,
      count: pending.length,
    });
  });

  // ==================== STATISTICS ====================

  socket.on('get_stats', () => {
    client.lastActivity = new Date();
    socket.emit('stats', getStats());
  });

  // ==================== HEARTBEAT ====================

  socket.on('ping', () => {
    client.lastActivity = new Date();
    socket.emit('pong', { timestamp: new Date().toISOString() });
  });

  // ==================== DISCONNECT ====================

  socket.on('disconnect', (reason) => {
    connectedClients.delete(clientId);
    console.log(`[TradeEvents] Client ${clientId} disconnected: ${reason}`);
  });

  socket.on('error', (error) => {
    console.error(`[TradeEvents] Socket error for ${clientId}:`, error);
  });
});

// ==================== HTTP HEALTH CHECK ====================

// Simple HTTP health check endpoint
import { createServer } from 'http';

const healthServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      service: 'trade-events-service',
      port: PORT,
      stats: getStats(),
    }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

healthServer.listen(PORT + 1, () => {
  console.log(`Health check server running on port ${PORT + 1}`);
});

// ==================== GRACEFUL SHUTDOWN ====================

function gracefulShutdown(signal: string) {
  console.log(`[TradeEvents] ${signal} received, shutting down gracefully...`);

  // Notify all clients
  io.emit('server_shutdown', {
    message: 'Server is shutting down',
    timestamp: new Date().toISOString(),
  });

  // Clear all pending timeouts
  for (const [eventId, pending] of pendingConfirmations) {
    clearTimeout(pending.timeout);
  }
  pendingConfirmations.clear();

  // Close Socket.IO server
  io.close(() => {
    console.log('[TradeEvents] Socket.IO server closed');
  });

  // Close health server
  healthServer.close(() => {
    console.log('[TradeEvents] Health server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.log('[TradeEvents] Forced shutdown');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ==================== STARTUP COMPLETE ====================

console.log('Trade Events Service initialized');
console.log('Features:');
console.log('  - Real-time trade event broadcasting');
console.log('  - Event confirmation with timeout & retry');
console.log('  - User/account-based filtering');
console.log('  - Event history & statistics');
console.log('  - Health check endpoint');
