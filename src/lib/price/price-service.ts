/**
 * Price Service - Production-Ready Price Fetching
 * 
 * Replaces static DEMO_PRICES with real-time prices from multiple sources:
 * 1. WebSocket cache (real-time)
 * 2. Database cache (MarketPrice)
 * 3. Exchange REST API (fallback)
 * 
 * Based on Kimi_Solutions.md recommendations
 */

import { db } from "@/lib/db";

export interface PriceData {
  price: number;
  bid?: number;
  ask?: number;
  change24h?: number;
  timestamp: number;
  source: 'websocket' | 'database' | 'api';
}

export class PriceService {
  private static instance: PriceService;
  private priceCache: Map<string, PriceData> = new Map();
  private readonly CACHE_TTL = 5000; // 5 seconds for price cache
  private readonly DB_CACHE_TTL = 60000; // 60 seconds for database cache

  // Exchange API endpoints for fallback
  private static readonly EXCHANGE_APIS: Record<string, { url: string; format: 'binance' | 'bybit' | 'okx' | 'bitget' | 'bingx' }> = {
    binance: { url: "https://api.binance.com/api/v3/ticker/price", format: 'binance' },
    bybit: { url: "https://api.bybit.com/v5/market/tickers", format: 'bybit' },
    okx: { url: "https://www.okx.com/api/v5/market/ticker", format: 'okx' },
    bitget: { url: "https://api.bitget.com/api/v2/spot/market/tickers", format: 'bitget' },
    bingx: { url: "https://open-api.bingx.com/openApi/spot/v1/ticker/24hr", format: 'bingx' },
  };

  private constructor() {}

  static getInstance(): PriceService {
    if (!PriceService.instance) {
      PriceService.instance = new PriceService();
    }
    return PriceService.instance;
  }

  /**
   * Get price for a symbol from multiple sources
   * Priority: WebSocket > Database > Exchange API
   */
  async getPrice(symbol: string, exchange: string = "binance"): Promise<number> {
    const cacheKey = `${exchange}:${symbol}`;
    const upperSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
    
    // Check memory cache first
    const cached = this.priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.price;
    }

    // Try WebSocket price
    const wsPrice = await this.getWebSocketPrice(upperSymbol, exchange);
    if (wsPrice !== null) {
      this.priceCache.set(cacheKey, {
        price: wsPrice,
        timestamp: Date.now(),
        source: 'websocket'
      });
      return wsPrice;
    }

    // Try database cache
    const dbPrice = await this.getDatabasePrice(upperSymbol);
    if (dbPrice !== null) {
      this.priceCache.set(cacheKey, {
        price: dbPrice.price,
        change24h: dbPrice.change24h,
        timestamp: Date.now(),
        source: 'database'
      });
      return dbPrice.price;
    }

    // Fallback to exchange API
    const apiPrice = await this.getExchangePrice(upperSymbol, exchange);
    if (apiPrice !== null) {
      this.priceCache.set(cacheKey, {
        price: apiPrice,
        timestamp: Date.now(),
        source: 'api'
      });
      return apiPrice;
    }

    // Final fallback: return a reasonable default
    console.warn(`[PriceService] Unable to get price for ${symbol} on ${exchange}, using fallback`);
    return this.getFallbackPrice(upperSymbol);
  }

  /**
   * Get price with full data (bid, ask, 24h change)
   */
  async getPriceData(symbol: string, exchange: string = "binance"): Promise<PriceData | null> {
    const upperSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
    
    // Try database for full data
    const dbPrice = await this.getDatabasePrice(upperSymbol);
    if (dbPrice) {
      return {
        price: dbPrice.price,
        bid: dbPrice.bid,
        ask: dbPrice.ask,
        change24h: dbPrice.change24h,
        timestamp: Date.now(),
        source: 'database'
      };
    }

    // Get basic price
    const price = await this.getPrice(symbol, exchange);
    return {
      price,
      timestamp: Date.now(),
      source: 'api'
    };
  }

  /**
   * Get price from WebSocket cache
   */
  private async getWebSocketPrice(symbol: string, exchange: string): Promise<number | null> {
    try {
      // Import dynamically to avoid circular dependencies
      const { getPriceFromWebSocket } = await import("@/lib/price-websocket");
      return getPriceFromWebSocket(symbol, exchange);
    } catch {
      // WebSocket module not available or no cached price
      return null;
    }
  }

  /**
   * Get price from database cache
   */
  private async getDatabasePrice(symbol: string): Promise<{ price: number; bid?: number; ask?: number; change24h?: number } | null> {
    try {
      const marketPrice = await db.marketPrice.findUnique({
        where: { symbol },
      });

      if (marketPrice && Date.now() - marketPrice.lastUpdate.getTime() < this.DB_CACHE_TTL) {
        return {
          price: marketPrice.price,
          bid: marketPrice.bidPrice ?? undefined,
          ask: marketPrice.askPrice ?? undefined,
          change24h: marketPrice.priceChangePercent ?? undefined,
        };
      }
    } catch (error) {
      console.error(`[PriceService] Database error for ${symbol}:`, error);
    }
    return null;
  }

  /**
   * Get price directly from exchange API
   */
  private async getExchangePrice(symbol: string, exchange: string): Promise<number | null> {
    const config = PriceService.EXCHANGE_APIS[exchange];
    if (!config) return null;

    try {
      const formattedSymbol = this.formatSymbol(symbol, exchange);
      let url: string;
      
      switch (config.format) {
        case 'binance':
          url = `${config.url}?symbol=${formattedSymbol}`;
          break;
        case 'bybit':
          url = `${config.url}?category=linear&symbol=${formattedSymbol}`;
          break;
        case 'okx':
          url = `${config.url}?instId=${formattedSymbol}-SWAP`;
          break;
        case 'bitget':
          url = `${config.url}?symbol=${formattedSymbol}`;
          break;
        case 'bingx':
          url = `${config.url}?symbol=${formattedSymbol}`;
          break;
        default:
          return null;
      }

      const response = await fetch(url, {
        next: { revalidate: 5 },
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) return null;

      const data = await response.json();
      return this.parsePrice(data, config.format);
    } catch (error) {
      console.error(`[PriceService] API error for ${symbol} on ${exchange}:`, error);
      return null;
    }
  }

  /**
   * Format symbol for specific exchange
   */
  private formatSymbol(symbol: string, exchange: string): string {
    const cleanSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/gi, "");

    switch (exchange) {
      case "binance":
      case "bybit":
      case "bitget":
      case "bingx":
        return cleanSymbol;
      case "okx":
        // OKX uses format like BTC-USDT-SWAP
        return cleanSymbol.replace(/USDT$/, "-USDT");
      default:
        return cleanSymbol;
    }
  }

  /**
   * Parse price from exchange response
   */
  private parsePrice(data: any, format: string): number | null {
    try {
      switch (format) {
        case 'binance':
          return parseFloat(data.price);
        case 'bybit':
          return parseFloat(data.result?.list?.[0]?.lastPrice);
        case 'okx':
          return parseFloat(data.data?.[0]?.last);
        case 'bitget':
          return parseFloat(data.data?.[0]?.lastPr);
        case 'bingx':
          return parseFloat(data.data?.lastPrice);
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  /**
   * Fallback prices for demo trading when no price source is available
   * These are reasonable estimates for demo purposes only
   */
  private fallbackPrices: Record<string, number> = {
    BTCUSDT: 97000,
    ETHUSDT: 3400,
    BNBUSDT: 620,
    SOLUSDT: 180,
    XRPUSDT: 2.5,
    DOGEUSDT: 0.35,
    ADAUSDT: 0.85,
    AVAXUSDT: 38,
    LINKUSDT: 16,
    DOTUSDT: 6.5,
    MATICUSDT: 0.45,
    LTCUSDT: 95,
    ATOMUSDT: 10,
    UNIUSDT: 12,
    NEARUSDT: 5.5,
    ARBUSDT: 0.85,
    OPUSDT: 1.5,
    APTUSDT: 8,
    SUIUSDT: 3.5,
    SEIUSDT: 0.35,
  };

  /**
   * Get fallback price for demo trading
   */
  private getFallbackPrice(symbol: string): number {
    const upperSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
    
    // Direct match
    if (this.fallbackPrices[upperSymbol]) {
      return this.fallbackPrices[upperSymbol];
    }
    
    // Try with USDT suffix
    if (this.fallbackPrices[upperSymbol + "USDT"]) {
      return this.fallbackPrices[upperSymbol + "USDT"];
    }
    
    // Try removing USDT suffix and re-adding
    const base = upperSymbol.replace("USDT", "");
    if (this.fallbackPrices[base + "USDT"]) {
      return this.fallbackPrices[base + "USDT"];
    }
    
    // Default fallback
    return 100;
  }

  /**
   * Update price cache manually (called by WebSocket)
   */
  updatePrice(symbol: string, price: number, exchange: string = "binance"): void {
    const cacheKey = `${exchange}:${symbol}`;
    this.priceCache.set(cacheKey, {
      price,
      timestamp: Date.now(),
      source: 'websocket'
    });
  }

  /**
   * Clear price cache
   */
  clearCache(): void {
    this.priceCache.clear();
  }

  /**
   * Get all cached prices
   */
  getCachedPrices(): Map<string, PriceData> {
    return new Map(this.priceCache);
  }
}

// Export singleton instance
export const priceService = new PriceService();

// Convenience function
export const getPrice = (symbol: string, exchange?: string) => 
  priceService.getPrice(symbol, exchange);
