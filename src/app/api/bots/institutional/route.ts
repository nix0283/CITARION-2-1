import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Valid institutional bot types
const VALID_BOT_TYPES = ['SPECTRUM', 'REED', 'ARCHITECT', 'EQUILIBRIST', 'KRON'] as const;
type BotType = typeof VALID_BOT_TYPES[number];

// Bot type to model mapping
const BOT_MODELS = {
  SPECTRUM: db.spectrumBot,
  REED: db.reedBot,
  ARCHITECT: db.architectBot,
  EQUILIBRIST: db.equilibristBot,
  KRON: db.kronBot,
} as const;

// GET - List all institutional bots for user
export async function GET(req: NextRequest) {
  try {
    // For demo, use demo-user
    const userId = 'demo-user';

    const [spectrumBots, reedBots, architectBots, equilibristBots, kronBots] = await Promise.all([
      db.spectrumBot.findMany({ where: { userId }, include: { account: { select: { exchangeName: true, exchangeId: true } } } }),
      db.reedBot.findMany({ where: { userId }, include: { account: { select: { exchangeName: true, exchangeId: true } } } }),
      db.architectBot.findMany({ where: { userId }, include: { account: { select: { exchangeName: true, exchangeId: true } } } }),
      db.equilibristBot.findMany({ where: { userId }, include: { account: { select: { exchangeName: true, exchangeId: true } } } }),
      db.kronBot.findMany({ where: { userId }, include: { account: { select: { exchangeName: true, exchangeId: true } } } }),
    ]);

    // Add botType to each bot for frontend identification
    const allBots = [
      ...spectrumBots.map(b => ({ ...b, botType: 'SPECTRUM' })),
      ...reedBots.map(b => ({ ...b, botType: 'REED' })),
      ...architectBots.map(b => ({ ...b, botType: 'ARCHITECT' })),
      ...equilibristBots.map(b => ({ ...b, botType: 'EQUILIBRIST' })),
      ...kronBots.map(b => ({ ...b, botType: 'KRON' })),
    ];

    return NextResponse.json({
      success: true,
      data: allBots,
      summary: {
        total: allBots.length,
        active: allBots.filter(b => b.isActive).length,
        byType: {
          SPECTRUM: spectrumBots.length,
          REED: reedBots.length,
          ARCHITECT: architectBots.length,
          EQUILIBRIST: equilibristBots.length,
          KRON: kronBots.length,
        },
      },
    });
  } catch (error) {
    console.error('[InstitutionalBots] Get error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Create a new institutional bot
export async function POST(req: NextRequest) {
  try {
    // For demo, use demo-user
    const userId = 'demo-user';

    const body = await req.json();
    const { botType, name, symbol, accountId, config } = body;

    // Validate bot type
    if (!VALID_BOT_TYPES.includes(botType)) {
      return NextResponse.json(
        { success: false, error: `Invalid bot type. Valid types: ${VALID_BOT_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // Create bot based on type
    const baseData = {
      userId,
      name: name || `${botType.charAt(0) + botType.slice(1).toLowerCase()} Bot`,
      symbol: symbol || 'BTCUSDT',
      accountId: accountId || null,
      configJson: config ? JSON.stringify(config) : '{}',
    };

    let result;

    switch (botType) {
      case 'SPECTRUM':
        result = await db.spectrumBot.create({
          data: {
            ...baseData,
            algorithm: 'SPECTRUM',
            maxPositionSize: config?.maxPositionSize || 100,
          },
        });
        break;

      case 'REED':
        result = await db.reedBot.create({
          data: {
            ...baseData,
            algorithm: 'STA',
            lookbackPeriod: config?.lookbackPeriod || 20,
            deviationThreshold: config?.deviationThreshold || 2.0,
          },
        });
        break;

      case 'ARCHITECT':
        result = await db.architectBot.create({
          data: {
            ...baseData,
            algorithm: 'MM',
            baseSpreadBps: config?.baseSpreadBps || 10,
            minSpreadBps: config?.minSpreadBps || 5,
            maxInventory: config?.maxInventory || 1000,
          },
        });
        break;

      case 'EQUILIBRIST':
        result = await db.equilibristBot.create({
          data: {
            ...baseData,
            algorithm: 'MR',
            lookbackPeriod: config?.lookbackPeriod || 14,
            thresholdPercent: config?.thresholdPercent || 5.0,
            rsiPeriod: config?.rsiPeriod || 14,
          },
        });
        break;

      case 'KRON':
        result = await db.kronBot.create({
          data: {
            ...baseData,
            algorithm: 'TRF',
            maFastLength: config?.maFastLength || 12,
            maSlowLength: config?.maSlowLength || 26,
            signalLineLength: config?.signalLineLength || 9,
          },
        });
        break;
    }

    return NextResponse.json({
      success: true,
      data: { ...result, botType },
      message: `${botType} bot created successfully`,
    });
  } catch (error) {
    console.error('[InstitutionalBots] Create error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
