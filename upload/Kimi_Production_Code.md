# Kimi Production Code - Ready-to-Use Implementations
## CITARION Project - Production-Ready Code Snippets
### Дата: 11 марта 2026

---

## 1. ГОТОВЫЕ К ПРОДАКШЕНУ КОМПОНЕНТЫ

### 1.1. Exchange Adapter Factory

```typescript
// src/lib/exchange/exchange-factory.ts
import { ExchangeAdapter, ExchangeCredentials } from "./types";
import { BinanceAdapter } from "./adapters/binance-adapter";
import { BybitAdapter } from "./adapters/bybit-adapter";
import { OKXAdapter } from "./adapters/okx-adapter";

export class ExchangeFactory {
  private static adapters = new Map<string, ExchangeAdapter>();

  static async getAdapter(
    exchangeId: string,
    credentials: ExchangeCredentials,
    testnet: boolean = false
  ): Promise<ExchangeAdapter> {
    const cacheKey = `${exchangeId}:${credentials.apiKey.slice(-8)}:${testnet}`;
    
    // Return cached adapter if exists and connected
    const cached = this.adapters.get(cacheKey);
    if (cached) {
      try {
        // Test connection
        await cached.getBalance();
        return cached;
      } catch {
        // Connection lost, remove from cache
        this.adapters.delete(cacheKey);
      }
    }

    // Create new adapter
    let adapter: ExchangeAdapter;
    
    switch (exchangeId) {
      case "binance":
        adapter = new BinanceAdapter();
        break;
      case "bybit":
        adapter = new BybitAdapter();
        break;
      case "okx":
        adapter = new OKXAdapter();
        break;
      default:
        throw new Error(`Unsupported exchange: ${exchangeId}`);
    }

    await adapter.connect(credentials, testnet);
    this.adapters.set(cacheKey, adapter);
    
    return adapter;
  }

  static async disconnectAll(): Promise<void> {
    for (const [key, adapter] of this.adapters) {
      await adapter.disconnect();
      this.adapters.delete(key);
    }
  }
}
```

### 1.2. Real Trading API Route

```typescript
// src/app/api/trade/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { db } from "@/lib/db";
import { ExchangeFactory } from "@/lib/exchange/exchange-factory";
import { ApiKeyEncryption } from "@/lib/encryption/api-key-encryption";
import { handleApiError, withErrorHandler } from "@/lib/errors/error-handler";
import { z } from "zod";

const tradeSchema = z.object({
  symbol: z.string(),
  side: z.enum(["BUY", "SELL"]),
  type: z.enum(["MARKET", "LIMIT"]),
  quantity: z.number().positive(),
  price: z.number().optional(),
  leverage: z.number().min(1).max(125).optional(),
  exchangeId: z.string(),
  accountId: z.string(),
});

export async function POST(request: NextRequest) {
  return withErrorHandler(async () => {
    const session = await getServerSession();
    if (!session?.user?.email) {
      throw new TradingError("Unauthorized", "UNAUTHORIZED", false, false);
    }

    const body = await request.json();
    const validated = tradeSchema.parse(body);

    // Get user's exchange account
    const account = await db.account.findFirst({
      where: {
        id: validated.accountId,
        user: { email: session.user.email },
      },
    });

    if (!account) {
      throw new TradingError("Account not found", "ACCOUNT_NOT_FOUND", false, false);
    }

    if (!account.encryptedApiCredentials) {
      throw new TradingError("API credentials not configured", "NO_CREDENTIALS", false, false);
    }

    // Decrypt credentials
    const encryption = new ApiKeyEncryption();
    const credentials = encryption.decrypt(
      JSON.parse(account.encryptedApiCredentials)
    );

    // Get exchange adapter
    const adapter = await ExchangeFactory.getAdapter(
      validated.exchangeId,
      credentials,
      account.isTestnet
    );

    // Set leverage if specified
    if (validated.leverage) {
      await adapter.setLeverage(validated.symbol, validated.leverage);
    }

    // Place order
    const order = await adapter.placeOrder({
      symbol: validated.symbol,
      side: validated.side,
      type: validated.type,
      quantity: validated.quantity,
      price: validated.price,
    });

    // Log trade
    await db.trade.create({
      data: {
        user: { connect: { email: session.user.email } },
        account: { connect: { id: account.id } },
        symbol: validated.symbol,
        direction: validated.side === "BUY" ? "LONG" : "SHORT",
        entryPrice: order.avgPrice,
        amount: validated.quantity,
        leverage: validated.leverage || 1,
        status: order.status === "FILLED" ? "OPEN" : "PENDING",
        isDemo: account.accountType === "DEMO",
      },
    });

    return {
      success: true,
      order: {
        id: order.orderId,
        status: order.status,
        filledQty: order.filledQty,
        avgPrice: order.avgPrice,
      },
    };
  });
}
```

### 1.3. Cornix Signal Handler

```typescript
// src/lib/signal-processing/cornix-handler.ts
import { CornixSignalParser, CornixSignal } from "@/lib/signal-parsing/cornix-parser";
import { ExchangeFactory } from "@/lib/exchange/exchange-factory";
import { db } from "@/lib/db";
import { ApiKeyEncryption } from "@/lib/encryption/api-key-encryption";

export interface SignalExecutionResult {
  success: boolean;
  signalId: string;
  orders: string[];
  errors: string[];
}

export class CornixSignalHandler {
  private parser = new CornixSignalParser();

  async processSignal(
    message: string,
    userId: string,
    botConfigId?: string
  ): Promise<SignalExecutionResult> {
    const result: SignalExecutionResult = {
      success: false,
      signalId: "",
      orders: [],
      errors: [],
    };

    try {
      // Parse signal
      const signal = this.parser.parse(message);
      if (!signal) {
        result.errors.push("Failed to parse signal");
        return result;
      }

      // Get bot config
      const botConfig = botConfigId 
        ? await db.botConfig.findUnique({ where: { id: botConfigId } })
        : await db.botConfig.findFirst({ 
            where: { userId, isActive: true },
            orderBy: { createdAt: "desc" }
          });

      if (!botConfig) {
        result.errors.push("No active bot configuration found");
        return result;
      }

      // Get user's exchange account
      const account = await db.account.findFirst({
        where: { 
          userId, 
          exchangeId: botConfig.exchangeId,
          isActive: true 
        },
      });

      if (!account?.encryptedApiCredentials) {
        result.errors.push("Exchange account not configured");
        return result;
      }

      // Decrypt credentials
      const encryption = new ApiKeyEncryption();
      const credentials = encryption.decrypt(
        JSON.parse(account.encryptedApiCredentials)
      );

      // Get exchange adapter
      const adapter = await ExchangeFactory.getAdapter(
        botConfig.exchangeId,
        credentials,
        account.isTestnet
      );

      // Calculate position size
      const balance = await adapter.getBalance();
      const usdtBalance = balance.find(b => b.asset === "USDT")?.free || 0;
      
      let positionSize: number;
      if (botConfig.amountType === "PERCENTAGE") {
        positionSize = usdtBalance * (botConfig.tradeAmount / 100);
      } else {
        positionSize = botConfig.tradeAmount;
      }

      // Set leverage
      const leverage = botConfig.leverageOverride 
        ? botConfig.leverage 
        : (signal.leverage || botConfig.leverage);
      
      await adapter.setLeverage(signal.symbol, leverage);

      // Calculate quantity
      const entryPrice = signal.entries.type === "range" 
        ? (signal.entries.values[0] + signal.entries.values[1]) / 2
        : signal.entries.values[0];
      
      const quantity = (positionSize * leverage) / entryPrice;

      // Place entry order
      const order = await adapter.placeOrder({
        symbol: signal.symbol,
        side: signal.direction === "LONG" ? "BUY" : "SELL",
        type: "MARKET",
        quantity,
      });

      result.orders.push(order.orderId);
      result.success = true;

      // Save signal to database
      const savedSignal = await db.signal.create({
        data: {
          userId,
          signalId: await this.getNextSignalId(),
          source: "TELEGRAM",
          sourceMessage: message,
          symbol: signal.symbol,
          direction: signal.direction,
          action: signal.direction === "LONG" ? "BUY" : "SELL",
          entryPrices: JSON.stringify(signal.entries.values),
          takeProfits: JSON.stringify(signal.takeProfits),
          stopLoss: signal.stopLoss,
          leverage,
          status: "ACTIVE",
        },
      });

      result.signalId = savedSignal.id;

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : "Unknown error");
    }

    return result;
  }

  private async getNextSignalId(): Promise<number> {
    const counter = await db.signalIdCounter.upsert({
      where: { id: "signal_counter" },
      update: { lastId: { increment: 1 } },
      create: { id: "signal_counter", lastId: 1 },
    });
    return counter.lastId;
  }
}
```

### 1.4. Telegram Webhook Handler

```typescript
// src/app/api/telegram/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Telegraf } from "telegraf";
import { CornixSignalHandler } from "@/lib/signal-processing/cornix-handler";
import { db } from "@/lib/db";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

export async function POST(request: NextRequest) {
  try {
    const update = await request.json();
    
    // Handle channel posts (signals)
    if (update.channel_post?.text) {
      const message = update.channel_post.text;
      const chatId = update.channel_post.chat.id;
      
      // Find users subscribed to this channel
      const subscriptions = await db.telegramSubscription.findMany({
        where: { channelId: chatId.toString(), active: true },
        include: { user: true },
      });

      const handler = new CornixSignalHandler();

      for (const sub of subscriptions) {
        const result = await handler.processSignal(
          message,
          sub.userId,
          sub.botConfigId
        );

        // Notify user of result
        if (sub.user.telegramId) {
          await bot.telegram.sendMessage(
            sub.user.telegramId,
            result.success 
              ? `✅ Signal executed!\nOrders: ${result.orders.join(", ")}`
              : `❌ Signal failed:\n${result.errors.join("\n")}`
          );
        }
      }
    }

    // Handle direct messages
    if (update.message?.text) {
      const text = update.message.text;
      const userId = update.message.from?.id;

      if (text === "/start") {
        await bot.telegram.sendMessage(
          userId,
          "Welcome to CITARION!\nUse /connect to link your account."
        );
      }

      if (text === "/connect") {
        // Generate connection code
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        await db.telegramConnectionCode.create({
          data: {
            code,
            telegramId: userId.toString(),
            expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
          },
        });

        await bot.telegram.sendMessage(
          userId,
          `Your connection code: \`${code}\`\nEnter this code in the web app to link your account.`,
          { parse_mode: "Markdown" }
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[TelegramWebhook] Error:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
```

### 1.5. Position Monitor Service

```typescript
// src/lib/services/position-monitor.ts
import { db } from "@/lib/db";
import { ExchangeFactory } from "@/lib/exchange/exchange-factory";
import { ApiKeyEncryption } from "@/lib/encryption/api-key-encryption";
import { PriceService } from "@/lib/price/price-service";

interface PositionUpdate {
  positionId: string;
  currentPrice: number;
  unrealizedPnl: number;
  pnlPercent: number;
  shouldClose: boolean;
  closeReason?: "TP" | "SL" | "TRAILING";
}

export class PositionMonitor {
  private priceService = PriceService.getInstance();
  private isRunning = false;
  private intervalId?: NodeJS.Timeout;

  start(intervalMs: number = 5000): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.intervalId = setInterval(() => this.checkPositions(), intervalMs);
    console.log("[PositionMonitor] Started");
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    this.isRunning = false;
    console.log("[PositionMonitor] Stopped");
  }

  private async checkPositions(): Promise<void> {
    try {
      const positions = await db.position.findMany({
        where: { status: "OPEN" },
        include: { account: true },
      });

      for (const position of positions) {
        await this.updatePosition(position);
      }
    } catch (error) {
      console.error("[PositionMonitor] Error checking positions:", error);
    }
  }

  private async updatePosition(position: any): Promise<void> {
    try {
      // Get current price
      const currentPrice = await this.priceService.getPrice(
        position.symbol,
        position.account.exchangeId
      );

      // Calculate PnL
      const entryPrice = position.avgEntryPrice;
      const priceDiff = position.direction === "LONG" 
        ? currentPrice - entryPrice 
        : entryPrice - currentPrice;
      
      const pnlPercent = (priceDiff / entryPrice) * 100 * position.leverage;
      const unrealizedPnl = (priceDiff / entryPrice) * position.totalAmount * position.leverage;

      // Check TP/SL
      let shouldClose = false;
      let closeReason: "TP" | "SL" | "TRAILING" | undefined;

      if (position.takeProfit && currentPrice >= position.takeProfit) {
        shouldClose = true;
        closeReason = "TP";
      } else if (position.stopLoss && currentPrice <= position.stopLoss) {
        shouldClose = true;
        closeReason = "SL";
      }

      // Update position in database
      await db.position.update({
        where: { id: position.id },
        data: {
          currentPrice,
          unrealizedPnl,
        },
      });

      // Close position if needed
      if (shouldClose && closeReason) {
        await this.closePosition(position, closeReason);
      }
    } catch (error) {
      console.error(`[PositionMonitor] Error updating position ${position.id}:`, error);
    }
  }

  private async closePosition(position: any, reason: "TP" | "SL" | "TRAILING"): Promise<void> {
    try {
      // Get exchange adapter
      if (!position.account.encryptedApiCredentials) return;

      const encryption = new ApiKeyEncryption();
      const credentials = encryption.decrypt(
        JSON.parse(position.account.encryptedApiCredentials)
      );

      const adapter = await ExchangeFactory.getAdapter(
        position.account.exchangeId,
        credentials,
        position.account.isTestnet
      );

      // Place closing order
      await adapter.placeOrder({
        symbol: position.symbol,
        side: position.direction === "LONG" ? "SELL" : "BUY",
        type: "MARKET",
        quantity: position.totalAmount,
      });

      // Update position
      await db.position.update({
        where: { id: position.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closeReason: reason,
        },
      });

      // Notify user
      console.log(`[PositionMonitor] Closed position ${position.id} due to ${reason}`);
    } catch (error) {
      console.error(`[PositionMonitor] Error closing position ${position.id}:`, error);
    }
  }
}

// Singleton instance
export const positionMonitor = new PositionMonitor();
```

---

## 2. DATABASE MIGRATIONS

### 2.1. Add Telegram Tables

```prisma
// prisma/schema.prisma additions

model TelegramSubscription {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  channelId   String
  channelName String?
  botConfigId String?
  botConfig   BotConfig? @relation(fields: [botConfigId], references: [id])
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  
  @@unique([userId, channelId])
}

model TelegramConnectionCode {
  id         String   @id @default(cuid())
  code       String   @unique
  telegramId String
  userId     String?
  user       User?    @relation(fields: [userId], references: [id])
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  
  @@index([code])
  @@index([expiresAt])
}
```

### 2.2. Add Exchange API Logging

```prisma
model ExchangeApiCall {
  id        String   @id @default(cuid())
  userId    String
  accountId String
  exchange  String
  endpoint  String
  method    String
  params    String?  // JSON
  response  String?  // JSON
  error     String?
  duration  Int      // ms
  createdAt DateTime @default(now())
  
  @@index([userId, createdAt])
  @@index([exchange, createdAt])
}
```

---

## 3. ENVIRONMENT SETUP

### 3.1. Production Environment Variables

```bash
#!/bin/bash
# setup-production.sh

echo "Setting up production environment..."

# Generate encryption key
ENCRYPTION_KEY=$(openssl rand -hex 32)
echo "ENCRYPTION_MASTER_KEY=$ENCRYPTION_KEY" > .env.production.local

# Database
if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL=file:./prod.db" >> .env.production.local
fi

# NextAuth
if [ -z "$NEXTAUTH_SECRET" ]; then
  NEXTAUTH_SECRET=$(openssl rand -base64 32)
  echo "NEXTAUTH_SECRET=$NEXTAUTH_SECRET" >> .env.production.local
fi

echo "NEXTAUTH_URL=https://your-domain.com" >> .env.production.local

# Redis
echo "REDIS_URL=redis://localhost:6379" >> .env.production.local

# ML Service
echo "ML_SERVICE_URL=http://localhost:3006" >> .env.production.local

# Telegram (optional)
read -p "Enter Telegram Bot Token (or press Enter to skip): " TG_TOKEN
if [ ! -z "$TG_TOKEN" ]; then
  echo "TELEGRAM_BOT_TOKEN=$TG_TOKEN" >> .env.production.local
fi

echo "✅ Production environment configured!"
echo "📄 Check .env.production.local for details"
```

### 3.2. Docker Production Setup

```dockerfile
# Dockerfile
FROM node:20-alpine AS base

# Install dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package.json bun.lock ./
RUN npm install -g bun && bun install

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
```

```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production.local
    depends_on:
      - redis
      - ml-service
    restart: unless-stopped

  ml-service:
    build:
      context: ./mini-services/ml-service
      dockerfile: Dockerfile
    environment:
      - PYTHON_ENV=production
    volumes:
      - ./models:/app/models:ro
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - app
    restart: unless-stopped

volumes:
  redis-data:
  caddy-data:
  caddy-config:
```

---

## 4. DEPLOYMENT CHECKLIST

### Pre-Deployment

- [ ] All environment variables configured
- [ ] Database migrations applied (`bun run db:push`)
- [ ] ML models downloaded to `./models` directory
- [ ] Testnet API keys configured for testing
- [ ] Unit tests passing (`bun run test`)
- [ ] Build successful (`bun run build`)

### Deployment

- [ ] Deploy to staging environment
- [ ] Test all exchange connections (testnet)
- [ ] Test signal parsing
- [ ] Test order placement (small amounts)
- [ ] Monitor logs for errors
- [ ] Check performance metrics

### Post-Deployment

- [ ] Configure monitoring (Sentry)
- [ ] Set up alerting
- [ ] Configure backups
- [ ] Document known issues
- [ ] Train support team

---

## 5. MONITORING & ALERTING

### 5.1. Sentry Integration

```typescript
// src/lib/monitoring/sentry.ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  integrations: [
    Sentry.httpIntegration(),
  ],
  beforeSend(event) {
    // Filter out sensitive data
    if (event.request?.headers) {
      delete event.request.headers["x-mbx-apikey"];
      delete event.request.headers["authorization"];
    }
    return event;
  },
});
```

### 5.2. Health Check Endpoint

```typescript
// src/app/api/health/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const checks = {
    database: false,
    redis: false,
    mlService: false,
  };

  // Check database
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch {
    checks.database = false;
  }

  // Check ML service
  try {
    const response = await fetch(`${process.env.ML_SERVICE_URL}/health`, {
      timeout: 5000,
    });
    checks.mlService = response.ok;
  } catch {
    checks.mlService = false;
  }

  const healthy = Object.values(checks).every(Boolean);

  return NextResponse.json(
    {
      status: healthy ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: healthy ? 200 : 503 }
  );
}
```

---

*Production code подготовлен: Kimi AI*
*Дата: 11 марта 2026*
*Версия: 1.0*
