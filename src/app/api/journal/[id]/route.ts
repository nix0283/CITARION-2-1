/**
 * Journal Entry API - Individual Entry Operations
 * GET, PUT, DELETE by ID
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';

// ============================================
// Validation Schema for Updates
// ============================================

const JournalUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(10000).optional(),
  symbol: z.string().optional(),
  direction: z.enum(['LONG', 'SHORT']).optional(),
  marketCondition: z.enum(['trending', 'ranging', 'volatile', 'choppy', 'neutral']).optional(),
  entryPrice: z.number().optional(),
  exitPrice: z.number().optional(),
  size: z.number().optional(),
  pnl: z.number().optional(),
  pnlPercent: z.number().optional(),
  entryQuality: z.number().min(0).max(1).optional(),
  exitQuality: z.number().min(0).max(1).optional(),
  riskManagement: z.number().min(0).max(1).optional(),
  lessons: z.array(z.string()).optional(),
  mistakes: z.array(z.string()).optional(),
  improvements: z.array(z.string()).optional(),
  emotion: z.enum(['confident', 'neutral', 'fearful', 'greedy', 'anxious', 'hopeful']).optional(),
  tags: z.array(z.string()).optional(),
  reviewStatus: z.enum(['pending', 'reviewed', 'archived']).optional(),
  confidence: z.number().min(0).max(1).optional(),
  signalSource: z.string().optional(),
  timeInTrade: z.number().optional(),
  tradeDate: z.string().optional(),
});

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

// ============================================
// GET - Single Journal Entry
// ============================================

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const entry = await db.journalEntry.findUnique({
      where: { id },
    });

    if (!entry) {
      return NextResponse.json(
        { success: false, error: 'Entry not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: parseEntry(entry as Record<string, unknown>),
    });
  } catch (error) {
    console.error('[Journal API] GET by ID error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ============================================
// PUT - Update Journal Entry
// ============================================

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const data = JournalUpdateSchema.parse(body);

    // Check if entry exists
    const existing = await db.journalEntry.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Entry not found' },
        { status: 404 }
      );
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    
    if (data.title !== undefined) updateData.title = data.title;
    if (data.content !== undefined) updateData.content = data.content;
    if (data.symbol !== undefined) updateData.symbol = data.symbol.toUpperCase();
    if (data.direction !== undefined) updateData.direction = data.direction;
    if (data.marketCondition !== undefined) updateData.marketCondition = data.marketCondition;
    if (data.entryPrice !== undefined) updateData.entryPrice = data.entryPrice;
    if (data.exitPrice !== undefined) updateData.exitPrice = data.exitPrice;
    if (data.size !== undefined) updateData.size = data.size;
    if (data.pnl !== undefined) updateData.pnl = data.pnl;
    if (data.pnlPercent !== undefined) updateData.pnlPercent = data.pnlPercent;
    if (data.entryQuality !== undefined) updateData.entryQuality = data.entryQuality;
    if (data.exitQuality !== undefined) updateData.exitQuality = data.exitQuality;
    if (data.riskManagement !== undefined) updateData.riskManagement = data.riskManagement;
    if (data.lessons !== undefined) updateData.lessons = JSON.stringify(data.lessons);
    if (data.mistakes !== undefined) updateData.mistakes = JSON.stringify(data.mistakes);
    if (data.improvements !== undefined) updateData.improvements = JSON.stringify(data.improvements);
    if (data.emotion !== undefined) updateData.emotion = data.emotion;
    if (data.tags !== undefined) updateData.tags = JSON.stringify(data.tags);
    if (data.reviewStatus !== undefined) updateData.reviewStatus = data.reviewStatus;
    if (data.confidence !== undefined) updateData.confidence = data.confidence;
    if (data.signalSource !== undefined) updateData.signalSource = data.signalSource;
    if (data.timeInTrade !== undefined) updateData.timeInTrade = data.timeInTrade;
    if (data.tradeDate !== undefined) updateData.tradeDate = new Date(data.tradeDate);

    const entry = await db.journalEntry.update({
      where: { id },
      data: updateData,
    });

    // Update cached stats
    await updateJournalStats(existing.userId as string);

    return NextResponse.json({
      success: true,
      data: parseEntry(entry as Record<string, unknown>),
    });
  } catch (error) {
    console.error('[Journal API] PUT error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, errors: error.errors }, { status: 400 });
    }
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ============================================
// DELETE - Remove Journal Entry
// ============================================

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check if entry exists
    const existing = await db.journalEntry.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Entry not found' },
        { status: 404 }
      );
    }

    await db.journalEntry.delete({ where: { id } });

    // Update cached stats
    await updateJournalStats(existing.userId as string);

    return NextResponse.json({
      success: true,
      message: 'Entry deleted successfully',
    });
  } catch (error) {
    console.error('[Journal API] DELETE error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ============================================
// Stats Update Helper
// ============================================

async function updateJournalStats(userId: string) {
  const entries = await db.journalEntry.findMany({ where: { userId } });

  if (entries.length === 0) {
    await db.journalStats.upsert({
      where: { userId },
      update: {
        totalEntries: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalPnL: 0,
        avgPnL: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        avgEntryQuality: 0,
        avgExitQuality: 0,
        avgRiskMgmt: 0,
        lastUpdated: new Date(),
      },
      create: { userId },
    });
    return;
  }

  const winning = entries.filter(e => (e.pnl as number) > 0);
  const losing = entries.filter(e => (e.pnl as number) < 0);
  const totalPnL = entries.reduce((sum, e) => sum + (e.pnl as number), 0);
  const totalWins = winning.reduce((sum, e) => sum + (e.pnl as number), 0);
  const totalLosses = Math.abs(losing.reduce((sum, e) => sum + (e.pnl as number), 0));
  const winRate = winning.length / entries.length;

  await db.journalStats.upsert({
    where: { userId },
    update: {
      totalEntries: entries.length,
      totalTrades: entries.length,
      winningTrades: winning.length,
      losingTrades: losing.length,
      winRate,
      totalPnL,
      avgPnL: totalPnL / entries.length,
      avgWin: winning.length > 0 ? totalWins / winning.length : 0,
      avgLoss: losing.length > 0 ? totalLosses / losing.length : 0,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
      avgEntryQuality: entries.reduce((sum, e) => sum + (e.entryQuality as number), 0) / entries.length,
      avgExitQuality: entries.reduce((sum, e) => sum + (e.exitQuality as number), 0) / entries.length,
      avgRiskMgmt: entries.reduce((sum, e) => sum + (e.riskManagement as number), 0) / entries.length,
      lastUpdated: new Date(),
    },
    create: {
      userId,
      totalEntries: entries.length,
      winningTrades: winning.length,
      losingTrades: losing.length,
      winRate,
      totalPnL,
    },
  });
}
