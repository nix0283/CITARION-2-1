/**
 * Exchange Price Fetcher
 * 
 * Fetches real-time prices from multiple exchanges for Paper Trading.
 * Supports: Binance, Bybit, OKX, Bitget, BingX
 * 
 * All exchanges provide public price data without API keys.
 */

export type ExchangeId = "binance" | "bybit" | "okx" | "bitget" | "bingx";

export interface PriceData {
  symbol: string;
  exchange: ExchangeId;
  price: number;
  bid?: number;
  ask?: number;
  high24h?: number;
  low24h?: number;
  volume24h?: number;
  timestamp: number;
}

/**
 * Exchange API endpoints for public price data
 */
const EXCHANGE_PRICE_URLS: Record<ExchangeId, (symbol: string) => string> = {
  binance: (symbol) => `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`,
  bybit: (symbol) => `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`,
  okx: (symbol) => `https://www.okx.com/api/v5/market/ticker?instId=${symbol}`,
  bitget: (symbol) => `https://api.bitget.com/api/v2/mix/market/ticker?symbol=${symbol}&productType=umcbl`,
  bingx: (symbol) => `https://open-api.bingx.com/openApi/swap/v2/quote/ticker?symbol=${symbol}`,
};

/**
 * Symbol formatters for each exchange
 */
const formatSymbolForExchange = (symbol: string, exchange: ExchangeId): string => {
  const normalized = symbol.toUpperCase().replace(/[-_]/g, "");
  
  switch (exchange) {
    case "okx":
      // OKX uses BTC-USDT-SWAP format for perpetuals
      if (normalized.endsWith("USDT")) {
        const base = normalized.replace("USDT", "");
        return `${base}-USDT-SWAP`;
      }
      return normalized;
    
    case "bitget":
      // Bitget uses BTCUSDT format
      return normalized;
    
    case "bingx":
      // BingX uses BTC-USDT format
      if (normalized.endsWith("USDT")) {
        const base = normalized.replace("USDT", "");
        return `${base}-USDT`;
      }
      return normalized;
    
    default:
      return normalized;
  }
};

/**
 * Parse price response from each exchange
 */
const parsePriceResponse = (exchange: ExchangeId, data: any, symbol: string): PriceData | null => {
  try {
    switch (exchange) {
      case "binance": {
        // Binance returns { symbol: "BTCUSDT", price: "50000.00" }
        if (data.symbol && data.price) {
          return {
            symbol,
            exchange,
            price: parseFloat(data.price),
            timestamp: Date.now(),
          };
        }
        return null;
      }
      
      case "bybit": {
        // Bybit returns { result: { list: [{ lastPrice: "50000.00" }] } }
        const list = data?.result?.list;
        if (list && list.length > 0) {
          const ticker = list[0];
          return {
            symbol,
            exchange,
            price: parseFloat(ticker.lastPrice),
            bid: parseFloat(ticker.bid1Price),
            ask: parseFloat(ticker.ask1Price),
            high24h: parseFloat(ticker.highPrice24h),
            low24h: parseFloat(ticker.lowPrice24h),
            volume24h: parseFloat(ticker.volume24h),
            timestamp: Date.now(),
          };
        }
        return null;
      }
      
      case "okx": {
        // OKX returns { data: [{ last: "50000.00", bidPx: "...", askPx: "..." }] }
        const tickers = data?.data;
        if (tickers && tickers.length > 0) {
          const ticker = tickers[0];
          return {
            symbol,
            exchange,
            price: parseFloat(ticker.last),
            bid: parseFloat(ticker.bidPx),
            ask: parseFloat(ticker.askPx),
            high24h: parseFloat(ticker.high24h),
            low24h: parseFloat(ticker.low24h),
            volume24h: parseFloat(ticker.vol24h),
            timestamp: Date.now(),
          };
        }
        return null;
      }
      
      case "bitget": {
        // Bitget returns { data: { list: [{ lastPr: "50000.00" }] } }
        const list = data?.data?.list;
        if (list && list.length > 0) {
          const ticker = list[0];
          return {
            symbol,
            exchange,
            price: parseFloat(ticker.lastPr),
            bid: parseFloat(ticker.bidPr),
            ask: parseFloat(ticker.askPr),
            high24h: parseFloat(ticker.high24h),
            low24h: parseFloat(ticker.low24h),
            volume24h: parseFloat(ticker.baseVolume),
            timestamp: Date.now(),
          };
        }
        return null;
      }
      
      case "bingx": {
        // BingX returns { data: { lastPrice: "50000.00" } }
        const ticker = data?.data;
        if (ticker && ticker.lastPrice) {
          return {
            symbol,
            exchange,
            price: parseFloat(ticker.lastPrice),
            bid: ticker.bidPrice ? parseFloat(ticker.bidPrice) : undefined,
            ask: ticker.askPrice ? parseFloat(ticker.askPrice) : undefined,
            high24h: ticker.highPrice ? parseFloat(ticker.highPrice) : undefined,
            low24h: ticker.lowPrice ? parseFloat(ticker.lowPrice) : undefined,
            volume24h: ticker.volume ? parseFloat(ticker.volume) : undefined,
            timestamp: Date.now(),
          };
        }
        return null;
      }
      
      default:
        return null;
    }
  } catch (error) {
    console.error(`[PriceFetcher] Error parsing ${exchange} response:`, error);
    return null;
  }
};

/**
 * Fetch price from a specific exchange
 */
export async function fetchPriceFromExchange(
  symbol: string,
  exchange: ExchangeId
): Promise<PriceData | null> {
  try {
    const formattedSymbol = formatSymbolForExchange(symbol, exchange);
    const url = EXCHANGE_PRICE_URLS[exchange](formattedSymbol);
    
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      // Cache for 1 second
      next: { revalidate: 1 },
    });
    
    if (!response.ok) {
      console.error(`[PriceFetcher] ${exchange} returned ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    return parsePriceResponse(exchange, data, symbol);
  } catch (error) {
    console.error(`[PriceFetcher] Error fetching from ${exchange}:`, error);
    return null;
  }
}

/**
 * Fetch price from multiple exchanges (fallback chain)
 * Tries exchanges in order until one succeeds
 */
export async function fetchPriceWithFallback(
  symbol: string,
  preferredExchange?: ExchangeId
): Promise<PriceData | null> {
  // Order of preference
  const exchanges: ExchangeId[] = preferredExchange
    ? [preferredExchange, "binance", "bybit", "okx", "bitget", "bingx"]
    : ["binance", "bybit", "okx", "bitget", "bingx"];
  
  // Remove duplicates
  const uniqueExchanges = [...new Set(exchanges)];
  
  for (const exchange of uniqueExchanges) {
    const price = await fetchPriceFromExchange(symbol, exchange);
    if (price) {
      return price;
    }
  }
  
  return null;
}

/**
 * Fetch prices for multiple symbols from an exchange
 */
export async function fetchMultiplePrices(
  symbols: string[],
  exchange: ExchangeId = "binance"
): Promise<Map<string, PriceData>> {
  const results = new Map<string, PriceData>();
  
  // Fetch in parallel with Promise.all
  const promises = symbols.map(async (symbol) => {
    const price = await fetchPriceFromExchange(symbol, exchange);
    if (price) {
      results.set(symbol, price);
    }
  });
  
  await Promise.all(promises);
  
  return results;
}

/**
 * Get cached price from our database (faster for repeated requests)
 */
export async function getCachedPrice(symbol: string): Promise<number | null> {
  try {
    // Import db only when needed
    const { db } = await import("@/lib/db");
    
    const marketPrice = await db.marketPrice.findUnique({
      where: { symbol },
    });
    
    if (marketPrice) {
      return marketPrice.price;
    }
    
    return null;
  } catch (error) {
    console.error("[PriceFetcher] Error getting cached price:", error);
    return null;
  }
}

/**
 * Update cached price in database
 */
export async function updateCachedPrice(
  symbol: string,
  price: number,
  exchange: string = "BINANCE"
): Promise<void> {
  try {
    const { db } = await import("@/lib/db");
    
    await db.marketPrice.upsert({
      where: { symbol },
      update: {
        price,
        lastUpdate: new Date(),
      },
      create: {
        symbol,
        exchange,
        price,
        lastUpdate: new Date(),
      },
    });
  } catch (error) {
    console.error("[PriceFetcher] Error updating cached price:", error);
  }
}

/**
 * Price fetcher class for continuous updates
 */
export class PriceFetcher {
  private symbol: string;
  private exchange: ExchangeId;
  private currentPrice: number = 0;
  private lastUpdate: number = 0;
  private updateInterval: NodeJS.Timeout | null = null;
  private listeners: ((price: PriceData) => void)[] = [];
  
  constructor(symbol: string, exchange: ExchangeId = "binance") {
    this.symbol = symbol;
    this.exchange = exchange;
  }
  
  async start(intervalMs: number = 3000): Promise<void> {
    // Initial fetch
    await this.fetch();
    
    // Start interval
    this.updateInterval = setInterval(async () => {
      await this.fetch();
    }, intervalMs);
  }
  
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.listeners = [];
  }
  
  private async fetch(): Promise<void> {
    const priceData = await fetchPriceFromExchange(this.symbol, this.exchange);
    
    if (priceData) {
      this.currentPrice = priceData.price;
      this.lastUpdate = priceData.timestamp;
      
      // Notify listeners
      for (const listener of this.listeners) {
        listener(priceData);
      }
    }
  }
  
  getPrice(): number {
    return this.currentPrice;
  }
  
  subscribe(callback: (price: PriceData) => void): () => void {
    this.listeners.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }
}

export default {
  fetchPriceFromExchange,
  fetchPriceWithFallback,
  fetchMultiplePrices,
  getCachedPrice,
  updateCachedPrice,
  PriceFetcher,
};
