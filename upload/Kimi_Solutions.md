# Kimi Solutions - Production-Ready Implementation Guide
## CITARION Project - Complete Fix Guide
### Дата: 11 марта 2026

---

## СОДЕРЖАНИЕ

1. [Критические исправления](#1-критические-исправления)
2. [Интеграция с биржами](#2-интеграция-с-биржами)
3. [Cornix-совместимость](#3-cornix-совместимость)
4. [ML Service - реальные модели](#4-ml-service---реальные-модели)
5. [Рефакторинг и устранение дубликатов](#5-рефакторинг-и-устранение-дубликатов)
6. [Безопасность](#6-безопасность)
7. [Обработка ошибок](#7-обработка-ошибок)
8. [Тестирование](#8-тестирование)
9. [Пошаговый план внедрения](#9-пошаговый-план-внедрения)

---

## 1. КРИТИЧЕСКИЕ ИСПРАВЛЕНИЯ

### 1.1. Замена фиксированных цен на реальные

**Проблема:** `src/app/api/demo/trade/route.ts` использует статические цены

**Решение:**

```typescript
// src/lib/price/price-service.ts
import { db } from "@/lib/db";

export class PriceService {
  private static instance: PriceService;
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5000; // 5 seconds

  static getInstance(): PriceService {
    if (!PriceService.instance) {
      PriceService.instance = new PriceService();
    }
    return PriceService.instance;
  }

  async getPrice(symbol: string, exchange: string = "binance"): Promise<number> {
    const cacheKey = `${exchange}:${symbol}`;
    const cached = this.priceCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.price;
    }

    // Try to get from WebSocket first
    const wsPrice = await this.getWebSocketPrice(symbol, exchange);
    if (wsPrice) {
      this.priceCache.set(cacheKey, { price: wsPrice, timestamp: Date.now() });
      return wsPrice;
    }

    // Fallback to database
    const dbPrice = await this.getDatabasePrice(symbol, exchange);
    if (dbPrice) {
      this.priceCache.set(cacheKey, { price: dbPrice, timestamp: Date.now() });
      return dbPrice;
    }

    // Final fallback to exchange API
    const apiPrice = await this.getExchangePrice(symbol, exchange);
    if (apiPrice) {
      this.priceCache.set(cacheKey, { price: apiPrice, timestamp: Date.now() });
      return apiPrice;
    }

    throw new Error(`Unable to get price for ${symbol} on ${exchange}`);
  }

  private async getWebSocketPrice(symbol: string, exchange: string): Promise<number | null> {
    // Integration with existing WebSocket service
    const { getPriceFromWebSocket } = await import("@/lib/price-websocket");
    return getPriceFromWebSocket(symbol, exchange);
  }

  private async getDatabasePrice(symbol: string, exchange: string): Promise<number | null> {
    const marketPrice = await db.marketPrice.findUnique({
      where: { symbol },
    });
    
    if (marketPrice && Date.now() - marketPrice.lastUpdate.getTime() < 60000) {
      return marketPrice.price;
    }
    return null;
  }

  private async getExchangePrice(symbol: string, exchange: string): Promise<number | null> {
    const { ExchangePriceFetcher } = await import("@/lib/exchange/price-fetcher");
    return ExchangePriceFetcher.fetch(symbol, exchange);
  }
}

// Usage in demo/trade/route.ts
import { PriceService } from "@/lib/price/price-service";

export async function POST(request: NextRequest) {
  // ...
  const priceService = PriceService.getInstance();
  const currentPrice = entryPrices[0] || await priceService.getPrice(symbol, exchangeId);
  // ...
}
```

### 1.2. Exchange Price Fetcher

```typescript
// src/lib/exchange/price-fetcher.ts
export class ExchangePriceFetcher {
  private static readonly EXCHANGE_APIS: Record<string, string> = {
    binance: "https://api.binance.com/api/v3/ticker/price",
    bybit: "https://api.bybit.com/v5/market/tickers",
    okx: "https://www.okx.com/api/v5/market/ticker",
    bitget: "https://api.bitget.com/api/v2/spot/market/tickers",
    bingx: "https://open-api.bingx.com/openApi/spot/v1/ticker/24hr",
  };

  static async fetch(symbol: string, exchange: string): Promise<number | null> {
    try {
      const baseUrl = this.EXCHANGE_APIS[exchange];
      if (!baseUrl) return null;

      const formattedSymbol = this.formatSymbol(symbol, exchange);
      const url = `${baseUrl}?symbol=${formattedSymbol}`;
      
      const response = await fetch(url, { 
        next: { revalidate: 5 },
        headers: { 'Accept': 'application/json' }
      });
      
      if (!response.ok) return null;
      
      const data = await response.json();
      return this.parsePrice(data, exchange);
    } catch (error) {
      console.error(`[PriceFetcher] Error fetching ${symbol} from ${exchange}:`, error);
      return null;
    }
  }

  private static formatSymbol(symbol: string, exchange: string): string {
    const cleanSymbol = symbol.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    
    switch (exchange) {
      case "binance":
      case "bybit":
        return cleanSymbol;
      case "okx":
        return `${cleanSymbol}-SWAP`;
      case "bitget":
        return cleanSymbol;
      default:
        return cleanSymbol;
    }
  }

  private static parsePrice(data: any, exchange: string): number | null {
    try {
      switch (exchange) {
        case "binance":
          return parseFloat(data.price);
        case "bybit":
          return parseFloat(data.result?.list?.[0]?.lastPrice);
        case "okx":
          return parseFloat(data.data?.[0]?.last);
        case "bitget":
          return parseFloat(data.data?.[0]?.lastPr);
        default:
          return null;
      }
    } catch {
      return null;
    }
  }
}
```

---

## 2. ИНТЕГРАЦИЯ С БИРЖАМИ

### 2.1. Exchange Adapter Pattern

```typescript
// src/lib/exchange/types.ts
export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  uid?: string;
}

export interface Balance {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

export interface Order {
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity: number;
  price?: number;
  timeInForce?: "GTC" | "IOC" | "FOK";
}

export interface OrderResult {
  orderId: string;
  symbol: string;
  status: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED" | "REJECTED";
  filledQty: number;
  avgPrice: number;
  commission: number;
  commissionAsset: string;
}

export interface Position {
  symbol: string;
  side: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  liquidationPrice?: number;
}

export interface ExchangeAdapter {
  readonly name: string;
  readonly supportsTestnet: boolean;
  
  connect(credentials: ExchangeCredentials, testnet?: boolean): Promise<void>;
  disconnect(): Promise<void>;
  
  getBalance(): Promise<Balance[]>;
  getPositions(): Promise<Position[]>;
  
  placeOrder(order: Order): Promise<OrderResult>;
  cancelOrder(orderId: string, symbol: string): Promise<boolean>;
  getOrderStatus(orderId: string, symbol: string): Promise<OrderResult>;
  
  setLeverage(symbol: string, leverage: number): Promise<void>;
  setMarginType(symbol: string, type: "ISOLATED" | "CROSSED"): Promise<void>;
}
```

### 2.2. Binance Adapter (Production-Ready)

```typescript
// src/lib/exchange/adapters/binance-adapter.ts
import crypto from "crypto";
import { ExchangeAdapter, ExchangeCredentials, Order, OrderResult, Position, Balance } from "../types";

export class BinanceAdapter implements ExchangeAdapter {
  readonly name = "binance";
  readonly supportsTestnet = true;
  
  private baseUrl: string = "https://fapi.binance.com";
  private credentials?: ExchangeCredentials;
  private recvWindow: number = 5000;

  async connect(credentials: ExchangeCredentials, testnet: boolean = false): Promise<void> {
    this.credentials = credentials;
    this.baseUrl = testnet 
      ? "https://testnet.binancefuture.com" 
      : "https://fapi.binance.com";
    
    // Test connection
    await this.testConnection();
  }

  async disconnect(): Promise<void> {
    this.credentials = undefined;
  }

  private async testConnection(): Promise<void> {
    const account = await this.makeRequest("GET", "/fapi/v2/account");
    if (!account) {
      throw new Error("Failed to connect to Binance API");
    }
  }

  async getBalance(): Promise<Balance[]> {
    const account = await this.makeRequest("GET", "/fapi/v2/account");
    
    return account.assets
      .filter((asset: any) => parseFloat(asset.walletBalance) > 0)
      .map((asset: any) => ({
        asset: asset.asset,
        free: parseFloat(asset.availableBalance),
        locked: parseFloat(asset.walletBalance) - parseFloat(asset.availableBalance),
        total: parseFloat(asset.walletBalance),
      }));
  }

  async getPositions(): Promise<Position[]> {
    const account = await this.makeRequest("GET", "/fapi/v2/account");
    
    return account.positions
      .filter((pos: any) => parseFloat(pos.positionAmt) !== 0)
      .map((pos: any) => ({
        symbol: pos.symbol,
        side: parseFloat(pos.positionAmt) > 0 ? "LONG" : "SHORT",
        size: Math.abs(parseFloat(pos.positionAmt)),
        entryPrice: parseFloat(pos.entryPrice),
        markPrice: parseFloat(pos.markPrice),
        unrealizedPnl: parseFloat(pos.unrealizedProfit),
        leverage: parseInt(pos.leverage),
        liquidationPrice: parseFloat(pos.liquidationPrice) || undefined,
      }));
  }

  async placeOrder(order: Order): Promise<OrderResult> {
    const params: Record<string, string> = {
      symbol: order.symbol.toUpperCase(),
      side: order.side,
      type: order.type,
      quantity: order.quantity.toString(),
    };

    if (order.type === "LIMIT") {
      params.price = order.price!.toString();
      params.timeInForce = order.timeInForce || "GTC";
    }

    const result = await this.makeRequest("POST", "/fapi/v1/order", params);
    
    return {
      orderId: result.orderId.toString(),
      symbol: result.symbol,
      status: result.status,
      filledQty: parseFloat(result.executedQty),
      avgPrice: parseFloat(result.avgPrice),
      commission: parseFloat(result.cumQuote) * 0.0004, // Approximate
      commissionAsset: "USDT",
    };
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    try {
      await this.makeRequest("DELETE", "/fapi/v1/order", {
        symbol: symbol.toUpperCase(),
        orderId,
      });
      return true;
    } catch {
      return false;
    }
  }

  async getOrderStatus(orderId: string, symbol: string): Promise<OrderResult> {
    const result = await this.makeRequest("GET", "/fapi/v1/order", {
      symbol: symbol.toUpperCase(),
      orderId,
    });

    return {
      orderId: result.orderId.toString(),
      symbol: result.symbol,
      status: result.status,
      filledQty: parseFloat(result.executedQty),
      avgPrice: parseFloat(result.avgPrice),
      commission: 0,
      commissionAsset: "USDT",
    };
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    await this.makeRequest("POST", "/fapi/v1/leverage", {
      symbol: symbol.toUpperCase(),
      leverage: leverage.toString(),
    });
  }

  async setMarginType(symbol: string, type: "ISOLATED" | "CROSSED"): Promise<void> {
    await this.makeRequest("POST", "/fapi/v1/marginType", {
      symbol: symbol.toUpperCase(),
      marginType: type,
    });
  }

  private async makeRequest(
    method: string, 
    endpoint: string, 
    params: Record<string, string> = {}
  ): Promise<any> {
    if (!this.credentials) {
      throw new Error("Not connected to exchange");
    }

    const timestamp = Date.now();
    const queryString = new URLSearchParams({
      ...params,
      timestamp: timestamp.toString(),
      recvWindow: this.recvWindow.toString(),
    }).toString();

    const signature = crypto
      .createHmac("sha256", this.credentials.apiSecret)
      .update(queryString)
      .digest("hex");

    const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
    
    const response = await fetch(url, {
      method,
      headers: {
        "X-MBX-APIKEY": this.credentials.apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new ExchangeError(error.msg, error.code);
    }

    return response.json();
  }
}

// Error class
export class ExchangeError extends Error {
  constructor(message: string, public code: number) {
    super(message);
    this.name = "ExchangeError";
  }
}
```

### 2.3. Exchange Manager (Singleton)

```typescript
// src/lib/exchange/exchange-manager.ts
import { ExchangeAdapter, ExchangeCredentials } from "./types";
import { BinanceAdapter } from "./adapters/binance-adapter";
import { BybitAdapter } from "./adapters/bybit-adapter";
import { OKXAdapter } from "./adapters/okx-adapter";

export class ExchangeManager {
  private static instance: ExchangeManager;
  private adapters: Map<string, ExchangeAdapter> = new Map();
  private connections: Map<string, ExchangeAdapter> = new Map();

  private readonly adapterRegistry: Record<string, new () => ExchangeAdapter> = {
    binance: BinanceAdapter,
    bybit: BybitAdapter,
    okx: OKXAdapter,
    // Add more exchanges
  };

  static getInstance(): ExchangeManager {
    if (!ExchangeManager.instance) {
      ExchangeManager.instance = new ExchangeManager();
    }
    return ExchangeManager.instance;
  }

  async connect(
    exchangeId: string, 
    credentials: ExchangeCredentials, 
    testnet: boolean = false
  ): Promise<ExchangeAdapter> {
    const AdapterClass = this.adapterRegistry[exchangeId];
    if (!AdapterClass) {
      throw new Error(`Unsupported exchange: ${exchangeId}`);
    }

    const adapter = new AdapterClass();
    await adapter.connect(credentials, testnet);
    
    const connectionKey = `${exchangeId}:${credentials.apiKey.slice(-8)}`;
    this.connections.set(connectionKey, adapter);
    
    return adapter;
  }

  getConnection(exchangeId: string, apiKeySuffix: string): ExchangeAdapter | undefined {
    return this.connections.get(`${exchangeId}:${apiKeySuffix}`);
  }

  async disconnectAll(): Promise<void> {
    for (const [key, adapter] of this.connections) {
      await adapter.disconnect();
      this.connections.delete(key);
    }
  }

  getSupportedExchanges(): string[] {
    return Object.keys(this.adapterRegistry);
  }
}
```

---

## 3. CORNIX-СОВМЕСТИМОСТЬ

### 3.1. Cornix Signal Parser

```typescript
// src/lib/signal-parsing/cornix-parser.ts
export interface CornixSignal {
  symbol: string;
  direction: "LONG" | "SHORT";
  entries: {
    type: "single" | "range" | "multiple";
    values: number[];
  };
  takeProfits: {
    price: number;
    percentage?: number;
  }[];
  stopLoss: number;
  leverage?: number;
  marketType?: "SPOT" | "FUTURES";
  trailingStop?: {
    type: "PERCENTAGE" | "BREAKEVEN";
    value: number;
  };
  comment?: string;
}

export class CornixSignalParser {
  private static readonly SYMBOL_PATTERN = /#([A-Z0-9]+)/i;
  private static readonly DIRECTION_PATTERN = /#(LONG|SHORT)/i;
  private static readonly ENTRY_PATTERN = /(?:Entry|Entries|Buy)[\s:]*([\d\s,.\-]+)/i;
  private static readonly TP_PATTERN = /(?:TP|Take-?Profit|Target)[\s:]*([\d\s,.]+)/gi;
  private static readonly SL_PATTERN = /(?:SL|Stop-?Loss)[\s:]*([\d.]+)/i;
  private static readonly LEVERAGE_PATTERN = /(?:Leverage|Lever)[\s:]*(\d+)x?/i;
  private static readonly TRAILING_PATTERN = /Trailing[\s:]*(\d+)%?/i;

  parse(message: string): CornixSignal | null {
    try {
      const symbol = this.extractSymbol(message);
      if (!symbol) return null;

      const direction = this.extractDirection(message);
      if (!direction) return null;

      const entries = this.extractEntries(message);
      if (!entries) return null;

      const takeProfits = this.extractTakeProfits(message);
      if (!takeProfits.length) return null;

      const stopLoss = this.extractStopLoss(message);
      if (!stopLoss) return null;

      return {
        symbol,
        direction,
        entries,
        takeProfits,
        stopLoss,
        leverage: this.extractLeverage(message),
        marketType: this.detectMarketType(message),
        trailingStop: this.extractTrailingStop(message),
        comment: this.extractComment(message),
      };
    } catch (error) {
      console.error("[CornixParser] Parse error:", error);
      return null;
    }
  }

  private extractSymbol(message: string): string | null {
    const match = message.match(CornixSignalParser.SYMBOL_PATTERN);
    return match ? match[1].toUpperCase() + "USDT" : null;
  }

  private extractDirection(message: string): "LONG" | "SHORT" | null {
    const match = message.match(CornixSignalParser.DIRECTION_PATTERN);
    return match ? (match[1].toUpperCase() as "LONG" | "SHORT") : null;
  }

  private extractEntries(message: string): CornixSignal["entries"] | null {
    const match = message.match(CornixSignalParser.ENTRY_PATTERN);
    if (!match) return null;

    const valueStr = match[1];
    
    // Check for range (e.g., "67000-67500")
    if (valueStr.includes("-") || valueStr.includes("–")) {
      const [min, max] = valueStr.split(/[-–]/).map(v => parseFloat(v.trim().replace(/,/g, "")));
      return { type: "range", values: [min, max] };
    }

    // Check for multiple entries
    const values = valueStr
      .split(/[,\s]+/)
      .map(v => parseFloat(v.trim().replace(/,/g, "")))
      .filter(v => !isNaN(v));

    if (values.length === 1) {
      return { type: "single", values };
    }
    
    return { type: "multiple", values };
  }

  private extractTakeProfits(message: string): CornixSignal["takeProfits"] {
    const results: CornixSignal["takeProfits"] = [];
    const matches = message.matchAll(CornixSignalParser.TP_PATTERN);
    
    for (const match of matches) {
      const prices = match[1]
        .split(/[,\s]+/)
        .map(v => parseFloat(v.trim().replace(/,/g, "")))
        .filter(v => !isNaN(v));
      
      prices.forEach(price => results.push({ price }));
    }

    return results;
  }

  private extractStopLoss(message: string): number | null {
    const match = message.match(CornixSignalParser.SL_PATTERN);
    return match ? parseFloat(match[1].replace(/,/g, "")) : null;
  }

  private extractLeverage(message: string): number | undefined {
    const match = message.match(CornixSignalParser.LEVERAGE_PATTERN);
    return match ? parseInt(match[1]) : undefined;
  }

  private detectMarketType(message: string): "SPOT" | "FUTURES" {
    const lower = message.toLowerCase();
    if (lower.includes("spot")) return "SPOT";
    if (lower.includes("futures") || lower.includes("perp")) return "FUTURES";
    return "FUTURES"; // Default
  }

  private extractTrailingStop(message: string): CornixSignal["trailingStop"] | undefined {
    const match = message.match(CornixSignalParser.TRAILING_PATTERN);
    if (!match) return undefined;
    
    return {
      type: "PERCENTAGE",
      value: parseFloat(match[1]),
    };
  }

  private extractComment(message: string): string | undefined {
    // Extract any text after the main signal
    const lines = message.split("\n");
    const commentLines = lines.filter(line => 
      line.trim() && 
      !line.match(/#[A-Z0-9]+/i) &&
      !line.match(/#(LONG|SHORT)/i) &&
      !line.match(/(?:Entry|TP|SL|Leverage)/i)
    );
    
    return commentLines.length > 0 ? commentLines.join(" ").trim() : undefined;
  }
}
```

### 3.2. Cornix-совместимые параметры бота

```typescript
// src/lib/bot-config/cornix-config.ts
export interface CornixBotConfig {
  // General Settings
  amountPerTrade: {
    type: "FIXED" | "PERCENTAGE" | "RISK_PERCENTAGE";
    value: number;
    useOnlyIfNotDefined: boolean;
  };

  // Entry Strategy
  entryStrategy: {
    type: "EVENLY_DIVIDED" | "DECREASING_EXP" | "INCREASING_EXP" | "CUSTOM" | "DCA";
    customRatios?: number[];
    dcaSettings?: {
      firstEntryPercent?: number;
      amountScale: number;
      priceDiff: number;
      priceScale: number;
      maxPriceDiff: number;
    };
  };

  // Take Profit Strategy
  takeProfitStrategy: {
    type: "EVENLY_DIVIDED" | "ONE_TARGET" | "TWO_TARGETS" | "THREE_TARGETS" | 
          "FIFTY_ON_FIRST" | "DECREASING_EXP" | "INCREASING_EXP" | "SKIP_FIRST" | "CUSTOM";
    targetCount: number;
    customRatios?: number[];
    graceEnabled: boolean;
    graceMaxCap: number;
  };

  // Stop Loss Strategy
  stopLossStrategy: {
    enabled: boolean;
    percentage: number;
    timeout: number;
    timeoutUnit: "SECONDS" | "MINUTES" | "HOURS";
  };

  // Trailing Stop
  trailingStop: {
    enabled: boolean;
    type: "BREAKEVEN" | "MOVING_TARGET" | "MOVING_2_TARGET" | 
          "PERCENT_BELOW_TRIGGERS" | "PERCENT_BELOW_HIGHEST";
    triggerType: "TARGET_REACHED" | "PERCENT_ABOVE_ENTRY";
    triggerValue: number;
    trailingPercent?: number;
  };

  // First Entry as Market
  firstEntryAsMarket: {
    enabled: boolean;
    cap: number;
    activate: "ENTRY_PRICE_REACHED" | "IMMEDIATELY";
  };

  // Leverage
  leverage: {
    value: number;
    useOnlyIfNotDefined: boolean;
    marginType: "ISOLATED" | "CROSSED";
  };

  // Symbols
  symbols: {
    whitelist?: string[];
    blacklist?: string[];
  };

  // Operation Hours
  operationHours?: {
    enabled: boolean;
    timezone: string;
    schedule: {
      day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
      start: string; // "09:00"
      end: string;   // "17:00"
    }[];
  };
}

export const DEFAULT_CORNIX_CONFIG: CornixBotConfig = {
  amountPerTrade: {
    type: "PERCENTAGE",
    value: 10,
    useOnlyIfNotDefined: false,
  },
  entryStrategy: {
    type: "EVENLY_DIVIDED",
  },
  takeProfitStrategy: {
    type: "EVENLY_DIVIDED",
    targetCount: 3,
    graceEnabled: false,
    graceMaxCap: 0.5,
  },
  stopLossStrategy: {
    enabled: true,
    percentage: 15,
    timeout: 0,
    timeoutUnit: "SECONDS",
  },
  trailingStop: {
    enabled: false,
    type: "BREAKEVEN",
    triggerType: "TARGET_REACHED",
    triggerValue: 1,
  },
  firstEntryAsMarket: {
    enabled: false,
    cap: 1,
    activate: "ENTRY_PRICE_REACHED",
  },
  leverage: {
    value: 10,
    useOnlyIfNotDefined: true,
    marginType: "ISOLATED",
  },
  symbols: {},
};
```

---

## 4. ML SERVICE - РЕАЛЬНЫЕ МОДЕЛИ

### 4.1. Обновлённый Price Predictor

```python
# mini-services/ml-service/models/price_predictor.py
import numpy as np
import logging
from typing import Tuple, Optional, Dict, Any, List
from dataclasses import dataclass
import joblib
import os

logger = logging.getLogger(__name__)

try:
    import tensorflow as tf
    from tensorflow import keras
    from tensorflow.keras import layers
    TF_AVAILABLE = True
except ImportError:
    TF_AVAILABLE = False
    logger.warning("TensorFlow not available")

@dataclass
class PredictionResult:
    direction: str  # "UP", "DOWN", "NEUTRAL"
    confidence: float
    price_change_1m: float
    price_change_5m: float
    price_change_15m: float
    price_change_1h: float

class PricePredictorModel:
    """
    Production-ready price prediction model.
    Uses LSTM with attention for multi-horizon predictions.
    """
    
    MODEL_PATH = "models/price_predictor"
    
    def __init__(
        self,
        sequence_length: int = 60,
        features: int = 20,
        hidden_units: int = 128,
        num_layers: int = 2,
        dropout: float = 0.2,
    ):
        self.sequence_length = sequence_length
        self.features = features
        self.hidden_units = hidden_units
        self.num_layers = num_layers
        self.dropout = dropout
        
        self.model = None
        self.is_trained = False
        self.scaler = None
        
        # Try to load pre-trained model
        self._load_model()
    
    def _build_model(self) -> 'keras.Model':
        """Build LSTM + Attention model"""
        if not TF_AVAILABLE:
            return None
        
        inputs = layers.Input(shape=(self.sequence_length, self.features))
        
        # Bidirectional LSTM layers
        x = inputs
        for i in range(self.num_layers):
            return_sequences = i < self.num_layers - 1
            x = layers.Bidirectional(
                layers.LSTM(
                    self.hidden_units // 2,
                    return_sequences=return_sequences,
                    dropout=self.dropout,
                    recurrent_dropout=self.dropout,
                )
            )(x)
        
        # Attention mechanism
        attention = layers.Dense(1, activation='tanh')(x)
        attention = layers.Flatten()(attention)
        attention = layers.Activation('softmax')(attention)
        attention = layers.RepeatVector(self.hidden_units)(attention)
        attention = layers.Permute([2, 1])(attention)
        
        # Apply attention
        x = layers.Multiply()([x, attention])
        x = layers.Lambda(lambda x: tf.reduce_sum(x, axis=1))(x)
        
        # Dense layers
        x = layers.Dense(64, activation='relu')(x)
        x = layers.Dropout(self.dropout)(x)
        x = layers.Dense(32, activation='relu')(x)
        
        # Output: 4 horizons (1m, 5m, 15m, 1h)
        outputs = layers.Dense(4, activation='linear', name='price_changes')(x)
        
        model = keras.Model(inputs=inputs, outputs=outputs)
        model.compile(
            optimizer=keras.optimizers.Adam(learning_rate=0.001),
            loss='huber',
            metrics=['mae', 'mse']
        )
        
        return model
    
    def _load_model(self) -> bool:
        """Load pre-trained model from disk"""
        try:
            model_path = f"{self.MODEL_PATH}.h5"
            scaler_path = f"{self.MODEL_PATH}_scaler.pkl"
            
            if os.path.exists(model_path) and TF_AVAILABLE:
                self.model = keras.models.load_model(model_path)
                self.is_trained = True
                logger.info("Loaded pre-trained price predictor model")
            
            if os.path.exists(scaler_path):
                self.scaler = joblib.load(scaler_path)
            
            return self.is_trained
        except Exception as e:
            logger.warning(f"Could not load model: {e}")
            if TF_AVAILABLE:
                self.model = self._build_model()
            return False
    
    def save_model(self) -> bool:
        """Save model to disk"""
        try:
            if self.model:
                self.model.save(f"{self.MODEL_PATH}.h5")
            if self.scaler:
                joblib.dump(self.scaler, f"{self.MODEL_PATH}_scaler.pkl")
            return True
        except Exception as e:
            logger.error(f"Failed to save model: {e}")
            return False
    
    def predict(self, features: np.ndarray) -> List[PredictionResult]:
        """
        Predict price changes.
        
        Args:
            features: Input features (samples, sequence_length, features)
        
        Returns:
            List of PredictionResult
        """
        if not self.is_trained or self.model is None:
            # Return neutral predictions if model not available
            return [self._neutral_prediction() for _ in range(len(features))]
        
        # Normalize features
        if self.scaler:
            features = self.scaler.transform(
                features.reshape(-1, self.features)
            ).reshape(features.shape)
        
        predictions = self.model.predict(features, verbose=0)
        
        results = []
        for pred in predictions:
            results.append(self._parse_prediction(pred))
        
        return results
    
    def _parse_prediction(self, pred: np.ndarray) -> PredictionResult:
        """Parse model output to PredictionResult"""
        avg_change = np.mean(pred)
        
        if avg_change > 0.001:
            direction = "UP"
            confidence = min(abs(avg_change) * 100, 1.0)
        elif avg_change < -0.001:
            direction = "DOWN"
            confidence = min(abs(avg_change) * 100, 1.0)
        else:
            direction = "NEUTRAL"
            confidence = 0.5
        
        return PredictionResult(
            direction=direction,
            confidence=confidence,
            price_change_1m=float(pred[0]),
            price_change_5m=float(pred[1]),
            price_change_15m=float(pred[2]),
            price_change_1h=float(pred[3]),
        )
    
    def _neutral_prediction(self) -> PredictionResult:
        return PredictionResult(
            direction="NEUTRAL",
            confidence=0.5,
            price_change_1m=0.0,
            price_change_5m=0.0,
            price_change_15m=0.0,
            price_change_1h=0.0,
        )
    
    def get_metrics(self) -> Dict[str, Any]:
        return {
            "is_trained": self.is_trained,
            "sequence_length": self.sequence_length,
            "features": self.features,
            "model_loaded": self.model is not None,
        }
```

### 4.2. Feature Engineering Service

```python
# mini-services/ml-service/features/feature_engineer.py
import numpy as np
import pandas as pd
from typing import List, Dict, Any
import logging

logger = logging.getLogger(__name__)

class FeatureEngineer:
    """
    Feature engineering for price prediction.
    Creates technical indicators and features from OHLCV data.
    """
    
    def __init__(self, sequence_length: int = 60):
        self.sequence_length = sequence_length
    
    def create_features(self, ohlcv: pd.DataFrame) -> np.ndarray:
        """
        Create features from OHLCV data.
        
        Args:
            ohlcv: DataFrame with columns [open, high, low, close, volume]
        
        Returns:
            Feature array (sequence_length, n_features)
        """
        df = ohlcv.copy()
        
        # Price-based features
        df['returns'] = df['close'].pct_change()
        df['log_returns'] = np.log(df['close'] / df['close'].shift(1))
        
        # Volatility
        df['volatility'] = df['returns'].rolling(window=20).std()
        df['atr'] = self._calculate_atr(df)
        
        # Moving averages
        df['sma_7'] = df['close'].rolling(window=7).mean()
        df['sma_20'] = df['close'].rolling(window=20).mean()
        df['sma_50'] = df['close'].rolling(window=50).mean()
        df['ema_12'] = df['close'].ewm(span=12).mean()
        df['ema_26'] = df['close'].ewm(span=26).mean()
        
        # Price relative to MAs
        df['price_sma7_ratio'] = df['close'] / df['sma_7']
        df['price_sma20_ratio'] = df['close'] / df['sma_20']
        
        # MACD
        df['macd'] = df['ema_12'] - df['ema_26']
        df['macd_signal'] = df['macd'].ewm(span=9).mean()
        df['macd_histogram'] = df['macd'] - df['macd_signal']
        
        # RSI
        df['rsi'] = self._calculate_rsi(df['close'])
        
        # Bollinger Bands
        df['bb_middle'] = df['close'].rolling(window=20).mean()
        bb_std = df['close'].rolling(window=20).std()
        df['bb_upper'] = df['bb_middle'] + 2 * bb_std
        df['bb_lower'] = df['bb_middle'] - 2 * bb_std
        df['bb_position'] = (df['close'] - df['bb_lower']) / (df['bb_upper'] - df['bb_lower'])
        
        # Volume features
        df['volume_sma'] = df['volume'].rolling(window=20).mean()
        df['volume_ratio'] = df['volume'] / df['volume_sma']
        
        # Price action
        df['high_low_range'] = (df['high'] - df['low']) / df['close']
        df['open_close_range'] = abs(df['close'] - df['open']) / df['close']
        
        # Select features
        feature_columns = [
            'returns', 'log_returns', 'volatility', 'atr',
            'price_sma7_ratio', 'price_sma20_ratio',
            'macd', 'macd_signal', 'macd_histogram',
            'rsi', 'bb_position',
            'volume_ratio', 'high_low_range', 'open_close_range'
        ]
        
        features = df[feature_columns].fillna(0)
        
        # Return last sequence_length rows
        return features.tail(self.sequence_length).values
    
    def _calculate_rsi(self, prices: pd.Series, period: int = 14) -> pd.Series:
        """Calculate RSI"""
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        return 100 - (100 / (1 + rs))
    
    def _calculate_atr(self, df: pd.DataFrame, period: int = 14) -> pd.Series:
        """Calculate Average True Range"""
        high_low = df['high'] - df['low']
        high_close = np.abs(df['high'] - df['close'].shift())
        low_close = np.abs(df['low'] - df['close'].shift())
        tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
        return tr.rolling(window=period).mean()
```

### 4.3. Data Pipeline

```python
# mini-services/ml-service/data/data_pipeline.py
import pandas as pd
import numpy as np
from typing import Optional, List
import aiohttp
import asyncio
import logging

logger = logging.getLogger(__name__)

class OHLCVDataPipeline:
    """
    Pipeline for fetching and processing OHLCV data.
    """
    
    def __init__(self, exchange: str = "binance"):
        self.exchange = exchange
        self.base_urls = {
            "binance": "https://fapi.binance.com/fapi/v1/klines",
            "bybit": "https://api.bybit.com/v5/market/kline",
        }
    
    async def fetch_ohlcv(
        self, 
        symbol: str, 
        timeframe: str = "1m", 
        limit: int = 1000
    ) -> Optional[pd.DataFrame]:
        """
        Fetch OHLCV data from exchange.
        
        Args:
            symbol: Trading pair (e.g., "BTCUSDT")
            timeframe: Candle timeframe (e.g., "1m", "5m", "1h")
            limit: Number of candles to fetch
        
        Returns:
            DataFrame with OHLCV data
        """
        try:
            url = self.base_urls.get(self.exchange)
            if not url:
                logger.error(f"Unsupported exchange: {self.exchange}")
                return None
            
            params = {
                "symbol": symbol.upper(),
                "interval": self._format_timeframe(timeframe),
                "limit": limit,
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, params=params) as response:
                    if response.status != 200:
                        logger.error(f"API error: {response.status}")
                        return None
                    
                    data = await response.json()
                    return self._parse_klines(data)
        
        except Exception as e:
            logger.error(f"Error fetching OHLCV: {e}")
            return None
    
    def _format_timeframe(self, timeframe: str) -> str:
        """Convert timeframe to exchange format"""
        mapping = {
            "1m": "1",
            "5m": "5",
            "15m": "15",
            "1h": "60",
            "4h": "240",
            "1d": "D",
        }
        return mapping.get(timeframe, "1")
    
    def _parse_klines(self, data: List) -> pd.DataFrame:
        """Parse kline data to DataFrame"""
        if self.exchange == "binance":
            df = pd.DataFrame(data, columns=[
                'timestamp', 'open', 'high', 'low', 'close', 'volume',
                'close_time', 'quote_volume', 'trades', 'taker_buy_volume',
                'taker_buy_quote_volume', 'ignore'
            ])
        else:
            # Bybit format
            df = pd.DataFrame(data['result']['list'] if isinstance(data, dict) else data)
        
        # Convert types
        numeric_columns = ['open', 'high', 'low', 'close', 'volume']
        for col in numeric_columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
        
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        df.set_index('timestamp', inplace=True)
        
        return df
```

---

## 5. РЕФАКТОРИНГ И УСТРАНЕНИЕ ДУБЛИКАТОВ

### 5.1. Shared Constants

```typescript
// src/lib/constants/exchanges.ts
export interface ExchangeInfo {
  id: string;
  name: string;
  supported: boolean;
  supportsSpot: boolean;
  supportsFutures: boolean;
  supportsTestnet: boolean;
  maxLeverage: number;
  makerFee: number;
  takerFee: number;
}

export const SUPPORTED_EXCHANGES: ExchangeInfo[] = [
  {
    id: "binance",
    name: "Binance",
    supported: true,
    supportsSpot: true,
    supportsFutures: true,
    supportsTestnet: true,
    maxLeverage: 125,
    makerFee: 0.0002,
    takerFee: 0.0004,
  },
  {
    id: "bybit",
    name: "Bybit",
    supported: true,
    supportsSpot: true,
    supportsFutures: true,
    supportsTestnet: true,
    maxLeverage: 100,
    makerFee: 0.0002,
    takerFee: 0.00055,
  },
  {
    id: "okx",
    name: "OKX",
    supported: true,
    supportsSpot: true,
    supportsFutures: true,
    supportsTestnet: true,
    maxLeverage: 125,
    makerFee: 0.0002,
    takerFee: 0.0005,
  },
  {
    id: "bitget",
    name: "Bitget",
    supported: true,
    supportsSpot: true,
    supportsFutures: true,
    supportsTestnet: false,
    maxLeverage: 125,
    makerFee: 0.0002,
    takerFee: 0.0006,
  },
  {
    id: "bingx",
    name: "BingX",
    supported: true,
    supportsSpot: true,
    supportsFutures: true,
    supportsTestnet: false,
    maxLeverage: 150,
    makerFee: 0.0002,
    takerFee: 0.0005,
  },
  {
    id: "kucoin",
    name: "KuCoin",
    supported: true,
    supportsSpot: true,
    supportsFutures: true,
    supportsTestnet: false,
    maxLeverage: 100,
    makerFee: 0.0002,
    takerFee: 0.0006,
  },
  {
    id: "hyperliquid",
    name: "HyperLiquid",
    supported: true,
    supportsSpot: false,
    supportsFutures: true,
    supportsTestnet: false,
    maxLeverage: 50,
    makerFee: 0.0001,
    takerFee: 0.0003,
  },
] as const;

export const getExchangeById = (id: string): ExchangeInfo | undefined => {
  return SUPPORTED_EXCHANGES.find(e => e.id === id);
};

export const getSupportedExchangeIds = (): string[] => {
  return SUPPORTED_EXCHANGES.filter(e => e.supported).map(e => e.id);
};
```

### 5.2. Shared Bot Types

```typescript
// src/lib/types/bot-types.ts
export interface BaseBot {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  symbol: string;
  exchangeId: string;
  accountId: string;
  status: "STOPPED" | "RUNNING" | "PAUSED" | "ERROR";
  createdAt: Date;
  updatedAt: Date;
}

export interface BotPerformance {
  totalProfit: number;
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  winRate: number;
  maxDrawdown: number;
  sharpeRatio?: number;
}

export interface BotRiskConfig {
  maxPositionSize: number;
  maxDailyLoss: number;
  maxDrawdown: number;
  stopLossPercent: number;
  takeProfitPercent: number;
}

// Re-export from components
export { EXCHANGES } from "@/lib/constants/exchanges";
```

### 5.3. Shared Formatters

```typescript
// src/lib/utils/formatters.ts
export const formatCurrency = (value: number, currency: string = "USD"): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

export const formatPercent = (value: number, decimals: number = 2): string => {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
};

export const formatNumber = (value: number, decimals: number = 2): string => {
  if (Math.abs(value) >= 1e9) {
    return `${(value / 1e9).toFixed(decimals)}B`;
  }
  if (Math.abs(value) >= 1e6) {
    return `${(value / 1e6).toFixed(decimals)}M`;
  }
  if (Math.abs(value) >= 1e3) {
    return `${(value / 1e3).toFixed(decimals)}K`;
  }
  return value.toFixed(decimals);
};

export const formatPrice = (price: number, symbol?: string): string => {
  // Determine decimals based on price magnitude
  let decimals = 2;
  if (price < 1) decimals = 6;
  else if (price < 10) decimals = 4;
  else if (price < 1000) decimals = 2;
  
  return `$${price.toFixed(decimals)}`;
};

export const formatTimeAgo = (date: Date | string): string => {
  const now = new Date();
  const then = new Date(date);
  const diff = now.getTime() - then.getTime();
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
};
```

---

## 6. БЕЗОПАСНОСТЬ

### 6.1. API Key Encryption

```typescript
// src/lib/encryption/api-key-encryption.ts
import crypto from "crypto";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export interface EncryptedCredentials {
  encryptedData: string;
  iv: string;
  authTag: string;
  version: number;
}

export interface ApiCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
}

export class ApiKeyEncryption {
  private masterKey: Buffer;

  constructor(masterKey?: string) {
    // In production, get from environment variable
    const key = masterKey || process.env.ENCRYPTION_MASTER_KEY;
    if (!key) {
      throw new Error("Encryption master key not configured");
    }
    
    // Derive 32-byte key from master key
    this.masterKey = crypto.scryptSync(key, "salt", KEY_LENGTH);
  }

  encrypt(credentials: ApiCredentials): EncryptedCredentials {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, this.masterKey, iv);
    
    const data = JSON.stringify(credentials);
    let encrypted = cipher.update(data, "utf8", "hex");
    encrypted += cipher.final("hex");
    
    const authTag = cipher.getAuthTag();
    
    return {
      encryptedData: encrypted,
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
      version: 1,
    };
  }

  decrypt(encrypted: EncryptedCredentials): ApiCredentials {
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      this.masterKey,
      Buffer.from(encrypted.iv, "hex")
    );
    
    decipher.setAuthTag(Buffer.from(encrypted.authTag, "hex"));
    
    let decrypted = decipher.update(encrypted.encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");
    
    return JSON.parse(decrypted);
  }

  // Generate a new master key (for initial setup)
  static generateMasterKey(): string {
    return crypto.randomBytes(32).toString("hex");
  }
}
```

### 6.2. Rate Limiter

```typescript
// src/lib/rate-limit/rate-limiter.ts
import { Redis } from "ioredis";

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export class RateLimiter {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }

  async checkLimit(key: string, config: RateLimitConfig): Promise<{ allowed: boolean; remaining: number }> {
    const now = Date.now();
    const windowStart = now - config.windowMs;
    
    // Remove old entries
    await this.redis.zremrangebyscore(key, 0, windowStart);
    
    // Count current requests
    const currentCount = await this.redis.zcard(key);
    
    if (currentCount >= config.maxRequests) {
      return { allowed: false, remaining: 0 };
    }
    
    // Add current request
    await this.redis.zadd(key, now, `${now}-${Math.random()}`);
    await this.redis.pexpire(key, config.windowMs);
    
    return { 
      allowed: true, 
      remaining: config.maxRequests - currentCount - 1 
    };
  }
}

// Exchange-specific rate limits
export const EXCHANGE_RATE_LIMITS: Record<string, RateLimitConfig> = {
  binance: { windowMs: 60000, maxRequests: 1200 }, // 1200 requests per minute
  bybit: { windowMs: 60000, maxRequests: 120 },
  okx: { windowMs: 60000, maxRequests: 100 },
};
```

---

## 7. ОБРАБОТКА ОШИБОК

### 7.1. Custom Error Classes

```typescript
// src/lib/errors/trading-errors.ts
export class TradingError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = false,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "TradingError";
  }
}

export class InsufficientBalanceError extends TradingError {
  constructor(asset: string, required: number, available: number) {
    super(
      `Insufficient ${asset} balance. Required: ${required}, Available: ${available}`,
      "INSUFFICIENT_BALANCE",
      false,
      false
    );
    this.name = "InsufficientBalanceError";
  }
}

export class OrderRejectedError extends TradingError {
  constructor(message: string, public exchangeCode?: number) {
    super(message, "ORDER_REJECTED", false, true);
    this.name = "OrderRejectedError";
  }
}

export class ExchangeConnectionError extends TradingError {
  constructor(exchange: string, message: string) {
    super(
      `Failed to connect to ${exchange}: ${message}`,
      "EXCHANGE_CONNECTION_ERROR",
      true,
      true
    );
    this.name = "ExchangeConnectionError";
  }
}

export class RateLimitError extends TradingError {
  constructor(public retryAfter: number) {
    super(
      `Rate limit exceeded. Retry after ${retryAfter}ms`,
      "RATE_LIMIT_EXCEEDED",
      true,
      true
    );
    this.name = "RateLimitError";
  }
}

export class SignalParseError extends TradingError {
  constructor(message: string) {
    super(message, "SIGNAL_PARSE_ERROR", false, false);
    this.name = "SignalParseError";
  }
}
```

### 7.2. Error Handler Middleware

```typescript
// src/lib/errors/error-handler.ts
import { NextResponse } from "next/server";
import { TradingError, RateLimitError } from "./trading-errors";

interface ErrorResponse {
  success: false;
  error: {
    message: string;
    code: string;
    recoverable: boolean;
    retryable: boolean;
  };
  retryAfter?: number;
}

export function handleApiError(error: unknown): NextResponse<ErrorResponse> {
  if (error instanceof TradingError) {
    const response: ErrorResponse = {
      success: false,
      error: {
        message: error.message,
        code: error.code,
        recoverable: error.recoverable,
        retryable: error.retryable,
      },
    };

    if (error instanceof RateLimitError) {
      response.retryAfter = error.retryAfter;
      return NextResponse.json(response, { 
        status: 429,
        headers: { "Retry-After": String(Math.ceil(error.retryAfter / 1000)) }
      });
    }

    const statusCode = error.recoverable ? 400 : 500;
    return NextResponse.json(response, { status: statusCode });
  }

  // Unknown error
  console.error("[ErrorHandler] Unhandled error:", error);
  
  return NextResponse.json(
    {
      success: false,
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
        code: "UNKNOWN_ERROR",
        recoverable: false,
        retryable: false,
      },
    },
    { status: 500 }
  );
}

// Usage in API routes
export async function withErrorHandler<T>(
  handler: () => Promise<T>
): Promise<NextResponse<T | ErrorResponse>> {
  try {
    const result = await handler();
    return NextResponse.json(result as T);
  } catch (error) {
    return handleApiError(error);
  }
}
```

---

## 8. ТЕСТИРОВАНИЕ

### 8.1. Unit Tests for Cornix Parser

```typescript
// src/lib/signal-parsing/__tests__/cornix-parser.test.ts
import { describe, it, expect } from "vitest";
import { CornixSignalParser } from "../cornix-parser";

describe("CornixSignalParser", () => {
  const parser = new CornixSignalParser();

  it("should parse basic LONG signal", () => {
    const message = `
#BTCUSDT
#LONG
Entry: 67000-67500
Take-Profit: 69000
Stop-Loss: 66000
Leverage: 10x
    `.trim();

    const result = parser.parse(message);

    expect(result).not.toBeNull();
    expect(result?.symbol).toBe("BTCUSDT");
    expect(result?.direction).toBe("LONG");
    expect(result?.entries.type).toBe("range");
    expect(result?.entries.values).toEqual([67000, 67500]);
    expect(result?.takeProfits).toHaveLength(1);
    expect(result?.takeProfits[0].price).toBe(69000);
    expect(result?.stopLoss).toBe(66000);
    expect(result?.leverage).toBe(10);
  });

  it("should parse SHORT signal with multiple TPs", () => {
    const message = `
#ETHUSDT
#SHORT
Entry: 3500
Take-Profit: 3400, 3300, 3200
Stop-Loss: 3600
    `.trim();

    const result = parser.parse(message);

    expect(result?.direction).toBe("SHORT");
    expect(result?.entries.type).toBe("single");
    expect(result?.takeProfits).toHaveLength(3);
    expect(result?.takeProfits.map(tp => tp.price)).toEqual([3400, 3300, 3200]);
  });

  it("should return null for invalid signal", () => {
    const message = "This is not a trading signal";
    const result = parser.parse(message);
    expect(result).toBeNull();
  });
});
```

### 8.2. Integration Tests for Exchange Adapter

```typescript
// src/lib/exchange/__tests__/binance-adapter.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { BinanceAdapter } from "../adapters/binance-adapter";

describe("BinanceAdapter (Testnet)", () => {
  let adapter: BinanceAdapter;

  beforeAll(async () => {
    adapter = new BinanceAdapter();
    await adapter.connect(
      {
        apiKey: process.env.BINANCE_TESTNET_API_KEY!,
        apiSecret: process.env.BINANCE_TESTNET_API_SECRET!,
      },
      true // testnet
    );
  });

  it("should get balance", async () => {
    const balances = await adapter.getBalance();
    expect(Array.isArray(balances)).toBe(true);
  });

  it("should place and cancel order", async () => {
    const order = await adapter.placeOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: 0.001,
      price: 50000,
      timeInForce: "GTC",
    });

    expect(order.orderId).toBeDefined();
    expect(order.status).toBe("NEW");

    const cancelled = await adapter.cancelOrder(order.orderId, "BTCUSDT");
    expect(cancelled).toBe(true);
  });
});
```

---

## 9. ПОШАГОВЫЙ ПЛАН ВНЕДРЕНИЯ

### Неделя 1: Инфраструктура и Безопасность

- [ ] Добавить `ENCRYPTION_MASTER_KEY` в environment variables
- [ ] Реализовать `ApiKeyEncryption` класс
- [ ] Создать shared constants (`exchanges.ts`, `formatters.ts`)
- [ ] Реализовать `ExchangeAdapter` pattern
- [ ] Создать `BinanceAdapter` (testnet first)
- [ ] Добавить `RateLimiter`
- [ ] Реализовать custom error classes

### Неделя 2: Интеграция с биржами

- [ ] Реализовать `BybitAdapter`
- [ ] Реализовать `OKXAdapter`
- [ ] Создать `ExchangeManager` singleton
- [ ] Обновить API routes для использования adapters
- [ ] Добавить endpoint для подключения биржи
- [ ] Реализовать хранение зашифрованных API ключей
- [ ] Добавить WebSocket для real-time данных

### Неделя 3: Cornix-совместимость

- [ ] Реализовать `CornixSignalParser`
- [ ] Добавить все параметры Cornix в `BotConfig`
- [ ] Создать UI для настройки Cornix-параметров
- [ ] Реализовать парсинг сигналов из Telegram
- [ ] Добавить шаблоны сигналов Cornix
- [ ] Создать документацию по формату
- [ ] Добавить тесты для парсера

### Неделя 4: ML Service

- [ ] Реализовать `FeatureEngineer`
- [ ] Создать `OHLCVDataPipeline`
- [ ] Обновить `PricePredictorModel` для production
- [ ] Добавить скрипт загрузки предобученных весов
- [ ] Настроить data pipeline
- [ ] Добавить monitoring и logging
- [ ] Создать API для predictions

### Неделя 5: Рефакторинг и Тестирование

- [ ] Устранить все дубликаты (EXCHANGES массивы)
- [ ] Обновить все bot components для использования shared constants
- [ ] Добавить unit тесты
- [ ] Добавить integration тесты
- [ ] Настроить CI/CD pipeline
- [ ] Добавить code coverage reporting
- [ ] Провести code review

### Неделя 6: Production Deployment

- [ ] Настроить production environment
- [ ] Добавить monitoring (Sentry, DataDog)
- [ ] Настроить alerting
- [ ] Создать runbook
- [ ] Провести load testing
- [ ] Добавить rate limiting на API
- [ ] Настроить backups

---

## ПРИЛОЖЕНИЯ

### A. Environment Variables

```bash
# Required
DATABASE_URL="file:./dev.db"
ENCRYPTION_MASTER_KEY="your-64-char-hex-key"
NEXTAUTH_SECRET="your-nextauth-secret"
NEXTAUTH_URL="http://localhost:3000"

# Exchange API Keys (for testing)
BINANCE_TESTNET_API_KEY=""
BINANCE_TESTNET_API_SECRET=""
BINANCE_API_KEY=""
BINANCE_API_SECRET=""

# ML Service
ML_SERVICE_URL="http://localhost:3006"
MODEL_PATH="./models"

# Redis (for rate limiting)
REDIS_URL="redis://localhost:6379"

# Telegram
TELEGRAM_BOT_TOKEN=""
TELEGRAM_WEBHOOK_URL=""
```

### B. Package.json Scripts

```json
{
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start",
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "test:e2e": "playwright test",
    "lint": "eslint .",
    "type-check": "tsc --noEmit",
    "db:push": "prisma db push",
    "db:generate": "prisma generate",
    "db:studio": "prisma studio",
    "ml:start": "cd mini-services/ml-service && python main.py",
    "setup:encryption": "node scripts/generate-encryption-key.js"
  }
}
```

### C. Docker Compose для Development

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=file:./dev.db
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
      - ml-service

  ml-service:
    build: ./mini-services/ml-service
    ports:
      - "3006:3006"
    volumes:
      - ./models:/app/models

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

---

*Решения подготовлены: Kimi AI*
*Дата: 11 марта 2026*
*Версия: 1.0*
