/**
 * Cornix Signal Parser
 * 
 * Production-ready parser for Cornix-compatible trading signals.
 * Supports multiple signal formats from Telegram channels and TradingView.
 * 
 * Based on Kimi_Solutions.md recommendations
 * 
 * Supported formats:
 * - Standard Cornix: #BTCUSDT #LONG Entry: 67000-67500 TP: 69000 SL: 66000 Leverage: 10x
 * - TradingView: BUY BTCUSDT @ 67000, TP1: 68500, TP2: 69000, SL: 66000
 * - Simple: BTC/USDT LONG 67000-67500 TP 69000 SL 66000
 */

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
    type: "PERCENTAGE" | "BREAKEVEN" | "MOVING_TARGET";
    value: number;
    triggerPrice?: number;
  };
  comment?: string;
  sourceChannel?: string;
  messageId?: number;
  timestamp: Date;
}

export interface ParseResult {
  success: boolean;
  signal?: CornixSignal;
  error?: string;
  warnings?: string[];
}

export class CornixSignalParser {
  // Regex patterns for different signal components
  private static readonly PATTERNS = {
    // Symbol patterns - must match #SYMBOL or standalone symbol
    SYMBOL_HASHTAG: /#([A-Z][A-Z0-9]{2,}(?:USDT?|BUSD|USD)?)\b/i,
    SYMBOL_SLASH: /\b([A-Z]{2,10})\s*[\/\-]\s*(USDT?|BUSD|USD)\b/i,
    SYMBOL_SIMPLE: /\b([A-Z]{3,10}USDT?)\b/i,
    
    // Direction patterns
    DIRECTION_HASHTAG: /#(LONG|SHORT|BUY|SELL)\b/i,
    DIRECTION_KEYWORD: /\b(LONG|SHORT|BUY|SELL)\b/i,
    
    // Entry patterns
    ENTRY_RANGE: /(?:Entry|Entries?|Buy|Enter|Вход)[\s:]*([\d\s,.\-–]+?)(?=\s*(?:TP|Take|SL|Stop|Leverage|Lever|$))/i,
    ENTRY_RANGE_ALT: /(?:Entry|Entries?|Buy|Enter|Вход)[\s:]*([\d,.\-–]+)\s*-\s*([\d,.\-–]+)/i,
    ENTRY_AT: /@\s*([\d,.]+)/i,
    
    // Take Profit patterns
    TAKE_PROFIT: /(?:TP|Take-?Profit|Take|Target|Тейк)[\s:]*([\d\s,.\-–]+)/gi,
    TP_WITH_PERCENT: /(?:TP|Take-?Profit|Target)(\d+)[\s:]*([\d,.]+)(?:\s*\((\d+)%?\))?/gi,
    
    // Stop Loss patterns
    STOP_LOSS: /(?:SL|Stop-?Loss|Stop|Стоп|СЛ)[\s:]*([\d,.]+)/i,
    
    // Leverage patterns
    LEVERAGE: /(?:Leverage|Lever|Плечо)[\s:]*(\d+)x?\b/i,
    LEVERAGE_SHORT: /(\d+)x(?:\s|$)/i,
    
    // Trailing Stop patterns
    TRAILING_STOP: /(?:Trailing|Трейлинг)[\s:]*([\d.]+)%?\s*(?:after|после)?\s*(\d+)?%?/i,
    
    // Market type detection
    SPOT_KEYWORD: /\b(spot|спот)\b/i,
    FUTURES_KEYWORD: /\b(futures|perp|perpetual|фьючерс)\b/i,
  };

  /**
   * Parse a signal message from any supported format
   */
  parse(message: string, options?: { sourceChannel?: string; messageId?: number }): ParseResult {
    const warnings: string[] = [];
    
    try {
      // Normalize message
      const normalizedMessage = this.normalizeMessage(message);
      
      // Extract symbol
      const symbol = this.extractSymbol(normalizedMessage);
      if (!symbol) {
        return { success: false, error: "Could not extract symbol from signal" };
      }
      
      // Extract direction
      const direction = this.extractDirection(normalizedMessage);
      if (!direction) {
        return { success: false, error: "Could not extract direction from signal" };
      }
      
      // Extract entries
      const entries = this.extractEntries(normalizedMessage);
      if (!entries || entries.values.length === 0) {
        return { success: false, error: "Could not extract entry prices from signal" };
      }
      
      // Extract take profits
      const takeProfits = this.extractTakeProfits(normalizedMessage);
      if (takeProfits.length === 0) {
        warnings.push("No take profit targets found");
      }
      
      // Extract stop loss
      const stopLoss = this.extractStopLoss(normalizedMessage);
      if (!stopLoss) {
        warnings.push("No stop loss found - signal may be incomplete");
      }
      
      // Extract leverage
      const leverage = this.extractLeverage(normalizedMessage);
      
      // Extract trailing stop
      const trailingStop = this.extractTrailingStop(normalizedMessage);
      
      // Detect market type
      const marketType = this.detectMarketType(normalizedMessage);
      
      // Extract comment
      const comment = this.extractComment(normalizedMessage);
      
      const signal: CornixSignal = {
        symbol,
        direction,
        entries,
        takeProfits,
        stopLoss: stopLoss || 0,
        leverage,
        marketType,
        trailingStop,
        comment,
        sourceChannel: options?.sourceChannel,
        messageId: options?.messageId,
        timestamp: new Date(),
      };
      
      // Validate signal
      const validation = this.validateSignal(signal);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }
      
      return {
        success: true,
        signal,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown parsing error",
      };
    }
  }

  /**
   * Normalize message for consistent parsing
   */
  private normalizeMessage(message: string): string {
    return message
      .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ") // Replace various spaces
      .replace(/[-–—]/g, "-") // Normalize dashes
      .replace(/\r\n/g, "\n") // Normalize line breaks
      .trim();
  }

  /**
   * Extract symbol from message
   */
  private extractSymbol(message: string): string | null {
    // Try hashtag format first (#BTCUSDT)
    const hashtagMatch = message.match(CornixSignalParser.PATTERNS.SYMBOL_HASHTAG);
    if (hashtagMatch) {
      return this.normalizeSymbol(hashtagMatch[1]);
    }
    
    // Try slash format (BTC/USDT)
    const slashMatch = message.match(CornixSignalParser.PATTERNS.SYMBOL_SLASH);
    if (slashMatch) {
      return this.normalizeSymbol(slashMatch[1] + slashMatch[2]);
    }
    
    // Try simple format (BTCUSDT)
    const simpleMatch = message.match(CornixSignalParser.PATTERNS.SYMBOL_SIMPLE);
    if (simpleMatch && !this.isDirectionKeyword(simpleMatch[1])) {
      return this.normalizeSymbol(simpleMatch[1]);
    }
    
    return null;
  }

  /**
   * Normalize symbol to standard format (e.g., BTCUSDT)
   */
  private normalizeSymbol(symbol: string): string {
    const upper = symbol.toUpperCase();
    
    // Already has USDT
    if (upper.endsWith("USDT") || upper.endsWith("USDT")) {
      return upper;
    }
    
    // Has USD but not USDT
    if (upper.endsWith("USD") && !upper.endsWith("USDT")) {
      return upper + "T";
    }
    
    // Has BUSD
    if (upper.endsWith("BUSD")) {
      return upper;
    }
    
    // No quote currency - add USDT
    return upper + "USDT";
  }

  /**
   * Check if word is a direction keyword
   */
  private isDirectionKeyword(word: string): boolean {
    const keywords = ["LONG", "SHORT", "BUY", "SELL"];
    return keywords.includes(word.toUpperCase());
  }

  /**
   * Extract direction from message
   */
  private extractDirection(message: string): "LONG" | "SHORT" | null {
    // Try hashtag format first
    const hashtagMatch = message.match(CornixSignalParser.PATTERNS.DIRECTION_HASHTAG);
    if (hashtagMatch) {
      const dir = hashtagMatch[1].toUpperCase();
      return dir === "BUY" ? "LONG" : dir === "SELL" ? "SHORT" : dir as "LONG" | "SHORT";
    }
    
    // Try keyword format
    const keywordMatch = message.match(CornixSignalParser.PATTERNS.DIRECTION_KEYWORD);
    if (keywordMatch) {
      const dir = keywordMatch[1].toUpperCase();
      return dir === "BUY" ? "LONG" : dir === "SELL" ? "SHORT" : dir as "LONG" | "SHORT";
    }
    
    return null;
  }

  /**
   * Extract entry prices from message
   */
  private extractEntries(message: string): CornixSignal["entries"] | null {
    // Try range format with explicit markers
    const rangeAltMatch = message.match(CornixSignalParser.PATTERNS.ENTRY_RANGE_ALT);
    if (rangeAltMatch) {
      const min = this.parsePrice(rangeAltMatch[1]);
      const max = this.parsePrice(rangeAltMatch[2]);
      if (min && max) {
        return { type: "range", values: [Math.min(min, max), Math.max(min, max)] };
      }
    }
    
    // Try standard entry format
    const entryMatch = message.match(CornixSignalParser.PATTERNS.ENTRY_RANGE);
    if (entryMatch) {
      const valueStr = entryMatch[1].trim();
      
      // Check for range (e.g., "67000-67500")
      if (valueStr.includes("-")) {
        const parts = valueStr.split("-").map(p => this.parsePrice(p.trim()));
        const validParts = parts.filter((p): p is number => p !== null);
        if (validParts.length >= 2) {
          return { type: "range", values: [Math.min(...validParts), Math.max(...validParts)] };
        }
      }
      
      // Check for multiple entries (comma or space separated)
      const values = valueStr
        .split(/[,\s]+/)
        .map(p => this.parsePrice(p.trim().replace(/,/g, "")))
        .filter((p): p is number => p !== null);
      
      if (values.length === 1) {
        return { type: "single", values };
      } else if (values.length > 1) {
        return { type: "multiple", values };
      }
    }
    
    // Try @ format (Entry @ 67000)
    const atMatch = message.match(CornixSignalParser.PATTERNS.ENTRY_AT);
    if (atMatch) {
      const price = this.parsePrice(atMatch[1]);
      if (price) {
        return { type: "single", values: [price] };
      }
    }
    
    return null;
  }

  /**
   * Extract take profit targets from message
   */
  private extractTakeProfits(message: string): CornixSignal["takeProfits"] {
    const results: CornixSignal["takeProfits"] = [];
    
    // Try TP with percentages (TP1: 69000 (50%))
    const tpWithPercentMatches = message.matchAll(CornixSignalParser.PATTERNS.TP_WITH_PERCENT);
    for (const match of tpWithPercentMatches) {
      const tpNum = parseInt(match[1]);
      const price = this.parsePrice(match[2]);
      const percentage = match[3] ? parseInt(match[3]) : undefined;
      
      if (price) {
        results.push({ price, percentage });
      }
    }
    
    // If no TP with percentages found, try standard format
    if (results.length === 0) {
      const tpMatches = message.matchAll(CornixSignalParser.PATTERNS.TAKE_PROFIT);
      for (const match of tpMatches) {
        const prices = match[1]
          .split(/[,\s]+/)
          .map(p => this.parsePrice(p.trim().replace(/,/g, "")))
          .filter((p): p is number => p !== null);
        
        prices.forEach(price => results.push({ price }));
      }
    }
    
    // Sort by price (ascending for longs, will be adjusted by handler)
    return results.sort((a, b) => a.price - b.price);
  }

  /**
   * Extract stop loss from message
   */
  private extractStopLoss(message: string): number | null {
    const match = message.match(CornixSignalParser.PATTERNS.STOP_LOSS);
    if (match) {
      return this.parsePrice(match[1]);
    }
    return null;
  }

  /**
   * Extract leverage from message
   */
  private extractLeverage(message: string): number | undefined {
    // Try explicit leverage
    const leverageMatch = message.match(CornixSignalParser.PATTERNS.LEVERAGE);
    if (leverageMatch) {
      return parseInt(leverageMatch[1]);
    }
    
    // Try short format (10x)
    const shortMatch = message.match(CornixSignalParser.PATTERNS.LEVERAGE_SHORT);
    if (shortMatch) {
      return parseInt(shortMatch[1]);
    }
    
    return undefined;
  }

  /**
   * Extract trailing stop from message
   */
  private extractTrailingStop(message: string): CornixSignal["trailingStop"] | undefined {
    const match = message.match(CornixSignalParser.PATTERNS.TRAILING_STOP);
    if (!match) return undefined;
    
    return {
      type: "PERCENTAGE",
      value: parseFloat(match[1]),
      triggerPrice: match[2] ? parseFloat(match[2]) : undefined,
    };
  }

  /**
   * Detect market type from message
   */
  private detectMarketType(message: string): "SPOT" | "FUTURES" {
    const lower = message.toLowerCase();
    
    if (CornixSignalParser.PATTERNS.SPOT_KEYWORD.test(lower)) {
      return "SPOT";
    }
    
    if (CornixSignalParser.PATTERNS.FUTURES_KEYWORD.test(lower)) {
      return "FUTURES";
    }
    
    // Default to futures for leverage signals
    return "FUTURES";
  }

  /**
   * Extract comment/notes from message
   */
  private extractComment(message: string): string | undefined {
    const lines = message.split("\n");
    const commentLines = lines.filter(line => {
      const trimmed = line.trim();
      return trimmed && 
        !trimmed.match(/#[A-Z0-9]+/i) &&
        !trimmed.match(/#(LONG|SHORT|BUY|SELL)/i) &&
        !trimmed.match(/(?:Entry|TP|SL|Leverage|Stop|Take)/i) &&
        !trimmed.match(/^[\d\s,.\-–]+$/); // Not just numbers
    });
    
    return commentLines.length > 0 
      ? commentLines.join(" ").trim().slice(0, 500) 
      : undefined;
  }

  /**
   * Parse price string to number
   */
  private parsePrice(priceStr: string): number | null {
    // Remove commas and whitespace
    const cleaned = priceStr.replace(/[,\s]/g, "");
    const price = parseFloat(cleaned);
    
    // Basic validation
    if (isNaN(price) || price <= 0) {
      return null;
    }
    
    return price;
  }

  /**
   * Validate parsed signal
   */
  private validateSignal(signal: CornixSignal): { valid: boolean; error?: string } {
    // Check symbol
    if (!signal.symbol || signal.symbol.length < 3) {
      return { valid: false, error: "Invalid symbol" };
    }
    
    // Check direction
    if (!["LONG", "SHORT"].includes(signal.direction)) {
      return { valid: false, error: "Invalid direction" };
    }
    
    // Check entries
    if (!signal.entries.values.length) {
      return { valid: false, error: "No entry prices provided" };
    }
    
    // For LONG: entries < TP and SL < entries
    // For SHORT: entries > TP and SL > entries
    const avgEntry = signal.entries.values.reduce((a, b) => a + b, 0) / signal.entries.values.length;
    
    if (signal.direction === "LONG") {
      // Validate TP is above entry for longs
      if (signal.takeProfits.length > 0) {
        const invalidTP = signal.takeProfits.find(tp => tp.price <= avgEntry);
        if (invalidTP) {
          return { valid: false, error: `Take profit ${invalidTP.price} must be above entry ${avgEntry} for LONG` };
        }
      }
      
      // Validate SL is below entry for longs
      if (signal.stopLoss && signal.stopLoss >= avgEntry) {
        return { valid: false, error: `Stop loss ${signal.stopLoss} must be below entry ${avgEntry} for LONG` };
      }
    } else {
      // Validate TP is below entry for shorts
      if (signal.takeProfits.length > 0) {
        const invalidTP = signal.takeProfits.find(tp => tp.price >= avgEntry);
        if (invalidTP) {
          return { valid: false, error: `Take profit ${invalidTP.price} must be below entry ${avgEntry} for SHORT` };
        }
      }
      
      // Validate SL is above entry for shorts
      if (signal.stopLoss && signal.stopLoss <= avgEntry) {
        return { valid: false, error: `Stop loss ${signal.stopLoss} must be above entry ${avgEntry} for SHORT` };
      }
    }
    
    // Check leverage range
    if (signal.leverage && (signal.leverage < 1 || signal.leverage > 125)) {
      return { valid: false, error: "Leverage must be between 1 and 125" };
    }
    
    return { valid: true };
  }
}

// Export singleton instance
export const cornixSignalParser = new CornixSignalParser();

// Convenience function
export const parseSignal = (message: string, options?: { sourceChannel?: string; messageId?: number }) => 
  cornixSignalParser.parse(message, options);
