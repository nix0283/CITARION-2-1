import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Valid institutional bot types
const VALID_BOT_TYPES = ['SPECTRUM', 'REED', 'ARCHITECT', 'EQUILIBRIST', 'KRON'] as const;
type BotType = typeof VALID_BOT_TYPES[number];

// Get the appropriate model based on bot type
function getBotModel(botType: BotType) {
  switch (botType) {
    case 'SPECTRUM':
      return db.spectrumBot;
    case 'REED':
      return db.reedBot;
    case 'ARCHITECT':
      return db.architectBot;
    case 'EQUILIBRIST':
      return db.equilibristBot;
    case 'KRON':
      return db.kronBot;
    default:
      return null;
  }
}

// GET - Get a specific bot by ID
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ botType: string; id: string }> }
) {
  try {
    const { botType, id } = await params;
    const upperBotType = botType.toUpperCase() as BotType;

    if (!VALID_BOT_TYPES.includes(upperBotType)) {
      return NextResponse.json(
        { success: false, error: `Invalid bot type. Valid types: ${VALID_BOT_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    const model = getBotModel(upperBotType);
    if (!model) {
      return NextResponse.json({ success: false, error: 'Invalid bot model' }, { status: 400 });
    }

    const bot = await model.findUnique({
      where: { id },
      include: {
        account: { select: { exchangeName: true, exchangeId: true, exchangeType: true } },
      },
    });

    if (!bot) {
      return NextResponse.json({ success: false, error: 'Bot not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: { ...bot, botType: upperBotType },
    });
  } catch (error) {
    console.error('[InstitutionalBot] Get error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// PUT - Update a specific bot
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ botType: string; id: string }> }
) {
  try {
    const { botType, id } = await params;
    const upperBotType = botType.toUpperCase() as BotType;

    if (!VALID_BOT_TYPES.includes(upperBotType)) {
      return NextResponse.json(
        { success: false, error: `Invalid bot type. Valid types: ${VALID_BOT_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    const model = getBotModel(upperBotType);
    if (!model) {
      return NextResponse.json({ success: false, error: 'Invalid bot model' }, { status: 400 });
    }

    const body = await req.json();
    const { name, isActive, config, status, symbol, leverage, accountId } = body;

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (name !== undefined) updateData.name = name;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (status !== undefined) updateData.status = status;
    if (symbol !== undefined) updateData.symbol = symbol;
    if (leverage !== undefined) updateData.leverage = leverage;
    if (accountId !== undefined) updateData.accountId = accountId;

    // Bot-specific config updates
    if (config) {
      updateData.configJson = JSON.stringify(config);

      // Map config fields to model-specific fields
      switch (upperBotType) {
        case 'SPECTRUM':
          if (config.maxPositionSize !== undefined) updateData.maxPositionSize = config.maxPositionSize;
          break;
        case 'REED':
          if (config.lookbackPeriod !== undefined) updateData.lookbackPeriod = config.lookbackPeriod;
          if (config.deviationThreshold !== undefined) updateData.deviationThreshold = config.deviationThreshold;
          break;
        case 'ARCHITECT':
          if (config.baseSpreadBps !== undefined) updateData.baseSpreadBps = config.baseSpreadBps;
          if (config.minSpreadBps !== undefined) updateData.minSpreadBps = config.minSpreadBps;
          if (config.maxInventory !== undefined) updateData.maxInventory = config.maxInventory;
          break;
        case 'EQUILIBRIST':
          if (config.lookbackPeriod !== undefined) updateData.lookbackPeriod = config.lookbackPeriod;
          if (config.thresholdPercent !== undefined) updateData.thresholdPercent = config.thresholdPercent;
          if (config.rsiPeriod !== undefined) updateData.rsiPeriod = config.rsiPeriod;
          break;
        case 'KRON':
          if (config.maFastLength !== undefined) updateData.maFastLength = config.maFastLength;
          if (config.maSlowLength !== undefined) updateData.maSlowLength = config.maSlowLength;
          if (config.signalLineLength !== undefined) updateData.signalLineLength = config.signalLineLength;
          break;
      }
    }

    const bot = await model.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      data: { ...bot, botType: upperBotType },
      message: `${upperBotType} bot updated successfully`,
    });
  } catch (error) {
    console.error('[InstitutionalBot] Update error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE - Delete a specific bot
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ botType: string; id: string }> }
) {
  try {
    const { botType, id } = await params;
    const upperBotType = botType.toUpperCase() as BotType;

    if (!VALID_BOT_TYPES.includes(upperBotType)) {
      return NextResponse.json(
        { success: false, error: `Invalid bot type. Valid types: ${VALID_BOT_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    const model = getBotModel(upperBotType);
    if (!model) {
      return NextResponse.json({ success: false, error: 'Invalid bot model' }, { status: 400 });
    }

    await model.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: `${upperBotType} bot deleted successfully`,
    });
  } catch (error) {
    console.error('[InstitutionalBot] Delete error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH - Start/Stop bot (toggle isActive)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ botType: string; id: string }> }
) {
  try {
    const { botType, id } = await params;
    const upperBotType = botType.toUpperCase() as BotType;

    if (!VALID_BOT_TYPES.includes(upperBotType)) {
      return NextResponse.json(
        { success: false, error: `Invalid bot type. Valid types: ${VALID_BOT_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    const model = getBotModel(upperBotType);
    if (!model) {
      return NextResponse.json({ success: false, error: 'Invalid bot model' }, { status: 400 });
    }

    const body = await req.json();
    const { action } = body; // 'start', 'stop', 'toggle'

    // Get current state
    const currentBot = await model.findUnique({
      where: { id },
      select: { isActive: true },
    });

    if (!currentBot) {
      return NextResponse.json({ success: false, error: 'Bot not found' }, { status: 404 });
    }

    let newIsActive: boolean;
    let newStatus: string;

    switch (action) {
      case 'start':
        newIsActive = true;
        newStatus = 'running';
        break;
      case 'stop':
        newIsActive = false;
        newStatus = 'stopped';
        break;
      case 'toggle':
      default:
        newIsActive = !currentBot.isActive;
        newStatus = !currentBot.isActive ? 'running' : 'stopped';
        break;
    }

    const bot = await model.update({
      where: { id },
      data: {
        isActive: newIsActive,
        status: newStatus,
      },
    });

    return NextResponse.json({
      success: true,
      data: { ...bot, botType: upperBotType },
      message: `${upperBotType} bot ${newIsActive ? 'started' : 'stopped'} successfully`,
    });
  } catch (error) {
    console.error('[InstitutionalBot] Patch error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
