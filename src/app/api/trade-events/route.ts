/**
 * Trade Events API Route
 * 
 * Provides:
 * - GET: Server-Sent Events (SSE) endpoint for real-time trade events
 * - POST: Emit trade event (internal use)
 * 
 * Supports filtering via query parameters:
 * - userId: Filter by user ID
 * - accountId: Filter by account ID
 * - symbol: Filter by trading symbol
 * - exchange: Filter by exchange
 * - eventTypes: Comma-separated list of event types
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  tradeEventEmitter,
  type TradeEvent,
  type TradeEventType,
  type TradeEventPayload,
  type TradeEventFilter,
} from '@/lib/trading/trade-events';

// ==================== GET: SSE ENDPOINT ====================

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  
  // Parse filter parameters
  const filter: TradeEventFilter = {
    userId: searchParams.get('userId') || undefined,
    accountId: searchParams.get('accountId') || undefined,
    symbol: searchParams.get('symbol') || undefined,
    exchange: searchParams.get('exchange') || undefined,
    eventTypes: searchParams.get('eventTypes')?.split(',') as TradeEventType[] | undefined,
  };

  // Create a TransformStream for SSE
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection message
      const connectMessage = `data: ${JSON.stringify({ 
        type: 'connected', 
        timestamp: new Date().toISOString(),
        filter 
      })}\n\n`;
      controller.enqueue(encoder.encode(connectMessage));

      // Send recent events
      const recentEvents = tradeEventEmitter.getHistory(filter, 20);
      const historyMessage = `data: ${JSON.stringify({ 
        type: 'history', 
        events: recentEvents,
        count: recentEvents.length 
      })}\n\n`;
      controller.enqueue(encoder.encode(historyMessage));

      // Create filter function
      const shouldInclude = (event: TradeEvent): boolean => {
        if (filter.userId && event.userId !== filter.userId) return false;
        if (filter.accountId && event.accountId !== filter.accountId) return false;
        if (filter.symbol && event.symbol !== filter.symbol) return false;
        if (filter.exchange && event.exchange !== filter.exchange) return false;
        if (filter.eventTypes && filter.eventTypes.length > 0 && 
            !filter.eventTypes.includes(event.type)) return false;
        return true;
      };

      // Subscribe to trade events
      unsubscribe = tradeEventEmitter.subscribe((event: TradeEvent) => {
        try {
          if (shouldInclude(event)) {
            const message = `data: ${JSON.stringify({ 
              type: 'event', 
              event 
            })}\n\n`;
            controller.enqueue(encoder.encode(message));
          }
        } catch (error) {
          console.error('[TradeEvents API] Error sending event:', error);
        }
      });

      // Send heartbeat every 30 seconds
      const heartbeatInterval = setInterval(() => {
        try {
          const heartbeat = `: heartbeat ${Date.now()}\n\n`;
          controller.enqueue(encoder.encode(heartbeat));
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      // Store cleanup function
      (controller as any)._heartbeat = heartbeatInterval;
    },

    cancel() {
      // Cleanup on client disconnect
      if (unsubscribe) {
        unsubscribe();
      }
      if ((this as any)._heartbeat) {
        clearInterval((this as any)._heartbeat);
      }
      console.log('[TradeEvents API] SSE connection closed');
    },
  });

  // Return SSE response
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}

// ==================== POST: EMIT EVENT ====================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate required fields
    const { type, ...payload } = body;
    
    if (!type) {
      return NextResponse.json(
        { error: 'Missing required field: type' },
        { status: 400 }
      );
    }

    const validTypes: TradeEventType[] = [
      'order_placed',
      'order_filled', 
      'order_cancelled',
      'order_rejected',
      'position_opened',
      'position_closed',
      'tp_hit',
      'sl_hit',
    ];

    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid event type: ${type}. Valid types: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate required payload fields
    const requiredFields = ['userId', 'accountId', 'symbol', 'exchange', 'direction', 'isDemo', 'tradingMode'];
    const missingFields = requiredFields.filter(field => payload[field] === undefined);
    
    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Missing required fields: ${missingFields.join(', ')}` },
        { status: 400 }
      );
    }

    // Emit the event
    const event = await tradeEventEmitter.emitEvent(type as TradeEventType, payload as TradeEventPayload);

    return NextResponse.json({
      success: true,
      event: {
        id: event.id,
        type: event.type,
        timestamp: event.timestamp,
        status: event.status,
      },
    });

  } catch (error) {
    console.error('[TradeEvents API] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// ==================== DELETE: CANCEL/REJECT EVENT ====================

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const eventId = searchParams.get('eventId');
    const reason = searchParams.get('reason') || 'Cancelled by user';
    const errorCode = searchParams.get('errorCode');

    if (!eventId) {
      return NextResponse.json(
        { error: 'Missing required parameter: eventId' },
        { status: 400 }
      );
    }

    const event = await tradeEventEmitter.rejectEvent(eventId, reason, errorCode || undefined);

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found or already processed' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      event: {
        id: event.id,
        type: event.type,
        status: event.status,
        reason: event.reason,
      },
    });

  } catch (error) {
    console.error('[TradeEvents API] DELETE error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// ==================== PATCH: CONFIRM EVENT ====================

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { eventId, confirmation } = body;

    if (!eventId) {
      return NextResponse.json(
        { error: 'Missing required field: eventId' },
        { status: 400 }
      );
    }

    if (!confirmation || !confirmation.source) {
      return NextResponse.json(
        { error: 'Missing required field: confirmation.source' },
        { status: 400 }
      );
    }

    const event = await tradeEventEmitter.confirmEvent(eventId, {
      ...confirmation,
      timestamp: confirmation.timestamp ? new Date(confirmation.timestamp) : new Date(),
    });

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found or already confirmed' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      event: {
        id: event.id,
        type: event.type,
        status: event.status,
        confirmedAt: event.confirmedAt,
      },
    });

  } catch (error) {
    console.error('[TradeEvents API] PATCH error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
