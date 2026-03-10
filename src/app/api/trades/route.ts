/**
 * Trades API Route
 * Production-ready backend for trades filtering, sorting, and pagination
 * 
 * Features:
 * - Advanced filtering (symbol, direction, status, exchange, date range, PnL range)
 * - Sorting by multiple fields
 * - Pagination with cursor-based navigation
 * - Statistics aggregation
 * - Export capabilities
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import { getDefaultUser } from '@/lib/auth-utils';

// ============================================
// Helper to get user ID (authenticated or default)
// ============================================

async function getUserId(request: NextRequest): Promise<string> {
  // Try session auth first
  const sessionToken = request.cookies.get("next-auth.session-token")?.value ||
                       request.cookies.get("__Secure-next-auth.session-token")?.value;
  
  if (sessionToken) {
    const session = await db.session.findUnique({
      where: { token: sessionToken },
      select: { userId: true },
    });
    if (session) return session.userId;
  }
  
  // Try API key auth
  const apiKey = request.headers.get("X-API-Key");
  if (apiKey && apiKey.startsWith("ck_")) {
    const { createHash } = await import('crypto');
    const keyHash = createHash("sha256").update(apiKey).digest("hex");
    const storedKey = await db.apiKey.findUnique({
      where: { keyHash },
      select: { userId: true },
    });
    if (storedKey) return storedKey.userId;
  }
  
  // Fall back to default user
  const defaultUser = await getDefaultUser();
  return defaultUser.id;
}

// ============================================
// Types & Schemas
// ============================================

const TradeFilterSchema = z.object({
  // Pagination
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
  
  // Basic filters
  symbol: z.string().optional(),
  direction: z.enum(['LONG', 'SHORT']).optional(),
  status: z.enum(['PENDING', 'OPEN', 'CLOSED', 'CANCELLED', 'VIRTUAL_FILLED']).optional(),
  isDemo: z.coerce.boolean().optional(),
  
  // Exchange filter
  exchangeId: z.string().optional(),
  accountId: z.string().optional(),
  
  // Date range
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  entryTimeFrom: z.string().optional(),
  entryTimeTo: z.string().optional(),
  
  // PnL range
  pnlMin: z.coerce.number().optional(),
  pnlMax: z.coerce.number().optional(),
  pnlPercentMin: z.coerce.number().optional(),
  pnlPercentMax: z.coerce.number().optional(),
  
  // Price range
  entryPriceMin: z.coerce.number().optional(),
  entryPriceMax: z.coerce.number().optional(),
  
  // Amount range
  amountMin: z.coerce.number().optional(),
  amountMax: z.coerce.number().optional(),
  
  // Leverage filter
  leverageMin: z.coerce.number().min(1).max(125).optional(),
  leverageMax: z.coerce.number().min(1).max(125).optional(),
  
  // Signal source
  signalSource: z.string().optional(),
  closeReason: z.enum(['TP', 'SL', 'MANUAL', 'LIQUIDATION']).optional(),
  
  // Sorting
  sortBy: z.enum(['createdAt', 'entryTime', 'exitTime', 'pnl', 'pnlPercent', 'amount', 'entryPrice', 'symbol', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  
  // Search
  search: z.string().optional(),
  
  // Stats only mode
  statsOnly: z.coerce.boolean().default(false),
});

export interface TradeStats {
  totalTrades: number;
  totalPnL: number;
  totalFees: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgPnL: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  totalVolume: number;
  avgLeverage: number;
  avgHoldingTime: number;
  bySymbol: Record<string, { count: number; pnl: number; winRate: number }>;
  byDirection: { LONG: { count: number; pnl: number }; SHORT: { count: number; pnl: number } };
  byExchange: Record<string, { count: number; pnl: number }>;
  byStatus: Record<string, number>;
  dailyPnL: Array<{ date: string; pnl: number; count: number }>;
}

// ============================================
// GET - List Trades with Filtering
// ============================================

export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    const { searchParams } = new URL(request.url);
    
    // Parse and validate filter parameters
    const filterResult = TradeFilterSchema.safeParse(Object.fromEntries(searchParams));
    
    if (!filterResult.success) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid filter parameters',
          details: filterResult.error.errors 
        },
        { status: 400 }
      );
    }
    
    const filter = filterResult.data;
    
    // Build where clause
    const where: Record<string, unknown> = {
      userId,
    };
    
    // Symbol filter
    if (filter.symbol) {
      where.symbol = { contains: filter.symbol.toUpperCase() };
    }
    
    // Direction filter
    if (filter.direction) {
      where.direction = filter.direction;
    }
    
    // Status filter
    if (filter.status) {
      where.status = filter.status;
    }
    
    // Demo/Real filter
    if (filter.isDemo !== undefined) {
      where.isDemo = filter.isDemo;
    }
    
    // Account filter
    if (filter.accountId) {
      where.accountId = filter.accountId;
    }
    
    // Date range filters
    if (filter.dateFrom || filter.dateTo) {
      where.createdAt = {};
      if (filter.dateFrom) {
        (where.createdAt as Record<string, unknown>).gte = new Date(filter.dateFrom);
      }
      if (filter.dateTo) {
        (where.createdAt as Record<string, unknown>).lte = new Date(filter.dateTo);
      }
    }
    
    // Entry time filters
    if (filter.entryTimeFrom || filter.entryTimeTo) {
      where.entryTime = {};
      if (filter.entryTimeFrom) {
        (where.entryTime as Record<string, unknown>).gte = new Date(filter.entryTimeFrom);
      }
      if (filter.entryTimeTo) {
        (where.entryTime as Record<string, unknown>).lte = new Date(filter.entryTimeTo);
      }
    }
    
    // PnL range
    if (filter.pnlMin !== undefined || filter.pnlMax !== undefined) {
      where.pnl = {};
      if (filter.pnlMin !== undefined) {
        (where.pnl as Record<string, unknown>).gte = filter.pnlMin;
      }
      if (filter.pnlMax !== undefined) {
        (where.pnl as Record<string, unknown>).lte = filter.pnlMax;
      }
    }
    
    // PnL percent range
    if (filter.pnlPercentMin !== undefined || filter.pnlPercentMax !== undefined) {
      where.pnlPercent = {};
      if (filter.pnlPercentMin !== undefined) {
        (where.pnlPercent as Record<string, unknown>).gte = filter.pnlPercentMin;
      }
      if (filter.pnlPercentMax !== undefined) {
        (where.pnlPercent as Record<string, unknown>).lte = filter.pnlPercentMax;
      }
    }
    
    // Entry price range
    if (filter.entryPriceMin !== undefined || filter.entryPriceMax !== undefined) {
      where.entryPrice = {};
      if (filter.entryPriceMin !== undefined) {
        (where.entryPrice as Record<string, unknown>).gte = filter.entryPriceMin;
      }
      if (filter.entryPriceMax !== undefined) {
        (where.entryPrice as Record<string, unknown>).lte = filter.entryPriceMax;
      }
    }
    
    // Amount range
    if (filter.amountMin !== undefined || filter.amountMax !== undefined) {
      where.amount = {};
      if (filter.amountMin !== undefined) {
        (where.amount as Record<string, unknown>).gte = filter.amountMin;
      }
      if (filter.amountMax !== undefined) {
        (where.amount as Record<string, unknown>).lte = filter.amountMax;
      }
    }
    
    // Leverage range
    if (filter.leverageMin !== undefined || filter.leverageMax !== undefined) {
      where.leverage = {};
      if (filter.leverageMin !== undefined) {
        (where.leverage as Record<string, unknown>).gte = filter.leverageMin;
      }
      if (filter.leverageMax !== undefined) {
        (where.leverage as Record<string, unknown>).lte = filter.leverageMax;
      }
    }
    
    // Signal source filter
    if (filter.signalSource) {
      where.signalSource = filter.signalSource;
    }
    
    // Close reason filter
    if (filter.closeReason) {
      where.closeReason = filter.closeReason;
    }
    
    // Exchange filter (requires join)
    if (filter.exchangeId) {
      where.account = {
        exchangeId: filter.exchangeId
      };
    }
    
    // Search filter (symbol or account)
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      where.OR = [
        { symbol: { contains: searchLower.toUpperCase() } },
        { account: { exchangeName: { contains: searchLower } } },
      ];
    }
    
    // Cursor-based pagination
    if (filter.cursor) {
      where.id = { lt: filter.cursor };
    }
    
    // Stats only mode
    if (filter.statsOnly) {
      const stats = await calculateTradeStats(where);
      return NextResponse.json({
        success: true,
        stats,
      });
    }
    
    // Build orderBy
    const orderBy: Record<string, unknown> = {};
    orderBy[filter.sortBy] = filter.sortOrder;
    
    // Execute queries in parallel
    const [trades, total, stats] = await Promise.all([
      db.trade.findMany({
        where,
        orderBy,
        skip: filter.cursor ? 0 : (filter.page - 1) * filter.limit,
        take: filter.limit,
        include: {
          account: {
            select: {
              id: true,
              exchangeId: true,
              exchangeName: true,
              exchangeType: true,
            },
          },
          position: {
            select: {
              id: true,
              totalAmount: true,
              currentPrice: true,
            },
          },
        },
      }),
      db.trade.count({ where }),
      calculateTradeStats(where),
    ]);
    
    // Calculate pagination metadata
    const totalPages = Math.ceil(total / filter.limit);
    const hasNextPage = trades.length === filter.limit && total > filter.page * filter.limit;
    const hasPrevPage = filter.page > 1;
    
    return NextResponse.json({
      success: true,
      data: trades,
      meta: {
        total,
        page: filter.page,
        limit: filter.limit,
        totalPages,
        hasNextPage,
        hasPrevPage,
        cursor: trades.length > 0 ? trades[trades.length - 1].id : null,
      },
      stats,
      filter: {
        applied: filter,
      },
    });
  } catch (error) {
    console.error('[Trades API] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
};

// ============================================
// Helper: Calculate Trade Statistics
// ============================================

async function calculateTradeStats(where: Record<string, unknown>): Promise<TradeStats> {
  // Get all trades for statistics (limited for performance)
  const trades = await db.trade.findMany({
    where,
    select: {
      id: true,
      symbol: true,
      direction: true,
      status: true,
      pnl: true,
      pnlPercent: true,
      fee: true,
      amount: true,
      leverage: true,
      entryTime: true,
      exitTime: true,
      createdAt: true,
      account: {
        select: {
          exchangeId: true,
        },
      },
    },
    take: 10000, // Limit for performance
  });
  
  const closedTrades = trades.filter(t => t.status === 'CLOSED');
  const winningTrades = closedTrades.filter(t => t.pnl > 0);
  const losingTrades = closedTrades.filter(t => t.pnl < 0);
  
  const totalPnL = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
  const totalFees = trades.reduce((sum, t) => sum + t.fee, 0);
  const totalWins = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
  const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
  
  // Calculate holding times
  const holdingTimes = closedTrades
    .filter(t => t.entryTime && t.exitTime)
    .map(t => (new Date(t.exitTime!).getTime() - new Date(t.entryTime!).getTime()) / (1000 * 60 * 60));
  
  const avgHoldingTime = holdingTimes.length > 0 
    ? holdingTimes.reduce((sum, h) => sum + h, 0) / holdingTimes.length 
    : 0;
  
  // Group by symbol
  const bySymbol: Record<string, { count: number; pnl: number; winRate: number }> = {};
  for (const trade of closedTrades) {
    if (!bySymbol[trade.symbol]) {
      bySymbol[trade.symbol] = { count: 0, pnl: 0, winRate: 0 };
    }
    bySymbol[trade.symbol].count++;
    bySymbol[trade.symbol].pnl += trade.pnl;
  }
  // Calculate win rates
  for (const symbol of Object.keys(bySymbol)) {
    const symbolTrades = closedTrades.filter(t => t.symbol === symbol);
    const wins = symbolTrades.filter(t => t.pnl > 0).length;
    bySymbol[symbol].winRate = symbolTrades.length > 0 ? (wins / symbolTrades.length) * 100 : 0;
  }
  
  // Group by direction
  const longTrades = closedTrades.filter(t => t.direction === 'LONG');
  const shortTrades = closedTrades.filter(t => t.direction === 'SHORT');
  
  // Group by exchange
  const byExchange: Record<string, { count: number; pnl: number }> = {};
  for (const trade of closedTrades) {
    const exchange = (trade.account as { exchangeId?: string })?.exchangeId || 'unknown';
    if (!byExchange[exchange]) {
      byExchange[exchange] = { count: 0, pnl: 0 };
    }
    byExchange[exchange].count++;
    byExchange[exchange].pnl += trade.pnl;
  }
  
  // Group by status
  const byStatus: Record<string, number> = {};
  for (const trade of trades) {
    byStatus[trade.status] = (byStatus[trade.status] || 0) + 1;
  }
  
  // Daily PnL (last 30 days)
  const dailyPnLMap: Record<string, { pnl: number; count: number }> = {};
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  for (const trade of closedTrades.filter(t => t.exitTime && new Date(t.exitTime) >= thirtyDaysAgo)) {
    const date = new Date(trade.exitTime!).toISOString().split('T')[0];
    if (!dailyPnLMap[date]) {
      dailyPnLMap[date] = { pnl: 0, count: 0 };
    }
    dailyPnLMap[date].pnl += trade.pnl;
    dailyPnLMap[date].count++;
  }
  
  const dailyPnL = Object.entries(dailyPnLMap)
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));
  
  return {
    totalTrades: trades.length,
    totalPnL,
    totalFees,
    winCount: winningTrades.length,
    lossCount: losingTrades.length,
    winRate: closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0,
    avgPnL: closedTrades.length > 0 ? totalPnL / closedTrades.length : 0,
    avgWin: winningTrades.length > 0 ? totalWins / winningTrades.length : 0,
    avgLoss: losingTrades.length > 0 ? totalLosses / losingTrades.length : 0,
    largestWin: winningTrades.length > 0 ? Math.max(...winningTrades.map(t => t.pnl)) : 0,
    largestLoss: losingTrades.length > 0 ? Math.min(...losingTrades.map(t => t.pnl)) : 0,
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
    totalVolume: trades.reduce((sum, t) => sum + (t.amount * t.leverage), 0),
    avgLeverage: trades.length > 0 ? trades.reduce((sum, t) => sum + t.leverage, 0) / trades.length : 0,
    avgHoldingTime,
    bySymbol,
    byDirection: {
      LONG: { count: longTrades.length, pnl: longTrades.reduce((sum, t) => sum + t.pnl, 0) },
      SHORT: { count: shortTrades.length, pnl: shortTrades.reduce((sum, t) => sum + t.pnl, 0) },
    },
    byExchange,
    byStatus,
    dailyPnL,
  };
}

// ============================================
// POST - Export Trades
// ============================================

export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    const body = await request.json();
    const { format = 'json', filter = {} } = body;
    
    // Build where clause from filter
    const where: Record<string, unknown> = {
      userId,
    };
    
    // Apply same filters as GET
    if (filter.symbol) where.symbol = { contains: filter.symbol.toUpperCase() };
    if (filter.direction) where.direction = filter.direction;
    if (filter.status) where.status = filter.status;
    if (filter.isDemo !== undefined) where.isDemo = filter.isDemo;
    if (filter.accountId) where.accountId = filter.accountId;
    if (filter.exchangeId) where.account = { exchangeId: filter.exchangeId };
    
    // Date range
    if (filter.dateFrom || filter.dateTo) {
      where.createdAt = {};
      if (filter.dateFrom) (where.createdAt as Record<string, unknown>).gte = new Date(filter.dateFrom);
      if (filter.dateTo) (where.createdAt as Record<string, unknown>).lte = new Date(filter.dateTo);
    }
    
    const trades = await db.trade.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        account: {
          select: {
            exchangeId: true,
            exchangeName: true,
            exchangeType: true,
          },
        },
      },
      take: 10000, // Limit for export
    });
    
    if (format === 'csv') {
      // Generate CSV
      const headers = [
        'ID', 'Symbol', 'Direction', 'Status', 'Entry Price', 'Exit Price',
        'Entry Time', 'Exit Time', 'Amount', 'Leverage', 'PnL', 'PnL %',
        'Fee', 'Stop Loss', 'Close Reason', 'Exchange', 'Demo', 'Created At'
      ];
      
      const rows = trades.map(t => [
        t.id,
        t.symbol,
        t.direction,
        t.status,
        t.entryPrice || '',
        t.exitPrice || '',
        t.entryTime?.toISOString() || '',
        t.exitTime?.toISOString() || '',
        t.amount,
        t.leverage,
        t.pnl,
        t.pnlPercent,
        t.fee,
        t.stopLoss || '',
        t.closeReason || '',
        t.account?.exchangeName || '',
        t.isDemo ? 'Demo' : 'Real',
        t.createdAt.toISOString(),
      ]);
      
      const csv = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');
      
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="trades-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }
    
    // Return JSON by default
    return NextResponse.json({
      success: true,
      data: trades,
      exportedAt: new Date().toISOString(),
      count: trades.length,
    });
  } catch (error) {
    console.error('[Trades API] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ============================================
// DELETE - Bulk Delete Trades
// ============================================

export async function DELETE(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    const { searchParams } = new URL(request.url);
    const ids = searchParams.get('ids')?.split(',').filter(Boolean) || [];
    
    if (ids.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No trade IDs provided' },
        { status: 400 }
      );
    }
    
    // Verify ownership before deletion
    const trades = await db.trade.findMany({
      where: {
        id: { in: ids },
        userId,
      },
      select: { id: true, status: true },
    });
    
    const closedIds = trades.filter(t => t.status === 'CLOSED').map(t => t.id);
    
    // Only delete closed trades
    if (closedIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No closed trades to delete. Only closed trades can be deleted.' },
        { status: 400 }
      );
    }
    
    await db.trade.deleteMany({
      where: {
        id: { in: closedIds },
        userId,
      },
    });
    
    return NextResponse.json({
      success: true,
      deleted: closedIds.length,
      skipped: ids.length - closedIds.length,
      message: `Deleted ${closedIds.length} closed trades`,
    });
  } catch (error) {
    console.error('[Trades API] DELETE error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
