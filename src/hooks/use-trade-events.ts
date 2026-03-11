/**
 * useTradeEvents Hook
 * 
 * React hook for subscribing to real-time trade events via WebSocket.
 * 
 * Features:
 * - Auto-reconnection
 * - Event filtering
 * - Event history
 * - Subscription management
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

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
  
  tradeId?: string;
  positionId?: string;
  orderId?: string;
  clientOrderId?: string;
  
  symbol: string;
  exchange: string;
  direction: 'LONG' | 'SHORT';
  
  price?: number;
  entryPrice?: number;
  exitPrice?: number;
  avgPrice?: number;
  
  quantity?: number;
  amount?: number;
  leverage?: number;
  
  pnl?: number;
  pnlPercent?: number;
  fee?: number;
  
  status: TradeEventStatus;
  reason?: string;
  errorCode?: string;
  errorMessage?: string;
  
  confirmedAt?: Date;
  isDemo: boolean;
  tradingMode: 'DEMO' | 'TESTNET' | 'LIVE';
  metadata?: Record<string, unknown>;
}

export interface TradeEventsSubscription {
  userId?: string;
  accountId?: string;
  symbols?: string[];
  exchanges?: string[];
  eventTypes?: TradeEventType[];
}

export interface UseTradeEventsOptions {
  autoConnect?: boolean;
  maxHistorySize?: number;
  subscription?: TradeEventsSubscription;
  onEvent?: (event: TradeEvent) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

export interface UseTradeEventsReturn {
  events: TradeEvent[];
  latestEvent: TradeEvent | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: Error | null;
  
  subscribe: (subscription: TradeEventsSubscription) => void;
  unsubscribe: () => void;
  clearHistory: () => void;
  getEventsByType: (type: TradeEventType) => TradeEvent[];
  getEventsBySymbol: (symbol: string) => TradeEvent[];
  getPendingEvents: () => TradeEvent[];
  confirmEvent: (eventId: string) => Promise<boolean>;
  reconnect: () => void;
  disconnect: () => void;
}

// ==================== HOOK ====================

export function useTradeEvents(options: UseTradeEventsOptions = {}): UseTradeEventsReturn {
  const {
    autoConnect = true,
    maxHistorySize = 100,
    subscription: initialSubscription,
    onEvent,
    onConnect,
    onDisconnect,
    onError,
  } = options;

  const [events, setEvents] = useState<TradeEvent[]>([]);
  const [latestEvent, setLatestEvent] = useState<TradeEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectDelay = 5000;

  // Convert raw event to typed event
  const parseEvent = useCallback((rawEvent: Record<string, unknown>): TradeEvent => {
    return {
      ...rawEvent,
      timestamp: new Date(rawEvent.timestamp as string),
      confirmedAt: rawEvent.confirmedAt ? new Date(rawEvent.confirmedAt as string) : undefined,
    } as TradeEvent;
  }, []);

  // Handle new event
  const handleEvent = useCallback((rawEvent: Record<string, unknown>) => {
    const event = parseEvent(rawEvent);
    
    setEvents(prev => {
      const newEvents = [event, ...prev];
      return newEvents.slice(0, maxHistorySize);
    });
    
    setLatestEvent(event);
    onEvent?.(event);
  }, [parseEvent, maxHistorySize, onEvent]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    setIsConnecting(true);
    setError(null);

    try {
      const socket = io('/?XTransformPort=3003', {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: maxReconnectAttempts,
        reconnectionDelay,
      });

      socket.on('connect', () => {
        setIsConnected(true);
        setIsConnecting(false);
        setError(null);
        reconnectAttempts.current = 0;
        
        // Subscribe with initial subscription if provided
        if (initialSubscription) {
          socket.emit('subscribe', initialSubscription);
        }
        
        onConnect?.();
      });

      socket.on('disconnect', (reason) => {
        setIsConnected(false);
        setIsConnecting(false);
        
        if (reason === 'io server disconnect') {
          // Server disconnected, try to reconnect
          socket.connect();
        }
        
        onDisconnect?.();
      });

      socket.on('connect_error', (err) => {
        setIsConnecting(false);
        setError(err);
        reconnectAttempts.current++;
        
        if (reconnectAttempts.current >= maxReconnectAttempts) {
          onError?.(new Error('Max reconnection attempts reached'));
        }
      });

      socket.on('trade_event', handleEvent);

      socket.on('initial_events', (data: { events: Record<string, unknown>[] }) => {
        const parsedEvents = data.events.map(parseEvent);
        setEvents(parsedEvents.slice(0, maxHistorySize));
      });

      socketRef.current = socket;
    } catch (err) {
      setIsConnecting(false);
      setError(err instanceof Error ? err : new Error('Connection failed'));
      onError?.(err instanceof Error ? err : new Error('Connection failed'));
    }
  }, [initialSubscription, handleEvent, parseEvent, maxHistorySize, onConnect, onDisconnect, onError]);

  // Disconnect
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  // Subscribe
  const subscribe = useCallback((subscription: TradeEventsSubscription) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('subscribe', subscription);
    }
  }, []);

  // Unsubscribe
  const unsubscribe = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('unsubscribe');
    }
  }, []);

  // Clear history
  const clearHistory = useCallback(() => {
    setEvents([]);
    setLatestEvent(null);
  }, []);

  // Get events by type
  const getEventsByType = useCallback((type: TradeEventType): TradeEvent[] => {
    return events.filter(event => event.type === type);
  }, [events]);

  // Get events by symbol
  const getEventsBySymbol = useCallback((symbol: string): TradeEvent[] => {
    return events.filter(event => event.symbol === symbol);
  }, [events]);

  // Get pending events
  const getPendingEvents = useCallback((): TradeEvent[] => {
    return events.filter(event => event.status === 'pending');
  }, [events]);

  // Confirm event
  const confirmEvent = useCallback(async (eventId: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!socketRef.current?.connected) {
        resolve(false);
        return;
      }

      socketRef.current.emit('confirm_event', {
        eventId,
        confirmation: {
          source: 'MANUAL',
          timestamp: new Date().toISOString(),
        },
      });

      // Wait for confirmation response
      const handler = (data: { eventId: string; confirmedAt: string }) => {
        if (data.eventId === eventId) {
          socketRef.current?.off('event_confirmed', handler);
          
          // Update local event
          setEvents(prev => prev.map(event => 
            event.id === eventId 
              ? { ...event, status: 'confirmed', confirmedAt: new Date(data.confirmedAt) }
              : event
          ));
          
          resolve(true);
        }
      };

      socketRef.current.on('event_confirmed', handler);
      
      // Timeout after 10 seconds
      setTimeout(() => {
        socketRef.current?.off('event_confirmed', handler);
        resolve(false);
      }, 10000);
    });
  }, []);

  // Reconnect
  const reconnect = useCallback(() => {
    disconnect();
    connect();
  }, [connect, disconnect]);

  // Auto-connect on mount - use ref to prevent cascading renders
  const mountedRef = useRef(false);
  
  useEffect(() => {
    if (autoConnect && !mountedRef.current) {
      mountedRef.current = true;
      // Defer connection to next tick to avoid setState in effect
      const timer = setTimeout(() => {
        connect();
      }, 0);
      return () => {
        clearTimeout(timer);
        disconnect();
      };
    }
    return () => {
      disconnect();
    };
  }, [autoConnect]); // Intentionally exclude connect/disconnect to prevent re-runs

  return {
    events,
    latestEvent,
    isConnected,
    isConnecting,
    error,
    subscribe,
    unsubscribe,
    clearHistory,
    getEventsByType,
    getEventsBySymbol,
    getPendingEvents,
    confirmEvent,
    reconnect,
    disconnect,
  };
}

// ==================== SPECIALIZED HOOKS ====================

/**
 * Hook for monitoring a specific position
 */
export function usePositionEvents(positionId: string | null) {
  return useTradeEvents({
    autoConnect: true,
    subscription: positionId ? { 
      // Note: positionId filter would need server support
    } : undefined,
  });
}

/**
 * Hook for monitoring events for a specific symbol
 */
export function useSymbolEvents(symbol: string | null) {
  return useTradeEvents({
    autoConnect: true,
    subscription: symbol ? { symbols: [symbol] } : undefined,
  });
}

/**
 * Hook for monitoring trade confirmations
 */
export function useTradeConfirmations() {
  const { events, confirmEvent, isConnected } = useTradeEvents({
    autoConnect: true,
  });

  const pendingEvents = events.filter(e => e.status === 'pending');

  return {
    pendingEvents,
    confirmEvent,
    isConnected,
    hasPending: pendingEvents.length > 0,
  };
}

// ==================== EXPORTS ====================

export default useTradeEvents;
