/**
 * Trading Journal API - CRUD Operations
 * Professional journal for trade analysis and improvement
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';

// ============================================
// Validation Schemas
// ============================================

const JournalEntrySchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().max(10000),
  tradeId: z.string().optional(),
  symbol: z.string().optional(),
  direction: z.enum(['LONG', 'SHORT']).optional(),
  marketCondition: z.enum(['trending', 'ranging', 'volatile', 'choppy', 'neutral']).default('neutral'),
  entryPrice: z.number().optional(),
  exitPrice: z.number().optional(),
  size: z.number().optional(),
  pnl: z.number().default(0),
  pnlPercent: z.number().default(0),
  entryQuality: z.number().min(0).max(1).default(0),
  exitQuality: z.number().min(0).max(1).default(0),
  riskManagement: z.number().min(0).max(1).default(0),
  lessons: z.array(z.string()).default([]),
  mistakes: z.array(z.string()).default([]),
  improvements: z.array(z.string()).default([]),
  emotion: z.enum(['confident', 'neutral', 'fearful', 'greedy', 'anxious', 'hopeful']).default('neutral'),
  tags: z.array(z.string()).default([]),
  reviewStatus: z.enum(['pending', 'reviewed', 'archived']).default('pending'),
  confidence: z.number().min(0).max(1).optional(),
  signalSource: z.string().optional(),
  timeInTrade: z.number().optional(),
  tradeDate: z.string().optional(),
});

const QuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['pending', 'reviewed', 'archived', 'all']).optional(),
  symbol: z.string().optional(),
  emotion: z.enum(['confident', 'neutral', 'fearful', 'greedy', 'anxious', 'hopeful']).optional(),
  marketCondition: z.enum(['trending', 'ranging', 'volatile', 'choppy', 'neutral']).optional(),
  direction: z.enum(['LONG', 'SHORT']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  minPnl: z.coerce.number().optional(),
  maxPnl: z.coerce.number().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['tradeDate', 'pnl', 'entryQuality', 'createdAt']).default('tradeDate'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ============================================
// GET - List Journal Entries
// ============================================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const params = Object.fromEntries(searchParams.entries());
    const query = QuerySchema.parse(params);

    // Build filter conditions
    const where: Record<string, unknown> = {};

    if (query.status && query.status !== 'all') {
      where.reviewStatus = query.status;
    }
    if (query.symbol) {
      where.symbol = query.symbol.toUpperCase();
    }
    if (query.emotion) {
      where.emotion = query.emotion;
    }
    if (query.marketCondition) {
      where.marketCondition = query.marketCondition;
    }
    if (query.direction) {
      where.direction = query.direction;
    }
    if (query.minPnl !== undefined || query.maxPnl !== undefined) {
      where.pnl = {};
      if (query.minPnl !== undefined) (where.pnl as Record<string, unknown>).gte = query.minPnl;
      if (query.maxPnl !== undefined) (where.pnl as Record<string, unknown>).lte = query.maxPnl;
    }
    if (query.startDate || query.endDate) {
      where.tradeDate = {};
      if (query.startDate) (where.tradeDate as Record<string, unknown>).gte = new Date(query.startDate);
      if (query.endDate) (where.tradeDate as Record<string, unknown>).lte = new Date(query.endDate);
    }
    if (query.search) {
      where.OR = [
        { title: { contains: query.search } },
        { content: { contains: query.search } },
        { symbol: { contains: query.search.toUpperCase() } },
      ];
    }

    // Execute queries in parallel
    const [entries, total, stats] = await Promise.all([
      db.journalEntry.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { [query.sortBy]: query.sortOrder },
      }),
      db.journalEntry.count({ where }),
      getAggregatedStats(where),
    ]);

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / query.limit);

    return NextResponse.json({
      success: true,
      data: entries.map(parseEntry),
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPrevPage: query.page > 1,
      },
      stats,
    });
  } catch (error) {
    console.error('[Journal API] GET error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, errors: error.errors }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// POST - Create Journal Entry
// ============================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = JournalEntrySchema.parse(body);

    // TODO: Get userId from session when auth is implemented
    // For now, use a demo user ID
    const userId = 'demo-user';

    const entry = await db.journalEntry.create({
      data: {
        userId,
        title: data.title,
        content: data.content,
        tradeId: data.tradeId,
        symbol: data.symbol?.toUpperCase(),
        direction: data.direction,
        marketCondition: data.marketCondition,
        entryPrice: data.entryPrice,
        exitPrice: data.exitPrice,
        size: data.size,
        pnl: data.pnl,
        pnlPercent: data.pnlPercent,
        entryQuality: data.entryQuality,
        exitQuality: data.exitQuality,
        riskManagement: data.riskManagement,
        lessons: JSON.stringify(data.lessons),
        mistakes: JSON.stringify(data.mistakes),
        improvements: JSON.stringify(data.improvements),
        emotion: data.emotion,
        tags: JSON.stringify(data.tags),
        reviewStatus: data.reviewStatus,
        confidence: data.confidence,
        signalSource: data.signalSource,
        timeInTrade: data.timeInTrade,
        tradeDate: data.tradeDate ? new Date(data.tradeDate) : new Date(),
      },
    });

    // Update cached stats
    await updateJournalStats(userId);

    return NextResponse.json({ success: true, data: parseEntry(entry) }, { status: 201 });
  } catch (error) {
    console.error('[Journal API] POST error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, errors: error.errors }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// Helper Functions
// ============================================

function parseEntry(entry: Record<string, unknown>) {
  return {
    ...entry,
    lessons: JSON.parse((entry.lessons as string) || '[]'),
    mistakes: JSON.parse((entry.mistakes as string) || '[]'),
    improvements: JSON.parse((entry.improvements as string) || '[]'),
    tags: JSON.parse((entry.tags as string) || '[]'),
  };
}

async function getAggregatedStats(where: Record<string, unknown>) {
  const entries = await db.journalEntry.findMany({ where });

  if (entries.length === 0) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalPnL: 0,
      avgPnL: 0,
      avgEntryQuality: 0,
      avgExitQuality: 0,
      avgRiskMgmt: 0,
      byCondition: {},
      byEmotion: {},
    };
  }

  const winning = entries.filter(e => (e.pnl as number) > 0);
  const losing = entries.filter(e => (e.pnl as number) < 0);

  const byCondition: Record<string, { count: number; pnl: number; winRate: number }> = {};
  const byEmotion: Record<string, { count: number; pnl: number; winRate: number }> = {};

  for (const entry of entries) {
    // By condition
    const cond = entry.marketCondition as string;
    if (!byCondition[cond]) byCondition[cond] = { count: 0, pnl: 0, winRate: 0 };
    byCondition[cond].count++;
    byCondition[cond].pnl += entry.pnl as number;

    // By emotion
    const emo = entry.emotion as string;
    if (!byEmotion[emo]) byEmotion[emo] = { count: 0, pnl: 0, winRate: 0 };
    byEmotion[emo].count++;
    byEmotion[emo].pnl += entry.pnl as number;
  }

  // Calculate win rates
  for (const cond of Object.keys(byCondition)) {
    const condEntries = entries.filter(e => e.marketCondition === cond);
    byCondition[cond].winRate = condEntries.filter(e => (e.pnl as number) > 0).length / condEntries.length;
  }
  for (const emo of Object.keys(byEmotion)) {
    const emoEntries = entries.filter(e => e.emotion === emo);
    byEmotion[emo].winRate = emoEntries.filter(e => (e.pnl as number) > 0).length / emoEntries.length;
  }

  return {
    totalTrades: entries.length,
    winningTrades: winning.length,
    losingTrades: losing.length,
    winRate: entries.length > 0 ? winning.length / entries.length : 0,
    totalPnL: entries.reduce((sum, e) => sum + (e.pnl as number), 0),
    avgPnL: entries.reduce((sum, e) => sum + (e.pnl as number), 0) / entries.length,
    avgEntryQuality: entries.reduce((sum, e) => sum + (e.entryQuality as number), 0) / entries.length,
    avgExitQuality: entries.reduce((sum, e) => sum + (e.exitQuality as number), 0) / entries.length,
    avgRiskMgmt: entries.reduce((sum, e) => sum + (e.riskManagement as number), 0) / entries.length,
    byCondition,
    byEmotion,
  };
}

async function updateJournalStats(userId: string) {
  const entries = await db.journalEntry.findMany({ where: { userId } });

  const winning = entries.filter(e => (e.pnl as number) > 0);
  const losing = entries.filter(e => (e.pnl as number) < 0);
  const totalPnL = entries.reduce((sum, e) => sum + (e.pnl as number), 0);
  const totalWins = winning.reduce((sum, e) => sum + (e.pnl as number), 0);
  const totalLosses = Math.abs(losing.reduce((sum, e) => sum + (e.pnl as number), 0));

  // Calculate time-based patterns
  const byHour: Record<number, { count: number; pnl: number }> = {};
  const byDayOfWeek: Record<number, { count: number; pnl: number }> = {};

  for (const entry of entries) {
    const date = entry.tradeDate as Date;
    const hour = date.getUTCHours();
    const day = date.getUTCDay();

    if (!byHour[hour]) byHour[hour] = { count: 0, pnl: 0 };
    byHour[hour].count++;
    byHour[hour].pnl += entry.pnl as number;

    if (!byDayOfWeek[day]) byDayOfWeek[day] = { count: 0, pnl: 0 };
    byDayOfWeek[day].count++;
    byDayOfWeek[day].pnl += entry.pnl as number;
  }

  // Detect patterns
  const patterns: string[] = [];
  const winRate = entries.length > 0 ? winning.length / entries.length : 0;

  if (winRate > 0.6) patterns.push('high_win_rate');
  if (winRate < 0.4) patterns.push('low_win_rate');
  if (totalPnL > 0) patterns.push('profitable');
  if (totalPnL < 0) patterns.push('unprofitable');

  // Best/worst hours
  const sortedHours = Object.entries(byHour).sort((a, b) => b[1].pnl - a[1].pnl);
  if (sortedHours.length > 0 && sortedHours[0][1].count >= 3) {
    patterns.push(`best_hour_${sortedHours[0][0]}`);
  }

  // Upsert stats
  await db.journalStats.upsert({
    where: { userId },
    update: {
      totalEntries: entries.length,
      totalTrades: entries.length,
      winningTrades: winning.length,
      losingTrades: losing.length,
      winRate,
      totalPnL,
      avgPnL: entries.length > 0 ? totalPnL / entries.length : 0,
      avgWin: winning.length > 0 ? totalWins / winning.length : 0,
      avgLoss: losing.length > 0 ? totalLosses / losing.length : 0,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
      avgEntryQuality: entries.reduce((sum, e) => sum + (e.entryQuality as number), 0) / (entries.length || 1),
      avgExitQuality: entries.reduce((sum, e) => sum + (e.exitQuality as number), 0) / (entries.length || 1),
      avgRiskMgmt: entries.reduce((sum, e) => sum + (e.riskManagement as number), 0) / (entries.length || 1),
      byCondition: JSON.stringify(await getConditionStats(entries)),
      byEmotion: JSON.stringify(await getEmotionStats(entries)),
      byHour: JSON.stringify(byHour),
      byDayOfWeek: JSON.stringify(byDayOfWeek),
      patterns: JSON.stringify(patterns),
      lastUpdated: new Date(),
    },
    create: {
      userId,
      totalEntries: entries.length,
      totalTrades: entries.length,
      winningTrades: winning.length,
      losingTrades: losing.length,
      winRate,
      totalPnL,
      avgPnL: entries.length > 0 ? totalPnL / entries.length : 0,
      avgWin: winning.length > 0 ? totalWins / winning.length : 0,
      avgLoss: losing.length > 0 ? totalLosses / losing.length : 0,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
      byCondition: JSON.stringify({}),
      byEmotion: JSON.stringify({}),
      byHour: JSON.stringify(byHour),
      byDayOfWeek: JSON.stringify(byDayOfWeek),
      patterns: JSON.stringify(patterns),
    },
  });
}

async function getConditionStats(entries: Record<string, unknown>[]): Promise<Record<string, { count: number; pnl: number; winRate: number }>> {
  const stats: Record<string, { count: number; pnl: number; winRate: number }> = {};
  for (const entry of entries) {
    const cond = entry.marketCondition as string;
    if (!stats[cond]) stats[cond] = { count: 0, pnl: 0, winRate: 0 };
    stats[cond].count++;
    stats[cond].pnl += entry.pnl as number;
  }
  for (const cond of Object.keys(stats)) {
    const condEntries = entries.filter(e => e.marketCondition === cond);
    stats[cond].winRate = condEntries.filter(e => (e.pnl as number) > 0).length / (condEntries.length || 1);
  }
  return stats;
}

async function getEmotionStats(entries: Record<string, unknown>[]): Promise<Record<string, { count: number; pnl: number; winRate: number }>> {
  const stats: Record<string, { count: number; pnl: number; winRate: number }> = {};
  for (const entry of entries) {
    const emo = entry.emotion as string;
    if (!stats[emo]) stats[emo] = { count: 0, pnl: 0, winRate: 0 };
    stats[emo].count++;
    stats[emo].pnl += entry.pnl as number;
  }
  for (const emo of Object.keys(stats)) {
    const emoEntries = entries.filter(e => e.emotion === emo);
    stats[emo].winRate = emoEntries.filter(e => (e.pnl as number) > 0).length / (emoEntries.length || 1);
  }
  return stats;
}
