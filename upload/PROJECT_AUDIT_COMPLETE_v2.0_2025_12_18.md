# 🚨 CITARION Trading System - Full Audit Report v2.0 (2025-12-18)

## Executive Summary

Это **высококачественная платформа** для автоматизированной торговли с профессиональной архитектурой. Основной фокус на:

- ✅ **5 бирж**: Binance, Bybit, OKX, Bitget, BingX
- ✅ **Режимы**: DEMO/PAPER, TESTNET, LIVE
- ✅ **Telegram интеграция**: Полный набор функций Cornix-compatible
- ✅ **ML/AI**: Интеграция Lawrence Classifier, Gradient Boosting, RL agents
- ✅ **Боты**: 30+ типов (Grid, DCA, BB, ARGUS, Orion, Vision, LOGOS и др.)

**Текущая оценка реализации: 78/100**

---

## 🔍 Детальный анализ по разделам С ДОРОЖНОЙ КАРТОЙ ДО 100%

---

### 1️⃣ Биржи (Binance, Bybit, OKX, Bitget, BingX)

| Функция | Реализация | Статус | Что нужно для 100% |
|---------|------------|--------|-------------------|
| WebSocket реальные цены | `src/lib/price-websocket.ts` | ✅ 10/10 | Ничего — уже работает |
| REST API торговля | `src/lib/exchange/*` | ✅ 9/10 | Добавить больше edge case обработок |
| Paper trading | `src/lib/paper-trading/engine.ts` | ✅ 10/10 | Полностью готово |
| Testnet поддержка | Binance/Bybit testnet | ✅ 10/10 | Полностью готово |
| Real mode live trading | API endpoints + auth flow | ⚠️ 90% → 100% | См. раздел ниже |
| Хранение API ключей | AES-256 шифрование | ✅ 8/10 | Провести security тесты |
| Ошибки обмена | Catalog + logging | ✅ 9/10 | Добавить more error codes |
| Rate limiting | Redis-based | ✅ 9/10 | Добавить per-symbol limits |

#### CRITICAL PATH: Live Trading 90% → 100%

```typescript
// FILE: src/app/api/trade/open/route.ts
// CURRENT: Core order placement works
// MISSING FOR 100%:

✅ 1. Risk Validation Layer
   Add pre-trade checks:
   - Daily loss limit check
   - Position size validation against account balance
   - Symbol blacklist validation
   - Market hours validation (where applicable)

✅ 2. Order Rejection Handling
   Implement proper retry logic:
   - Rate limit errors → exponential backoff
   - Insufficient funds → clear error message
   - Invalid parameters → validation feedback
   
   // Example implementation:
   if (error.code === 'INVALID_ORDER') {
     await logOrderRejection({
       symbol,
       reason: error.message,
       errorCode: error.code
     });
     return new Response(JSON.stringify({ success: false, error: error.message }), 
       { status: 400 });
   }

✅ 3. Balance Verification
   Before any trade execution:
   - Fetch real balance from exchange
   - Verify margin requirements
   - Check available funds after accounting for open positions
   
   // In trade route before execute:
   const balance = await exchange.getAccountInfo();
   const availableMargin = balance.availableMargin;
   if (availableMargin < requiredMargin) {
     return { success: false, error: 'Insufficient funds' };
   }

✅ 4. Trade Confirmation Webhook
   Real-time notification system:
   - WebSocket events for trade confirmed
   - Telegram notifications integration
   - Email alerts for large trades

✅ 5. Transaction Logging
   Complete audit trail:
   - Every trade attempt logged
   - API request/response captured
   - User ID linked to all transactions
   
   // Database insert:
   await db.exchangeApiLog.create({
     data: {
       userId,
       accountId,
       exchange: 'binance',
       endpoint: '/fapi/v1/order',
       requestParams: JSON.stringify(params),
       responseStatus: 200,
       responseBody: JSON.stringify(order),
       createdAt: new Date()
     }
   });

✅ 6. Idempotency Key Support
   Prevent duplicate orders:
   - Generate unique clientOrderId per request
   - Check if order already submitted
   - Return existing order ID if duplicate
   
   // Implementation:
   const requestId = crypto.randomUUID();
   const key = `order_${requestId}_${symbol}`;
   
   if (await redis.exists(key)) {
     return { success: true, orderId: await redis.get(key) };
   }
   await redis.setex(key, 300, orderId); // 5 min expiry
```

**IMPLEMENTATION PRIORITY:** HIGH  
**TIME ESTIMATE:** 2-3 days development  
**FILES TO MODIFY:**
- `src/app/api/trade/open/route.ts` (+300 lines risk validation)
- `src/app/api/trade/close/route.ts` (+100 lines balance verification)
- `src/lib/exchange/base-client.ts` (+200 lines idempotency)
- `prisma/schema.prisma` (+1 new table: ExchangeTransactionLog)

---

### 2️⃣ Раздел "Боты" (Sidebar Bots Section)

#### Цель раздела:
Менеджер всех торговых ботов с возможностью создания, настройки, запуска, остановки и мониторинга.

#### Текущий статус по категориям:

| Категория | Боты | UI Component | Backend | DB Model | Текущий | Для 100% что нужно |
|-----------|------|--------------|---------|----------|--------|---------------------|
| Meta | LOGOS | ✅ logos-panel.tsx | ✅ engine.ts | ✅ LearningModel, BotPerformance | 95% | Ничего — практически готово |
| Operational | Grid, DCA, BB | ✅ Все менеджеры | ✅ Движки | ✅ GridBot, DcaBot, BBBot | 95% → 100% | См. ниже Grid/DCA improvements |
| Institutional | PR, STA, MM, MR, TRF | ✅ Панель + отдельные | ⚠️ Skeleton | ❌ Нет отдельных моделей | 40% → 100% | См. таблицу ниже |
| Analytical | ARGUS, ORION, VISION, RANGE, WOLF | ✅ Менеджеры | ✅ Движки | ✅ All models present | 85% | Улучшить signal processing |
| Frequency | HFT, MFT, LFT | ✅ Панели | ⚠️ Частично | ❌ Нет отдельных моделей | 70% → 100% | Создать отдельные таблицы |

#### CRITICAL PATH: Institutional Bots 40% → 100%

```prisma
// FILE: prisma/schema.prisma
// ACTION: Add 5 NEW bot models for institutional functionality

model SpectrumBot {
  id           String   @id @default(cuid())
  userId       String
  name         String
  isActive     Boolean  @default(false)
  
  // Core bot logic
  algorithm    String   @default("SPECTRUM") // ALGO type
  
  // Performance tracking
  totalProfit  Float    @default(0)
  totalTrades  Int      @default(0)
  winRate      Float    @default(0)
  maxDrawdown  Float    @default(0)
  
  // Configuration
  configJson   String?  @default("{}") // Flexible settings storage
  
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  
  @@index([userId, isActive])
}

model ReedBot {
  id           String   @id @default(cuid())
  userId       String
  name         String
  isActive     Boolean  @default(false)
  
  // Core bot logic
  algorithm    String   @default("STA") // Stationary Algorithm
  
  // Performance tracking
  totalProfit  Float    @default(0)
  totalTrades  Int      @default(0)
  winRate      Float    @default(0)
  
  configJson   String?  @default("{}")
  
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  
  @@index([userId, isActive])
}

model ArchitectBot {
  id           String   @id @default(cuid())
  userId       String
  name         String
  isActive     Boolean  @default(false)
  
  // Core bot logic
  algorithm    String   @default("MM") // Market Maker
  
  // Inventory management
  inventorySize Float   @default(0)
  targetInventory Float @default(0)
  
  // Performance tracking
  totalProfit  Float    @default(0)
  fillRate     Float    @default(0)
  avgSpread    Float    @default(0)
  
  configJson   String?  @default("{}")
  
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  
  @@index([userId, isActive])
}

model EquilibristBot {
  id           String   @id @default(cuid())
  userId       String
  name         String
  isActive     Boolean  @default(false)
  
  // Core bot logic
  algorithm    String   @default("MR") // Mean Reversion
  
  // Strategy params
  lookbackPeriod Int    @default(14)
  thresholdFloat @default(0.05)
  
  // Performance tracking
  totalProfit  Float    @default(0)
  signalCount  Int      @default(0)
  accuracy     Float    @default(0)
  
  configJson   String?  @default("{}")
  
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  
  @@index([userId, isActive])
}

model KronBot {
  id           String   @id @default(cuid())
  userId       String
  name         String
  isActive     Boolean  @default(false)
  
  // Core bot logic
  algorithm    String   @default("TRF") // Trend Following
  
  // Trend detection
  maFastLength Int      @default(12)
  maSlowLength Int      @default(26)
  signalLineLength Int  @default(9)
  
  // Performance tracking
  totalProfit  Float    @default(0)
  trendAccuracy Float    @default(0)
  drawdown     Float    @default(0)
  
  configJson   String?  @default("{}")
  
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  
  @@index([userId, isActive])
}

// ALSO ADD: Common bot performance tracking table
model BotPerformanceSummary {
  id          String   @id @default(cuid())
  userId      String
  botType     String   // GRID, DCA, BB, SPECTRUM, REED, etc.
  botInstanceId String // Links to specific bot instance
  
  // Aggregated metrics
  totalSignals Int     @default(0)
  successfulSignals Int @default(0)
  failedSignals Int   @default(0)
  accuracy      Float  @default(0)
  
  // Financial metrics
  avgPnl        Float  @default(0)
  avgPnlPercent Float  @default(0)
  
  // Condition analysis
  bestConditions String? // JSON: ["high_volume", "low_volatility"]
  worstConditions String? // JSON: ["whipsaw", "gap_risk"]
  
  lastUpdated    DateTime @default(now())
  
  @@unique([botType, botInstanceId])
  @@index([userId, botType])
}
```

**Backend Implementation Required:**

```typescript
// FILE: src/app/api/bots/institutional/[botType]/route.ts
// CREATE NEW ROUTE for institutional bot management

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { db } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });

    const body = await req.json();
    const { botType, config, name, description } = body;

    // Validate botType
    if (!['SPECTRUM', 'REED', 'ARCHITECT', 'EQUILIBRIST', 'KRON'].includes(botType)) {
      return new NextResponse('Invalid bot type', { status: 400 });
    }

    // Create bot based on type
    let result;
    
    switch (botType) {
      case 'SPECTRUM':
        result = await db.spectrumBot.create({
          data: {
            userId: session.user.id,
            name: name || 'Spectrum Bot',
            algorithm: 'SPECTRUM',
            configJson: JSON.stringify(config),
          }
        });
        break;
        
      case 'REED':
        result = await db.reedBot.create({
          data: {
            userId: session.user.id,
            name: name || 'Reed Bot',
            algorithm: 'STA',
            configJson: JSON.stringify(config),
          }
        });
        break;
        
      // ... other cases for ARCHITECT, EQUILIBRIST, KRON
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[InstitutionalBot] Error:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });

    const bots = await Promise.all([
      db.spectrumBot.findMany({ where: { userId: session.user.id } }),
      db.reedBot.findMany({ where: { userId: session.user.id } }),
      db.architectBot.findMany({ where: { userId: session.user.id } }),
      db.equilibristBot.findMany({ where: { userId: session.user.id } }),
      db.kronBot.findMany({ where: { userId: session.user.id } }),
    ]);

    return NextResponse.json(bots.flat());
  } catch (error) {
    console.error('[InstitutionalBot] Get error:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}
```

**IMPLEMENTATION PRIORITY:** CRITICAL  
**TIME ESTIMATE:** 5-7 days development + database migration  
**FILES TO CREATE/MODIFY:**
- `prisma/schema.prisma` (+100 lines new models)
- `src/app/api/bots/institutional/[botType]/route.ts` (NEW: 200 lines)
- `src/components/bots/spectrum-bot-panel.tsx`, `reed-bot-panel.tsx` etc. (update to use real API)
- `src/lib/bots/spectrum-engine.ts`, `reed-engine.ts` etc. (create new engines: 500+ lines each)

---

### 3️⃣ Раздел "Сигналы" (Sidebar Signals Section)

| Функция | File(s) | Текущий Статус | Что нужно для 100% |
|---------|---------|----------------|---------------------|
| Парсинг Cornix формата | `signal-parser.ts` | ✅ 95% → 100% | Добавление multi-entry weights |
| Управление через Telegram | `telegram-bot-v2.ts` | ✅ 100% | Готово |
| Webhook для Telegram | `api/telegram/webhook/route.ts` | ✅ 100% | Готово |
| Signal parsing API | `api/chat/parse-signal/route.ts` | ✅ 90% → 100% | Улучшение parsing accuracy |
| Signal deduplication | `ProcessedSignalRecord` table | ✅ 100% | Готово |
| Auto-execution | auto-trading flags | ✅ 90% → 100% | Добавить confirmation flow |
| Processing queue | `event-queue/dead-letter-queue.ts` | ✅ 90% → 100% | Добавить retry with backoff |

#### CRITICAL PATH: Multi-Entry Weight Percentages Parsing 95% → 100%

```javascript
// FILE: src/lib/signal-parser.ts
// IMPROVEMENT: Add multi-entry weight percentage support

interface EntryWeight {
  price: number;
  percentage: number; // e.g., 0.30 for 30%
  index: number;
}

/**
 * Parse multi-entry signals with weight percentages
 * Formats supported:
 * BTCUSDT long entry 67000[30%], 66500[40%], 66000[30%]
 * BTCUSDT long range 66000-67000 with weights [30%, 40%, 30%]
 */
function parseMultiEntryWithWeights(signalText: string): {
  entryPrices: number[];
  entryWeights: number[];
  isValid: boolean;
} {
  // Pattern 1: Individual entries with percentages
  // Format: 67000[30%], 66500[40%], 66000[30%]
  const individualPattern = /(\d+(?:\.\d+)?)(?:\[([\d.]+)%?\])/g;
  const matches = [...signalText.matchAll(individualPattern)];
  
  if (matches.length > 1) {
    const entries: { price: number; percentage: number }[] = [];
    
    for (const match of matches) {
      const price = parseFloat(match[1]);
      const percentageStr = match[2] || '';
      
      let percentage;
      if (percentageStr.includes('%')) {
        percentage = parseFloat(percentageStr.replace('%', '')) / 100;
      } else {
        percentage = parseFloat(percentageStr) || (100 / matches.length);
      }
      
      entries.push({ price, percentage });
    }
    
    // Normalize weights to sum to 1.0
    const totalWeight = entries.reduce((sum, e) => sum + e.percentage, 0);
    const normalizedEntries = entries.map(e => ({
      price: e.price,
      percentage: totalWeight > 0 ? e.percentage / totalWeight : e.percentage / entries.length,
    }));
    
    return {
      entryPrices: normalizedEntries.map(e => e.price),
      entryWeights: normalizedEntries.map(e => e.percentage),
      isValid: true,
    };
  }
  
  // Pattern 2: Range with global weights array
  // Format: range 66000-67000 weights [30%, 40%, 30%]
  const rangePattern = /range\s+(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/i;
  const weightsPattern = /weights?\s*\[([^\]]+)\]/i;
  
  const rangeMatch = signalText.match(rangePattern);
  const weightsMatch = signalText.match(weightsPattern);
  
  if (rangeMatch && weightsMatch) {
    const minPrice = parseFloat(rangeMatch[1]);
    const maxPrice = parseFloat(rangeMatch[2]);
    const weightsRaw = weightsMatch[1].split(',').map(w => {
      const value = w.trim().replace('%', '');
      return parseFloat(value) / 100 || (parseFloat(value) || 1);
    });
    
    // Normalize to ensure weights sum to 1.0
    const totalWeight = weightsRaw.reduce((sum, w) => sum + w, 0);
    const normalizedWeights = weightsRaw.map(w => w / totalWeight);
    
    // Generate equal-spaced entry prices within range
    const entryPrices = normalizedWeights.map((_, i) => 
      minPrice + ((maxPrice - minPrice) * ((i + 0.5) / normalizedWeights.length))
    );
    
    return {
      entryPrices,
      entryWeights: normalizedWeights,
      isValid: true,
    };
  }
  
  return {
    entryPrices: [],
    entryWeights: [],
    isValid: false,
  };
}

/**
 * Update main parseSignal function to use multi-entry weights
 */
export function parseSignal(text: string): ParsedSignal | null {
  // ... existing code ...
  
  // Try multi-entry weight parsing first
  const multiEntry = parseMultiEntryWithWeights(text);
  if (multiEntry.isValid && multiEntry.entryPrices.length > 0) {
    return {
      // ... map to ParsedSignal interface ...
      entryPrices: multiEntry.entryPrices,
      // Add new field to store weights
      entryWeights: multiEntry.entryWeights,
      entryZone: multiEntry.entryPrices.length > 1 
        ? { 
            min: Math.min(...multiEntry.entryPrices),
            max: Math.max(...multiEntry.entryPrices)
          }
        : undefined,
    };
  }
  
  // Fall back to existing single-entry parsing
  // ...
}
```

**Database Schema Update Needed:**

```prisma
// FILE: prisma/schema.prisma
// ADD: entryWeights field to BotConfig

model BotConfig {
  // ... existing fields ...
  
  // NEW: Custom entry weights for multi-entry strategies
  entryWeights   String? // JSON: [0.30, 0.40, 0.30] - must sum to ~1.0
  
  // Updated existing field descriptions
  entryStrategy  String  @default("EVENLY_DIVIDED") // Now supports WEIGHTED_DISTRIBUTION too
}

// UPDATE: Signal model to store weights

model Signal {
  // ... existing fields ...
  
  // NEW: Store entry weights if provided in signal
  entryWeights   String? // JSON: [0.30, 0.40, 0.30]
  
  // Enhanced entry zone tracking
  entryZoneMin   Float?  // Min price in entry zone
  entryZoneMax   Float?  // Max price in entry zone
  entryZoneType  String  @default("NONE") // NONE, INDIVIDUAL, RANGE
}
```

**IMPLEMENTATION PRIORITY:** MEDIUM  
**TIME ESTIMATE:** 1-2 days development  
**FILES TO MODIFY:**
- `src/lib/signal-parser.ts` (+150 lines new parsing logic)
- `prisma/schema.prisma` (+5 lines new fields)
- `src/lib/auto-trading/entry-strategy.ts` (+100 lines weighted distribution logic)
- `src/components/bots/dca-bot-manager.tsx` (+50 lines weights display/edit UI)

---

### 4️⃣ Фандинг Аналитика

| Функция | File(s) | Текущий Статус | Что нужно для 100% |
|---------|---------|----------------|---------------------|
| Получение funding rate | binance-client.ts/getFundingRate() | ✅ 100% | Готово |
| Показатели Open Interest | getOpenInterest() | ✅ 100% | Готово |
| Heat map (risk level) | frontend visualizations | ⚠️ 60% → 100% | Добавление логики расчета heat levels |
| История payments | FundingPayment table | ✅ 90% → 100% | Запись каждого payment события |
| Расчет ROI от funding | НЕ РЕАЛИЗОВАНО | ❌ 0% → 100% | Создать calc service |
| Прогноз next funding | client calculation | ✅ 80% → 100% | Точный расчет intervals |

#### CRITICAL PATH: Funding Backend 0% → 100%

**Проблема сейчас:**
```typescript
// FILE: src/app/api/funding/route.ts
// CURRENTLY RETURNS: Mock/demo data only
async function GET() {
  return NextResponse.json({
    // hardcoded demo values - NOT REAL EXCHANGE DATA
    rates: mockFundingRates,
  });
}
```

**Решение для 100% реализации:**

```typescript
// FILE: src/app/api/funding/route.ts (COMPLETE OVERHAUL)
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { db } from '@/lib/db';
import { getExchangeClient } from '@/lib/exchange';
import type { ExchangeType } from '@/lib/exchanges';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });

    const { searchParams } = new URL(req.url);
    const symbols = searchParams.getAll('symbol'); // e.g., BTCUSDT,ETHUSDT,BNBUSDT
    const exchanges = searchParams.getAll('exchange'); // e.g., binance,bybit,okx
    const limit = parseInt(searchParams.get('limit') || '50');
    
    if (!symbols.length || !exchanges.length) {
      return new NextResponse('Missing symbols or exchanges parameter', { status: 400 });
    }

    const results = [];

    // Process each exchange
    for (const exchangeId of exchanges) {
      try {
        const exchangeClient = await getExchangeClient(exchangeId as ExchangeType, 'futures');
        
        // Process each symbol
        for (const symbol of symbols) {
          try {
            // Fetch real funding rate from exchange
            const fundingData = await exchangeClient.getFundingRate(symbol);
            
            // Fetch open interest
            const oiData = await exchangeClient.getOpenInterest(symbol);
            
            // Calculate heat level based on multiple factors
            const heatLevel = calculateHeatLevel({
              fundingRate: fundingData.rate,
              openInterest: oiData.openInterestUsd,
              priceChange: oiData.price,
              volumeRatio: oiData.volume24h / oiData.openInterestUsd,
            });

            // Get historical funding payments
            const recentPayments = await db.fundingPayment.findMany({
              where: {
                position: {
                  account: {
                    user: { id: session.user.id },
                  },
                },
                symbol: symbol,
                fundingTime: {
                  gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
                },
              },
              orderBy: { fundingTime: 'desc' },
              take: 10,
            });

            // Calculate predicted next funding time
            const nextFundingTime = getNextFundingTimestamp(fundingData.nextFundingTime);
            const hoursUntilFunding = Math.ceil((nextFundingTime.getTime() - Date.now()) / (1000 * 60 * 60));

            results.push({
              symbol,
              exchange: exchangeId,
              currentRate: fundingData.rate,
              annualizedRate: fundingData.rate * 3 * 365, // 3 fundings per day typical
              nextFundingTime: fundingData.nextFundingTime,
              hoursUntilNextFunding: hoursUntilFunding,
              markPrice: fundingData.markPrice,
              indexPrice: fundingData.indexPrice,
              openInterest: oiData.openInterest,
              openInterestUsd: oiData.openInterestUsd,
              heatLevel,
              recentPayments,
              roiEstimate: calculateFundingROI(
                fundingData.rate, 
                nextFundingTime, 
                7 // days projection
              ),
            });

          } catch (error) {
            console.error(`[Funding] Failed to fetch ${symbol} on ${exchangeId}:`, error);
            // Continue with next symbol even if one fails
          }
        }
        
      } catch (error) {
        console.error(`[Funding] Failed to connect to ${exchangeId}:`, error);
        continue; // Skip this exchange, try others
      }
    }

    // Sort by heat level and return
    const sortedResults = results
      .filter(r => r !== undefined) // Remove failed fetches
      .sort((a, b) => {
        // Sort by heat level: critical > high > medium > low
        const heatOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return heatOrder[a.heatLevel] - heatOrder[b.heatLevel];
      })
      .slice(0, limit);

    return NextResponse.json({ success: true, data: sortedResults });
    
  } catch (error) {
    console.error('[Funding] Server error:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}

// ========== HELPER FUNCTIONS FOR FUNDING CALCULATION ==========

/**
 * Calculate heat level based on multiple risk indicators
 */
function calculateHeatLevel(data: {
  fundingRate: number;
  openInterest: number;
  price: number;
  volumeRatio: number;
}): 'low' | 'medium' | 'high' | 'critical' {
  // Score components
  let score = 0;
  
  // Funding rate contribution (annualized)
  const annualizedRate = data.fundingRate * 3 * 365;
  if (annualizedRate > 2.0) score += 4;
  else if (annualizedRate > 1.0) score += 3;
  else if (annualizedRate > 0.5) score += 2;
  else if (annualizedRate > 0.1) score += 1;
  
  // Open interest spike detection
  if (data.openInterest > 1e10) score += 3; // >$10B OI
  else if (data.openInterest > 5e9) score += 2; // >$5B OI
  
  // Volume ratio (liquidity pressure)
  if (data.volumeRatio > 0.5) score += 2; // High volume vs OI
  else if (data.volumeRatio > 0.3) score += 1;
  
  // Price volatility indicator
  const volatility = Math.abs(data.price - data.indexPrice) / data.indexPrice;
  if (volatility > 0.01) score += 2; // 1% deviation
  else if (volatility > 0.005) score += 1;
  
  // Determine heat level
  if (score >= 9) return 'critical';
  if (score >= 6) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

/**
 * Calculate estimated ROI from funding over N days
 */
function calculateFundingROI(fundingRate: number, nextFundingTime: Date, days: number): number {
  const fundingsPerDay = 3; // Typical for most perpetual futures
  const totalFundings = fundingsPerDay * days;
  const roi = fundingRate * totalFundings * 100;
  return roi;
}

/**
 * Get next funding timestamp with proper rounding
 */
function getNextFundingTimestamp(nextTime: Date): Date {
  // Standardize to 8-hour funding intervals
  const standardTimes = [0, 8, 16]; // UTC hours
  const currentHour = nextTime.getUTCHours();
  
  let targetHour = 8; // Default next funding hour
  for (const hour of standardTimes) {
    if (hour > currentHour) {
      targetHour = hour;
      break;
    }
  }
  
  const next = new Date(nextTime);
  next.setUTCHours(targetHour, 0, 0, 0);
  return next;
}
```

**Frontend Integration Update:**

```typescript
// FILE: src/components/dashboard/funding-rate-widget.tsx
// ADD: Real-time data fetching instead of static data

'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface FundingRateItem {
  symbol: string;
  exchange: string;
  currentRate: number;
  heatLevel: 'low' | 'medium' | 'high' | 'critical';
  hoursUntilNextFunding: number;
  roiEstimate: number;
}

export function FundingRateWidget() {
  const [rates, setRates] = useState<FundingRateItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchFundingData() {
      try {
        const response = await fetch('/api/funding?symbol=BTCUSDT&exchange=binance&limit=20');
        const data = await response.json();
        setRates(data.data || []);
      } catch (error) {
        console.error('[FundingWidget] Fetch error:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchFundingData();
    const interval = setInterval(fetchFundingData, 60000); // Refresh every minute
    
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <Card><CardContent className="p-4">Loading...</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <span className="text-[#F0B90B]">⚡</span> Funding Rates
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {rates.map((rate) => (
            <div key={`${rate.symbol}-${rate.exchange}`} className="flex items-center justify-between p-2 rounded bg-muted/30">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">{rate.symbol}</span>
                <span className="text-[10px] text-muted-foreground">{rate.exchange}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge 
                  variant="outline" 
                  className={cn(
                    rate.heatLevel === 'critical' ? 'border-red-500 text-red-500' :
                    rate.heatLevel === 'high' ? 'border-orange-500 text-orange-500' :
                    rate.heatLevel === 'medium' ? 'border-yellow-500 text-yellow-500' :
                    'border-green-500 text-green-500'
                  )}
                >
                  {rate.heatLevel.toUpperCase()}
                </Badge>
                <span className={`text-xs font-mono ${rate.currentRate > 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {(rate.currentRate * 100).toFixed(4)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

**IMPLEMENTATION PRIORITY:** HIGH  
**TIME ESTIMATE:** 2-3 days development  
**FILES TO CREATE/MODIFY:**
- `src/app/api/funding/route.ts` (COMPLETE rewrite: 250 lines)
- `src/components/dashboard/funding-rate-widget.tsx` (Update with real data: +100 lines)
- `src/lib/funding/calculation-service.ts` (NEW: 150 lines helper functions)

---

### 5️⃣ Сделки

| Функция | Текущий Статус | Что нужно для 100% |
|---------|----------------|---------------------|
| Таблица истории сделок | Работает 90% ✅ | Добавление экспорта в разные форматы, улучшение производительности больших данных |
| Фильтрация | Только frontend | Создание backend фильтрации + advanced filters на frontend |

#### CRITICAL PATH: Trade History & Filtering 90% → 100%

**Backend Filter Implementation:**

```typescript
// FILE: src/app/api/trades/route.ts (NEW ENDPOINT)
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { db } from '@/lib/db';
import { z } from 'zod';

// Zod schema for validation
const TradeFilterSchema = z.object({
  symbol: z.string().optional(),
  direction: z.enum(['LONG', 'SHORT']).optional(),
  status: z.enum(['OPEN', 'CLOSED', 'PENDING', 'CANCELLED']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  minPnL: z.number().optional(),
  maxPnL: z.number().optional(),
  exchange: z.string().optional(),
  botType: z.string().optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(50),
  sortBy: z.enum(['createdAt', 'pnl', 'symbol', 'leverage']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

type TradeFilters = z.infer<typeof TradeFilterSchema>;

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });

    const { searchParams } = new URL(req.url);
    const filters = TradeFilterSchema.parse({
      symbol: searchParams.get('symbol') || undefined,
      direction: searchParams.get('direction') as 'LONG' | 'SHORT' | null,
      status: searchParams.get('status') as 'OPEN' | 'CLOSED' | 'PENDING' | 'CANCELLED' | null,
      startDate: searchParams.get('startDate') || undefined,
      endDate: searchParams.get('endDate') || undefined,
      minPnL: searchParams.get('minPnL') ? parseFloat(searchParams.get('minPnL')!) : undefined,
      maxPnL: searchParams.get('maxPnL') ? parseFloat(searchParams.get('maxPnL')!) : undefined,
      exchange: searchParams.get('exchange') || undefined,
      botType: searchParams.get('botType') || undefined,
      page: parseInt(searchParams.get('page') || '1'),
      limit: parseInt(searchParams.get('limit') || '50'),
      sortBy: (searchParams.get('sortBy') as any) || 'createdAt',
      sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc',
    });

    // Build dynamic query conditions
    const where: any = {
      userId: session.user.id,
    };

    if (filters.symbol) where.symbol = filters.symbol;
    if (filters.direction) where.direction = filters.direction;
    if (filters.status) where.status = filters.status;
    if (filters.startDate || filters.endDate) {
      where.entryTime = {};
      if (filters.startDate) where.entryTime.gte = new Date(filters.startDate);
      if (filters.endDate) where.entryTime.lte = new Date(filters.endDate);
    }
    if (filters.minPnL !== undefined || filters.maxPnL !== undefined) {
      where.pnl = {};
      if (filters.minPnL !== undefined) where.pnl.gte = filters.minPnL;
      if (filters.maxPnL !== undefined) where.pnl.lte = filters.maxPnL;
    }
    if (filters.exchange) where.account = {
      exchangeId: filters.exchange,
    };
    if (filters.botType) {
      // Need relation join for bot-specific data
      where.OR = [
        { botConfig: { name: { contains: filters.botType, mode: 'insensitive' } } },
        { signalSource: { contains: filters.botType, mode: 'insensitive' } }
      ];
    }

    // Execute query with pagination
    const [trades, total] = await Promise.all([
      db.trade.findMany({
        where,
        include: {
          account: {
            select: {
              exchangeId: true,
              exchangeName: true,
            },
          },
          signal: {
            select: {
              signalId: true,
              source: true,
            },
          },
        },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
        orderBy: { [filters.sortBy]: filters.sortOrder },
      }),
      db.trade.count({ where }),
    ]);

    // Calculate metadata for pagination
    const totalPages = Math.ceil(total / filters.limit);
    const hasNextPage = filters.page < totalPages;
    const hasPrevPage = filters.page > 1;

    return NextResponse.json({
      success: true,
      data: trades,
      meta: {
        total,
        page: filters.page,
        limit: filters.limit,
        totalPages,
        hasNextPage,
        hasPrevPage,
        filterCounts: await getFilterCounts(session.user.id, filters),
      },
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return new NextResponse('Invalid filter parameters', { status: 400 });
    }
    console.error('[Trades API] Error:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}

/**
 * Get counts per filter option for faceted search
 */
async function getFilterCounts(userId: string, filters: TradeFilters) {
  const baseWhere = { userId };
  
  // Count by symbol
  const symbolCounts = await db.trade.groupBy({
    by: ['symbol'],
    _count: true,
    where: baseWhere,
  });

  // Count by direction
  const directionCounts = await db.trade.groupBy({
    by: ['direction'],
    _count: true,
    where: baseWhere,
  });

  // Count by status
  const statusCounts = await db.trade.groupBy({
    by: ['status'],
    _count: true,
    where: baseWhere,
  });

  // Count by exchange
  const exchangeCounts = await db.trade.groupBy({
    by: ['accountId'],
    _count: true,
    where: baseWhere,
    include: { account: { select: { exchangeId: true } } },
  }).then(groups => groups.map(g => ({
    exchangeId: g.account.exchangeId,
    count: g._count,
  })));

  return {
    symbols: symbolCounts.map(s => ({ symbol: s.symbol, count: s._count })),
    directions: directionCounts.map(d => ({ direction: d.direction, count: d._count })),
    statuses: statusCounts.map(s => ({ status: s.status, count: s._count })),
    exchanges: exchangeCounts,
  };
}

// ========== EXPORT FUNCTIONALITY ==========

// FILE: src/app/api/files/export/trades/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });

    const { searchParams } = new URL(req.url);
    const format = searchParams.get('format') || 'csv';
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const trades = await db.trade.findMany({
      where: {
        userId: session.user.id,
        ...(startDate && { entryTime: { gte: new Date(startDate) } }),
        ...(endDate && { entryTime: { lte: new Date(endDate) } }),
      },
      include: {
        account: { select: { exchangeName: true } },
        signal: { select: { signalId: true, source: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (format === 'csv') {
      const csvData = generateCSV(trades);
      return new NextResponse(csvData, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="trades_export_${Date.now()}.csv"`,
        },
      });
    }

    if (format === 'json') {
      return NextResponse.json(trades, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="trades_export_${Date.now()}.json"`,
        },
      });
    }

    return new NextResponse('Unsupported format', { status: 400 });

  } catch (error) {
    console.error('[Export] Error:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}

function generateCSV(trades: any[]): string {
  const headers = ['ID', 'Symbol', 'Direction', 'Entry Price', 'Exit Price', 'PnL', 'Fee', 'Status', 'Date'];
  const rows = trades.map(t => [
    t.id.substring(0, 8),
    t.symbol,
    t.direction,
    t.entryPrice?.toFixed(2) || '-',
    t.exitPrice?.toFixed(2) || '-',
    t.pnl.toFixed(2),
    t.fee.toFixed(4),
    t.status,
    new Date(t.createdAt).toISOString(),
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}
```

**Frontend Filter UI Enhancement:**

```typescript
// FILE: src/components/trading/trades-filter-panel.tsx (NEW COMPONENT)
'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';

interface TradeFiltersState {
  symbol: string;
  direction: 'ALL' | 'LONG' | 'SHORT';
  status: 'ALL' | 'OPEN' | 'CLOSED' | 'PENDING';
  startDate: string;
  endDate: string;
  minPnL: string;
  maxPnL: string;
  exchange: string;
  botType: string;
}

export function TradesFilterPanel({ 
  filters, 
  onApply, 
  onReset,
  availableOptions 
}: { 
  filters: TradeFiltersState; 
  onApply: (f: TradeFiltersState) => void;
  onReset: () => void;
  availableOptions: { symbols: string[]; exchanges: string[]; botTypes: string[] };
}) {
  const [localFilters, setLocalFilters] = useState(filters);

  const handleApply = () => {
    onApply(localFilters);
  };

  const handleReset = () => {
    setLocalFilters({
      symbol: '',
      direction: 'ALL',
      status: 'ALL',
      startDate: '',
      endDate: '',
      minPnL: '',
      maxPnL: '',
      exchange: '',
      botType: '',
    });
    onReset();
  };

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Фильтры сделок</h3>
        <Button variant="ghost" size="sm" onClick={handleReset}>
          Сбросить
        </Button>
      </div>

      {/* Symbol Filter */}
      <div className="space-y-2">
        <label className="text-sm">Символ</label>
        <Input
          placeholder="BTCUSDT, ETHUSDT..."
          value={localFilters.symbol}
          onChange={(e) => setLocalFilters(p => ({ ...p, symbol: e.target.value }))}
        />
      </div>

      {/* Direction Filter */}
      <div className="space-y-2">
        <label className="text-sm">Направление</label>
        <Select value={localFilters.direction} onValueChange={(v: any) => setLocalFilters(p => ({ ...p, direction: v }))}>
          <SelectTrigger>
            <SelectValue placeholder="Все направления" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Все</SelectItem>
            <SelectItem value="LONG">Long</SelectItem>
            <SelectItem value="SHORT">Short</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Status Filter */}
      <div className="space-y-2">
        <label className="text-sm">Статус</label>
        <div className="flex gap-2">
          {['ALL', 'OPEN', 'CLOSED', 'PENDING'].map(status => (
            <button
              key={status}
              onClick={() => setLocalFilters(p => ({ ...p, status: status as any }))}
              className={`px-3 py-1 rounded text-xs font-medium ${
                localFilters.status === status 
                  ? 'bg-primary text-primary-foreground' 
                  : 'bg-muted hover:bg-accent'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Date Range Filter */}
      <div className="space-y-2">
        <label className="text-sm">Диапазон дат</label>
        <div className="flex gap-2">
          <Input
            type="date"
            value={localFilters.startDate}
            onChange={(e) => setLocalFilters(p => ({ ...p, startDate: e.target.value }))}
            placeholder="От"
          />
          <Input
            type="date"
            value={localFilters.endDate}
            onChange={(e) => setLocalFilters(p => ({ ...p, endDate: e.target.value }))}
            placeholder="До"
          />
        </div>
      </div>

      {/* PnL Filter */}
      <div className="space-y-2">
        <label className="text-sm">PnL диапазон</label>
        <div className="flex gap-2">
          <Input
            type="number"
            placeholder="Min"
            value={localFilters.minPnL}
            onChange={(e) => setLocalFilters(p => ({ ...p, minPnL: e.target.value }))}
          />
          <Input
            type="number"
            placeholder="Max"
            value={localFilters.maxPnL}
            onChange={(e) => setLocalFilters(p => ({ ...p, maxPnL: e.target.value }))}
          />
        </div>
      </div>

      {/* Exchange & Bot Type */}
      <div className="grid grid-cols-2 gap-2">
        <Select value={localFilters.exchange} onValueChange={(v) => setLocalFilters(p => ({ ...p, exchange: v }))}>
          <SelectTrigger>
            <SelectValue placeholder="Биржа" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Все биржи</SelectItem>
            {availableOptions.exchanges.map(ex => (
              <SelectItem key={ex} value={ex}>{ex}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={localFilters.botType} onValueChange={(v) => setLocalFilters(p => ({ ...p, botType: v }))}>
          <SelectTrigger>
            <SelectValue placeholder="Тип бота" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Все боты</SelectItem>
            {availableOptions.botTypes.map(bt => (
              <SelectItem key={bt} value={bt}>{bt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button onClick={handleApply} className="w-full">
        Применить фильтры
      </Button>
    </div>
  );
}
```

**IMPLEMENTATION PRIORITY:** MEDIUM  
**TIME ESTIMATE:** 2-3 days development  
**FILES TO CREATE/MODIFY:**
- `src/app/api/trades/route.ts` (NEW: 200 lines filtering logic)
- `src/app/api/files/export/trades/route.ts` (NEW: 80 lines export functions)
- `src/components/trading/trades-filter-panel.tsx` (NEW: 200 lines UI component)
- `src/components/trading/trades-history.tsx` (Update to use new API: +50 lines)

---

### 6️⃣ Журнал (**КРИТИЧНО!**)

**Проблема:** Frontend компоненты есть, но отсутствует полностью таблица БД

#### НЕОБХОДИМАЯ МОДЕЛЬ ДЛЯ РЕАЛИЗАЦИИ:

```prisma
// FILE: prisma/schema.prisma
// ADD COMPLETE JOURNAL TABLE SCHEMA

model JournalEntry {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  // Basic info
  title         String   // Journal title
  content       String?  // Main content (markdown supported)
  tags          String?  @default("[]") // JSON array: ["scalping", "mistakes"]
  mood          String?  @default("neutral") // bullish, bearish, neutral, confused
  
  // Performance metrics
  pnl           Float    @default(0) // Total PnL for this journal period
  winRate       Float    @default(0) // Win rate for this period
  tradesCount   Int      @default(0) // Number of trades analyzed
  
  // Analysis
  lessons       String?  @default("[]") // JSON array: ["lesson 1", "lesson 2"]
  mistakes      String?  @default("[]") // JSON array: mistake analysis
  highlights    String?  @default("[]") // JSON array: positive observations
  
  // Trade links (for auto-population)
  relatedTradeIds String? @default("[]") // JSON array of trade IDs
  
  // Time period
  date          DateTime @default(now())
  periodStart   DateTime
  periodEnd     DateTime
  
  // Visibility
  isPrivate     Boolean  @default(true)
  isVisible     Boolean  @default(true)
  
  // Metadata
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  
  @@index([userId, date])
  @@index([tags])
  @@index([mood])
}

// Additional: Journal Analytics tracking
model JournalAnalytics {
  id            String   @id @default(cuid())
  userId        String
  
  // Weekly/Monthly summaries
  weekStartDate DateTime
  weekEndDate   DateTime
  
  // Metrics
  totalTrades   Int      @default(0)
  totalPnL      Float    @default(0)
  winRate       Float    @default(0)
  maxDrawdown   Float    @default(0)
  
  // Sentiment tracking
  avgMoodScore  Float    @default(0) // -1 (bearish) to +1 (bullish)
  
  // Insights generated by AI
  insights      String?  @default("[]") // JSON array of AI-generated insights
  
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  
  @@unique([userId, weekStartDate])
}

// Auto-journal trigger on trade completion
model AutoJournalTrigger {
  id          String   @id @default(cuid())
  userId      String
  
  // Trigger configuration
  enabled     Boolean  @default(true)
  triggerOn   String   @default("WIN_LOSS") // WIN_LOSS, DAILY_SUMMARY, CUSTOM
  minPnL      Float    @default(100) // Min PnL to trigger
  daysToGroup Int      @default(7) // Days to group trades
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@unique([userId])
}
```

#### Backend API for Journal:

```typescript
// FILE: src/app/api/journal/route.ts (NEW)
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { db } from '@/lib/db';
import { z } from 'zod';

// Schema for creation/update
const JournalEntrySchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  mood: z.enum(['bullish', 'bearish', 'neutral', 'confused']).optional(),
  pnl: z.number().optional(),
  winRate: z.number().optional(),
  tradesCount: z.number().optional(),
  lessons: z.array(z.string()).optional(),
  mistakes: z.array(z.string()).optional(),
  highlights: z.array(z.string()).optional(),
  relatedTradeIds: z.array(z.string()).optional(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  isPrivate: z.boolean().default(false),
});

// Create
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });

    const body = await req.json();
    const validated = JournalEntrySchema.parse(body);

    const entry = await db.journalEntry.create({
      data: {
        userId: session.user.id,
        title: validated.title,
        content: validated.content,
        tags: JSON.stringify(validated.tags || []),
        mood: validated.mood || 'neutral',
        pnl: validated.pnl,
        winRate: validated.winRate,
        tradesCount: validated.tradesCount,
        lessons: JSON.stringify(validated.lessons || []),
        mistakes: JSON.stringify(validated.mistakes || []),
        highlights: JSON.stringify(validated.highlights || []),
        relatedTradeIds: JSON.stringify(validated.relatedTradeIds || []),
        periodStart: validated.periodStart ? new Date(validated.periodStart) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        periodEnd: validated.periodEnd || new Date(),
        isPrivate: validated.isPrivate || false,
      },
    });

    return NextResponse.json(entry);

  } catch (error) {
    if (error instanceof z.ZodError) {
      return new NextResponse('Invalid input', { status: 400 });
    }
    console.error('[Journal] Create error:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}

// Read
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const tag = searchParams.get('tag') || undefined;
    const mood = searchParams.get('mood') || undefined;

    const where: any = { userId: session.user.id };
    
    if (tag) {
      where.tags = { contains: tag };
    }
    if (mood) {
      where.mood = mood;
    }

    const [entries, total] = await Promise.all([
      db.journalEntry.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.journalEntry.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: entries,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });

  } catch (error) {
    console.error('[Journal] Get error:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}

// Update
export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });

    const body = await req.json();
    const { id, ...updates } = JournalEntrySchema.parse(body);

    const existing = await db.journalEntry.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return new NextResponse('Not found', { status: 404 });
    }

    const updated = await db.journalEntry.update({
      where: { id },
      data: updates,
    });

    return NextResponse.json(updated);

  } catch (error) {
    if (error instanceof z.ZodError) {
      return new NextResponse('Invalid input', { status: 400 });
    }
    console.error('[Journal] Update error:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}

// Delete
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return new NextResponse('Missing ID', { status: 400 });
    }

    await db.journalEntry.delete({
      where: { id, userId: session.user.id },
    });

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('[Journal] Delete error:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}
```

#### Auto-Journal Generation Feature:

```typescript
// FILE: src/lib/auto-journal-generator.ts (NEW)
import { db } from './db';

interface JournalGenerationResult {
  summary: string;
  insights: string[];
  lessons: string[];
  mistakes: string[];
  recommendedActions: string[];
}

export async function generateAutoJournalForUser(
  userId: string, 
  periodDays: number = 7
): Promise<JournalGenerationResult> {
  const endDate = new Date();
  const startDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  // Get trades for the period
  const trades = await db.trade.findMany({
    where: {
      userId,
      entryTime: { gte: startDate, lte: endDate },
    },
    include: {
      account: { select: { exchangeName: true } },
    },
  });

  // Calculate metrics
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

  // Generate insights using simple rules (later can integrate ML)
  const insights: string[] = [];
  const lessons: string[] = [];
  const mistakes: string[] = [];

  if (winRate < 50) {
    mistakes.push('Win rate below 50% indicates potential strategy issues');
    lessons.push('Review losing trades to identify common patterns');
  }

  if (totalPnL > 0 && winRate > 70) {
    insights.push('High win rate with positive PnL - maintain current strategy');
  }

  // Find biggest loss and winner
  const biggestLoss = trades.reduce((worst, t) => t.pnl < worst.pnl ? t : worst, trades[0]);
  const biggestWinner = trades.reduce((best, t) => t.pnl > best.pnl ? t : best, trades[0]);

  if (biggestLoss && biggestLoss.pnl < -1000) {
    lessons.push(`Significant loss on ${biggestLoss.symbol} - analyze what went wrong`);
  }

  if (biggestWinner && biggestWinner.pnl > 1000) {
    insights.push(`Biggest win on ${biggestWinner.symbol} - analyze why it worked`);
  }

  // Mood estimation based on performance
  let mood: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  const totalReturn = (totalPnL / 10000) * 100; // Assuming $10k starting balance
  if (totalReturn > 5) mood = 'bullish';
  if (totalReturn < -5) mood = 'bearish';

  return {
    summary: `${periodDays}-day summary: ${wins.length}/${trades.length} winning trades, ${winRate.toFixed(1)}% win rate, $${totalPnL.toFixed(2)} total PnL`,
    insights,
    lessons,
    mistakes: mistakes.length > 0 ? mistakes : ['No significant mistakes detected this period'],
    recommendedActions: [
      'Review top 3 losing trades in detail',
      'Document what triggered your best performing trade',
      'Consider adjusting position sizing based on current volatility',
    ],
  };
}
```

**IMPLEMENTATION PRIORITY:** CRITICAL  
**TIME ESTIMATE:** 3-4 days development  
**FILES TO CREATE/MODIFY:**
- `prisma/schema.prisma` (+80 lines new tables)
- `src/app/api/journal/route.ts` (NEW: 200 lines CRUD)
- `src/lib/auto-journal-generator.ts` (NEW: 150 lines AI generation)
- Update frontend journal components to use real API

---

### 7️⃣ Новости

**News Service: Отсутствует целиком - что нужно для реализации**

#### CRITICAL PATH: News Service 0% → 100%

```typescript
// FILE: src/lib/news-service/types.ts (NEW)
export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  content: string;
  url: string;
  source: string;
  author?: string;
  publishedAt: Date;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentScore: number; // -1 to +1
  categories: string[];
  relatedSymbols: string[];
  importance: 'low' | 'medium' | 'high' | 'critical';
  imageUrl?: string;
}

export interface NewsSource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastFetchedAt?: Date;
  rateLimit?: number; // Requests per minute
}

export interface NewsFetchResult {
  success: boolean;
  articles: NewsArticle[];
  errors: string[];
}
```

```typescript
// FILE: src/lib/news-service/fetchers/coindesk-fetcher.ts (NEW)
import type { NewsFetcher, NewsArticle } from '../types';

export class CoinDeskFetcher implements NewsFetcher {
  getName(): string {
    return 'CoinDesk';
  }

  async fetchArticles(limit: number = 20): Promise<{ articles: NewsArticle[], errors: string[] }> {
    const articles: NewsArticle[] = [];
    const errors: string[] = [];

    try {
      const response = await fetch('https://www.coindesk.com/markets/rss.xml', {
        headers: {
          'Accept': 'application/rss+xml',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const rssText = await response.text();
      const parsedArticles = this.parseRSS(rssText, limit);
      
      articles.push(...parsedArticles);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown error');
    }

    return { articles, errors };
  }

  private parseRSS(xml: string, limit: number): NewsArticle[] {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xml, 'text/xml');
    const items = xmlDoc.querySelectorAll('item');
    
    const articles: NewsArticle[] = [];
    
    items.forEach(item => {
      const link = item.querySelector('link')?.textContent || '';
      const title = item.querySelector('title')?.textContent || '';
      const pubDate = item.querySelector('pubDate')?.textContent;
      const description = item.querySelector('description')?.textContent || '';

      // Basic sentiment analysis (improve with ML later)
      const sentiment = this.analyzeSentiment(title + ' ' + description);
      
      // Extract symbol mentions
      const symbols = this.extractSymbols(title + ' ' + description);

      articles.push({
        id: this.generateId(link),
        title,
        summary: description.substring(0, 200) + '...',
        content: description,
        url: link,
        source: 'CoinDesk',
        publishedAt: pubDate ? new Date(pubDate) : new Date(),
        sentiment,
        sentimentScore: sentiment === 'bullish' ? 0.5 : sentiment === 'bearish' ? -0.5 : 0,
        categories: ['market', 'general'],
        relatedSymbols: symbols.slice(0, 5),
        importance: this.determineImportance(sentiment, symbols.length),
      });
    });

    return articles.slice(0, limit);
  }

  private analyzeSentiment(text: string): 'bullish' | 'bearish' | 'neutral' {
    const bullishWords = ['up', 'gain', 'rise', 'rally', 'surge', 'breakout', 'buy'];
    const bearishWords = ['down', 'drop', 'fall', 'crash', 'loss', 'bear', 'sell'];
    
    const lower = text.toLowerCase();
    const bullCount = bullishWords.filter(w => lower.includes(w)).length;
    const bearCount = bearishWords.filter(w => lower.includes(w)).length;
    
    if (bullCount > bearCount) return 'bullish';
    if (bearCount > bullCount) return 'bearish';
    return 'neutral';
  }

  private extractSymbols(text: string): string[] {
    const pattern = /\b(BTC|ETH|BNB|SOL|XRP|ADA|DOGE|DOT|MATIC|AVAX)(USDT|USD|BTC)\b/gi;
    const matches = text.match(pattern);
    return matches?.map(m => m.toUpperCase()) || [];
  }

  private generateId(url: string): string {
    return Buffer.from(url).toString('base64');
  }

  private determineImportance(sentiment: string, symbolCount: number): 'low' | 'medium' | 'high' | 'critical' {
    if (sentiment === 'bullish' || sentiment === 'bearish') {
      if (symbolCount >= 5) return 'critical';
      if (symbolCount >= 3) return 'high';
      return 'medium';
    }
    return 'low';
  }
}
```

```typescript
// FILE: src/lib/news-service/fetchers/aggregator.ts (NEW)
import type { NewsFetcher, NewsArticle, NewsSource } from '../types';
import { CoinDeskFetcher } from './coindesk-fetcher';

export class NewsAggregator {
  private sources: NewsSource[] = [];
  private fetchers: Map<string, NewsFetcher> = new Map();

  constructor() {
    this.initializeSources();
  }

  private initializeSources() {
    this.sources = [
      { id: 'coindesk', name: 'CoinDesk', url: 'https://www.coindesk.com', enabled: true },
      { id: 'cryptopanic', name: 'CryptoPanic', url: 'https://cryptopanic.com', enabled: true },
      { id: 'coingecko', name: 'CoinGecko News', url: 'https://www.coingecko.com/news', enabled: true },
    ];

    // Initialize fetchers
    this.fetchers.set('coindesk', new CoinDeskFetcher());
  }

  async fetchAll(enabledOnly: boolean = true): Promise<{ articles: NewsArticle[], errors: string[] }> {
    const allArticles: NewsArticle[] = [];
    const allErrors: string[] = [];
    const sourcesToFetch = enabledOnly 
      ? this.sources.filter(s => s.enabled)
      : this.sources;

    await Promise.all(
      sourcesToFetch.map(async (source) => {
        const fetcher = this.fetchers.get(source.id);
        if (!fetcher) return;

        try {
          const result = await fetcher.fetchArticles();
          
          // Deduplicate articles
          const uniqueArticles = result.articles.filter(
            a => !allArticles.some(existing => existing.id === a.id)
          );
          
          allArticles.push(...uniqueArticles);
          allErrors.push(...result.errors);
        } catch (error) {
          allErrors.push(`${source.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      })
    );

    // Sort by date and relevance
    allArticles.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    
    return { articles: allArticles.slice(0, 100), errors: allErrors };
  }

  async fetchByCategory(category: string): Promise<NewsArticle[]> {
    const result = await this.fetchAll();
    return result.articles.filter(article => article.categories.includes(category));
  }

  async fetchForSymbols(symbols: string[]): Promise<NewsArticle[]> {
    const result = await this.fetchAll();
    return result.articles.filter(article => 
      symbols.some(sym => article.relatedSymbols.includes(sym))
    ).sort((a, b) => {
      const aScore = a.relatedSymbols.filter(s => symbols.includes(s)).length;
      const bScore = b.relatedSymbols.filter(s => symbols.includes(s)).length;
      return bScore - aScore;
    });
  }
}
```

```typescript
// FILE: src/app/api/news/route.ts (NEW)
import { NextRequest, NextResponse } from 'next/server';
import { NewsAggregator } from '@/lib/news-service/aggregator';

const aggregator = new NewsAggregator();

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const symbols = searchParams.getAll('symbol');
    const limit = parseInt(searchParams.get('limit') || '50');
    const forceRefresh = searchParams.get('refresh') === 'true';

    let articles;

    if (symbols.length > 0) {
      articles = await aggregator.fetchForSymbols(symbols);
    } else if (category) {
      articles = await aggregator.fetchByCategory(category);
    } else {
      articles = await aggregator.fetchAll();
    }

    return NextResponse.json({
      success: true,
      data: articles.slice(0, limit),
      meta: { 
        fetchedAt: new Date(),
        totalAvailable: articles.length,
        forceRefresh: forceRefresh,
      },
    });

  } catch (error) {
    console.error('[News API] Error:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}
```

**Crontab/Background Job Setup:**

```typescript
// FILE: src/lib/news-cron-service.ts (NEW)
import { CronJob } from 'cron';

interface CachedNews {
  articles: any[];
  cachedAt: Date;
}

class NewsCacheService {
  private cache: Map<string, CachedNews> = new Map();
  private readonly CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

  async getCached(key: string): Promise<CachedNews | null> {
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    if (Date.now() - cached.cachedAt.getTime() < this.CACHE_DURATION_MS) {
      return cached;
    }
    
    this.cache.delete(key);
    return null;
  }

  async cacheNews(key: string, articles: any[]): Promise<void> {
    this.cache.set(key, {
      articles,
      cachedAt: new Date(),
    });
  }
}

let newsCronJob: CronJob | null = null;

export function startNewsCronService() {
  if (newsCronJob) return;

  newsCronJob = new CronJob('*/15 * * * *', async () => {
    console.log('[News Cron] Fetching latest news...');
    
    try {
      const aggregator = new NewsAggregator();
      const result = await aggregator.fetchAll();
      
      // Cache the results
      const cacheService = new NewsCacheService();
      await cacheService.cacheNews('global_news', result.articles);
      
      console.log(`[News Cron] Fetched ${result.articles.length} articles, ${result.errors.length} errors`);
    } catch (error) {
      console.error('[News Cron] Fetch error:', error);
    }
  });

  newsCronJob.start();
  console.log('[News Cron] Service started - running every 15 minutes');
}

export function stopNewsCronService() {
  if (newsCronJob) {
    newsCronJob.stop();
    newsCronJob = null;
    console.log('[News Cron] Service stopped');
  }
}
```

**Integration with Application Startup:**

```typescript
// FILE: src/app/layout.tsx or src/lib/startup-service.ts
import { startNewsCronService } from '@/lib/news-cron-service';

export async function startup() {
  // Start background services
  startNewsCronService();
  
  // Other initialization...
}
```

**IMPLEMENTATION PRIORITY:** HIGH  
**TIME ESTIMATE:** 3-4 days development  
**FILES TO CREATE:**
- `src/lib/news-service/types.ts` (20 lines)
- `src/lib/news-service/fetchers/coindesk-fetcher.ts` (120 lines)
- `src/lib/news-service/fetchers/aggregator.ts` (100 lines)
- `src/app/api/news/route.ts` (80 lines)
- `src/lib/news-cron-service.ts` (80 lines)
- Update `src/app/page.tsx` NewsView to use real API

---

### 8️⃣ Backup Strategy (Automated Daily Backups)

**Что нужно для реализации:**

```typescript
// FILE: src/lib/backup-service/database-backup.ts (NEW)
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

interface BackupConfig {
  retentionDays: number;
  backupDir: string;
  compression: boolean;
}

class DatabaseBackupService {
  private config: BackupConfig = {
    retentionDays: 30,
    backupDir: '/var/backups/citarion-db',
    compression: true,
  };

  async createBackup(): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
      // Ensure backup directory exists
      await fs.mkdir(this.config.backupDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFileName = `citarion-db-${timestamp}`;
      const filePath = path.join(this.config.backupDir, backupFileName);

      // Create PostgreSQL dump
      const_dumpCommand = process.env.DB_HOST 
        ? `pg_dump -h ${process.env.DB_HOST} -U ${process.env.DB_USER} -d ${process.env.DB_NAME} -F c -f ${filePath}.dump`
        : `pg_dump ${process.env.DB_NAME} -F c -f ${filePath}.dump`;

      await execAsync(_dumpCommand, {
        env: {
          ...process.env,
          PGPASSWORD: process.env.DB_PASSWORD || '',
        },
      });

      // Compress if configured
      if (this.config.compression) {
        await execAsync(`gzip -f ${filePath}.dump`);
        return { 
          success: true, 
          filePath: `${filePath}.dump.gz`
        };
      }

      return { success: true, filePath: `${filePath}.dump` };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Backup failed',
      };
    }
  }

  async deleteOldBackups(): Promise<number> {
    const cutoffDate = new Date(Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000);
    let deletedCount = 0;

    try {
      const files = await fs.readdir(this.config.backupDir);
      
      for (const file of files) {
        const fullPath = path.join(this.config.backupDir, file);
        const stats = await fs.stat(fullPath);
        
        if (stats.isFile() && stats.mtime < cutoffDate) {
          await fs.unlink(fullFull);
          deletedCount++;
        }
      }
    } catch (error) {
      console.error('[Backup] Cleanup error:', error);
    }

    return deletedCount;
  }

  async restoreFromBackup(filePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      let command: string;
      
      if (filePath.endsWith('.gz')) {
        command = `gunzip -c ${filePath} | pg_restore -h ${process.env.DB_HOST} -U ${process.env.DB_USER} -d ${process.env.DB_NAME}`;
      } else {
        command = `pg_restore -h ${process.env.DB_HOST} -U ${process.env.DB_USER} -d ${process.env.DB_NAME} ${filePath}`;
      }

      await execAsync(command, {
        env: {
          ...process.env,
          PGPASSWORD: process.env.DB_PASSWORD || '',
        },
      });

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Restore failed',
      };
    }
  }
}
```

```typescript
// FILE: src/lib/backup-service/scheduler.ts (NEW)
import { CronJob } from 'cron';

class BackupScheduler {
  private backupJob: CronJob | null = null;
  private cleanupJob: CronJob | null = null;
  private backupService: DatabaseBackupService;

  constructor() {
    this.backupService = new DatabaseBackupService();
    this.initializeJobs();
  }

  private initializeJobs() {
    // Daily backup at 2 AM UTC
    this.backupJob = new CronJob('0 2 * * *', async () => {
      console.log('[Backup Scheduler] Running scheduled backup...');
      const result = await this.backupService.createBackup();
      
      if (result.success) {
        console.log(`[Backup Scheduler] Backup completed: ${result.filePath}`);
        await this.sendNotification('success', `Daily backup created: ${result.filePath}`);
      } else {
        console.error('[Backup Scheduler] Backup failed:', result.error);
        await this.sendNotification('error', `Daily backup failed: ${result.error}`);
      }
    });

    // Weekly cleanup on Sunday at 3 AM
    this.cleanupJob = new CronJob('0 3 * * 0', async () => {
      console.log('[Backup Scheduler] Running backup cleanup...');
      const deletedCount = await this.backupService.deleteOldBackups();
      console.log(`[Backup Scheduler] Deleted ${deletedCount} old backups`);
    });
  }

  start() {
    this.backupJob?.start();
    this.cleanupJob?.start();
    console.log('[Backup Scheduler] Jobs started');
  }

  stop() {
    this.backupJob?.stop();
    this.cleanupJob?.stop();
    console.log('[Backup Scheduler] Jobs stopped');
  }

  private async sendNotification(type: 'success' | 'error', message: string) {
    // Send to internal notification system
    // Could also send email, Slack webhook, etc.
    console.log(`[Backup Notification] [${type.toUpperCase()}] ${message}`);
    
    // TODO: Integrate with actual notification service
  }
}

export function initializeBackupScheduler() {
  const scheduler = new BackupScheduler();
  scheduler.start();
  return scheduler;
}
```

```typescript
// FILE: src/app/api/backup/route.ts (NEW)
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { DatabaseBackupService } from '@/lib/backup-service/database-backup';
import { initializeBackupScheduler } from '@/lib/backup-service/scheduler';

const backupService = new DatabaseBackupService();

// Manual backup trigger
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || session.user.role !== 'admin') {
      return new NextResponse('Admin access required', { status: 403 });
    }

    const result = await backupService.createBackup();

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: 'Backup created successfully',
        filePath: result.filePath,
      });
    }

    return new NextResponse(result.error || 'Backup failed', { status: 500 });

  } catch (error) {
    console.error('[Backup API] Error:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}

// List available backups
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || session.user.role !== 'admin') {
      return new NextResponse('Admin access required', { status: 403 });
    }

    const fs = await import('fs/promises');
    const path = await import('path');

    const backupDir = '/var/backups/citarion-db';
    const files = await fs.readdir(backupDir);
    
    const backupList = await Promise.all(
      files.map(async (file) => {
        const stat = await fs.stat(path.join(backupDir, file));
        return {
          fileName: file,
          size: stat.size,
          createdAt: stat.birthtime,
          updatedAt: stat.mtime,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: backupList.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
    });

  } catch (error) {
    console.error('[Backup API] Get list error:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}

// Restore from backup
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || session.user.role !== 'admin') {
      return new NextResponse('Admin access required', { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const filePath = searchParams.get('file');

    if (!filePath) {
      return new NextResponse('Missing file parameter', { status: 400 });
    }

    const result = await backupService.restoreFromBackup(filePath);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: 'Database restored successfully',
      });
    }

    return new NextResponse(result.error || 'Restore failed', { status: 500 });

  } catch (error) {
    console.error('[Backup API] Restore error:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}
```

**Deployment Configuration (docker-compose.yml snippet):**

```yaml
# SERVICE: backup-service
backup-service:
  image: node:18-alpine
  working_dir: /app
  environment:
    - DB_HOST=${DB_HOST}
    - DB_NAME=${DB_NAME}
    - DB_USER=${DB_USER}
    - DB_PASSWORD=${DB_PASSWORD}
  volumes:
    - ./scripts:/scripts
    - backup-data:/var/backups
  command: sh -c "node /scripts/backup-runner.js"
  restart: unless-stopped

volumes:
  backup-data:
```

**IMPLEMENTATION PRIORITY:** MEDIUM  
**TIME ESTIMATE:** 2-3 days development  
**FILES TO CREATE:**
- `src/lib/backup-service/database-backup.ts` (150 lines)
- `src/lib/backup-service/scheduler.ts` (100 lines)
- `src/app/api/backup/route.ts` (150 lines)
- Docker configuration updates

---

### 9️⃣ Monitoring Setup (Sentry Error Tracking)

**Что нужно для реализации:**

```typescript
// FILE: sentry.client.config.ts (NEW - Frontend)
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  
  // Optional: Sample Rate
  tracesSampleRate: 1.0, // Trace 100% of transactions
  
  // Optional: Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  
  // Filters
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
  
  // Environment
  environment: process.env.NODE_ENV || 'development',
  
  // Ignore known non-errors
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'Network request failed',
    'AbortError',
  ],
});

// Configure breadcrumbs for debugging
Sentry.addBreadcrumb({
  category: 'init',
  message: 'Sentry initialized',
  timestamp: new Date(),
});
```

```typescript
// FILE: sentry.edge.config.ts (NEW - Edge Middleware)
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
});
```

```typescript
// FILE: sentry.server.config.ts (NEW - Server-side)
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  
  // Performance monitoring
  tracesSampleRate: 1.0,
  
  // Error sample rate
  debug: process.env.NODE_ENV === 'development',
  
  // Release tracking
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || `citarion@${process.env.npm_package_version}`,
  
  // Profiles sampling
  profilesSampleRate: 0.3,
});
```

```typescript
// FILE: src/app/layout.tsx (Update to include Sentry)
import { SensyProvider } from '@sentry/nextjs';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          src="https://browser.sentry-cdn.com/7.91.0/bundle.tracing.replay.min.js"
          integrity="sha384-KH4Q8XqW2oJj5k1pY1vK2lT5V1q8x9x5x6y7y8y9x5x6y8y9x"
          crossOrigin="anonymous"
        ></script>
      </head>
      <body>
        <Sentry.ProfilerProvider>
          {children}
        </Sentry.ProfilerProvider>
      </body>
    </html>
  );
}
```

```typescript
// FILE: src/lib/monitoring/sentry-error-handler.ts (NEW)
import * as Sentry from '@sentry/nextjs';

export class ErrorHandler {
  static captureException(error: unknown, context?: Record<string, unknown>) {
    Sentry.captureException(error, { contexts: { custom: context } });
  }

  static captureMessage(message: string, level?: 'info' | 'warning' | 'error' | 'fatal') {
    Sentry.captureMessage(message, level);
  }

  static setUser(user: { id?: string; email?: string; username?: string }) {
    Sentry.setUser(user);
  }

  static addBreadcrumb(breadcrumb: Parameters<typeof Sentry.addBreadcrumb>[0]) {
    Sentry.addBreadcrumb(breadcrumb);
  }

  static withScope<T>(callback: (scope: typeof Sentry.Scope) => T): T {
    return Sentry.withScope(callback);
  }

  static captureFeedback(feedback: { comment: string; rating: number; email?: string; name?: string }) {
    Sentry.captureFeedback(feedback);
  }
}
```

```typescript
// FILE: src/lib/monitoring/performance-monitor.ts (NEW)
import * as Sentry from '@sentry/nextjs';

export class PerformanceMonitor {
  static measureApiRoute(routeName: string) {
    return Sentry.startSpan({
      name: `API:${routeName}`,
      op: 'http.server',
    }, async (span) => {
      const startTime = Date.now();
      
      try {
        yield span;
        
        const duration = Date.now() - startTime;
        span.setAttribute('duration_ms', duration);
        
        if (duration > 5000) {
          console.warn(`[Performance] Slow API route: ${routeName} took ${duration}ms`);
        }
        
        return span;
      } catch (error) {
        span.setStatus({ code: Sentry.SpanStatusCode.ERROR });
        span.setAttribute('error', error instanceof Error ? error.message : String(error));
        throw error;
      }
    });
  }

  static measureDatabaseQuery(queryName: string, callback: () => Promise<any>) {
    return Sentry.startSpan({
      name: `DB:${queryName}`,
      op: 'database.query',
    }, async (span) => {
      const startTime = Date.now();
      
      try {
        const result = await callback();
        
        const duration = Date.now() - startTime;
        span.setAttribute('duration_ms', duration);
        
        if (duration > 1000) {
          console.warn(`[Performance] Slow DB query: ${queryName} took ${duration}ms`);
        }
        
        return result;
      } catch (error) {
        span.setStatus({ code: Sentry.SpanStatusCode.ERROR });
        throw error;
      }
    });
  }
}
```

```typescript
// FILE: src/middleware.ts (Update to include Sentry)
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from 'next/server';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
});

export async function middleware(request: Request) {
  const { SentryMiddleware } = await import('@sentry/nextjs');
  return SentryMiddleware(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

```typescript
// FILE: src/app/api/error-boundary.tsx (NEW)
'use client';

import * as Sentry from "@sentry/nextjs";
import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo });
    
    // Log to Sentry
    Sentry.withScope(scope => {
      scope.addEventProcessor(event => {
        Object.entries(errorInfo.componentStack.split('\n')).forEach(([key, value]) => {
          if (value) {
            scope.setExtra(key, value.trim());
          }
        });
        return event;
      });
      
      Sentry.captureException(error);
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 rounded bg-red-50 border border-red-200">
          <h2 className="text-lg font-semibold text-red-800 mb-2">Something went wrong</h2>
          <p className="text-red-600 text-sm mb-4">
            An unexpected error occurred. Our team has been notified.
          </p>
          {process.env.NODE_ENV === 'development' && (
            <pre className="bg-gray-100 p-4 rounded text-xs overflow-auto">
              {this.state.error?.stack}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
```

**.env.local Configuration:**

```bash
# SENTRY CONFIGURATION
NEXT_PUBLIC_SENTRY_DSN=https://xxxxxx@o123456.ingest.sentry.io/789012
SENTRY_AUTH_TOKEN=your_sentry_auth_token
SENTRY_ORG=your-org-name
SENTRY_PROJECT=citarion-api

# Optional: Self-hosted Sentry
# NEXT_PUBLIC_SENTRY_DSN=https://sentry.yourcompany.com/123
```

**Docker/Sentry Setup:**

```yaml
# docker-compose.yml
services:
  # If self-hosting Sentry
  sentry:
    image: sentry:latest
    ports:
      - "9000:9000"
    environment:
      - SECRET_KEY=${SENTRY_SECRET_KEY}
      - postgresql__database=sentry
      - postgresql__username=sentry
      - postgresql__password=${POSTGRES_PASSWORD}
      - postgresql__host=postgres
      - redis__host=redis
  
  postgres:
    image: postgres:14-alpine
    environment:
      - POSTGRES_DB=sentry
      - POSTGRES_USER=sentry
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
  
  redis:
    image: redis:6-alpine
  
volumes:
  postgres_data:
```

**CI/CD Integration:**

```yaml
# .github/workflows/release.yml
name: Release with Sentry Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Create Sentry Release
        uses: getsentry/action-release@v1
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: ${{ vars.SENTRY_ORG }}
          SENTRY_PROJECT: ${{ vars.SENTRY_PROJECT }}
        with:
          environment: production
          sourcemaps: ./out

      - name: Finalize Sentry Release
        uses: getsentry/action-release@v1
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: ${{ vars.SENTRY_ORG }}
          SENTRY_PROJECT: ${{ vars.SENTRY_PROJECT }}
        with:
          environment: production
          finalize: true
```

**IMPLEMENTATION PRIORITY:** MEDIUM  
**TIME ESTIMATE:** 1-2 days development + 1 day testing  
**FILES TO CREATE:**
- `sentry.client.config.ts` (40 lines)
- `sentry.edge.config.ts` (20 lines)
- `sentry.server.config.ts` (30 lines)
- `src/lib/monitoring/sentry-error-handler.ts` (60 lines)
- `src/lib/monitoring/performance-monitor.ts` (50 lines)
- `src/app/api/error-boundary.tsx` (80 lines)
- CI/CD workflow updates

---

## 📊 ИТОГОВАЯ ОЦЕНКА ПРОГРЕССА

| Компонент | Текущий % | После выполнения | Статус |
|-----------|-----------|------------------|--------|
| ML/AI Agents | 90% | 100% | 1-2 дня |
| Live Trading | 90% | 100% | 2-3 дня |
| OKX Full Support | 95% | 100% | 1 день |
| Grid/DCA Backend | 95% | 100% | 1-2 дня |
| Institutional Bots | 40% | 100% | 5-7 дней |
| Signal Parser | 95% | 100% | 1-2 дня |
| Funding Analytics | 60% | 100% | 2-3 дня |
| Trades History | 90% | 100% | 2-3 дня |
| Journal Module | 0% | 100% | 3-4 дня |
| News Service | 0% | 100% | 3-4 дня |
| Backup Strategy | 0% | 100% | 2-3 дня |
| Sentry Monitoring | 0% | 100% | 1-2 дня |

**Total Development Effort:** ~30 дней для полной реализации до 100%

---

## 🎯 ПОРЯДОК ПРИОРИТЕТОВ

1. **CRITICAL (неделя 1-2):**
   - Journal Module (блокера)
   - Institucional Bots basic implementation
   - Backup Strategy setup

2. **HIGH (неделя 3-4):**
   - Funding Analytics real API
   - News Service integration
   - Live Trading enhancement

3. **MEDIUM (неделя 5):**
   - Trades filtering improvement
   - Signal Parser enhancements
   - Grid/DCA backend refinement

4. **LOW (неделя 6):**
   - Sentry monitoring setup
   - OKX final fixes
   - ML/AI polish

---

*Отчёт обновлён: 2025-12-18 v2.0*
*Полная версия доступна по пути:*
`C:\Users\CITARION\PROJECT_AUDIT_COMPLETE_2025_12_18.md`
