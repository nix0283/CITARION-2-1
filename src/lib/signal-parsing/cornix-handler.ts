/**
 * Cornix Signal Handler
 * 
 * Production-ready handler for processing and executing Cornix signals.
 * Integrates with Exchange Factory for trade execution.
 * 
 * Based on Kimi_Production_Code.md recommendations
 */

import { CornixSignal, CornixSignalParser, ParseResult } from "./cornix-parser";
import { createExchangeClient, BaseExchangeClient } from "@/lib/exchange";
import { db } from "@/lib/db";
import { decryptApiKey } from "@/lib/encryption";
import { priceService } from "@/lib/price/price-service";

export interface SignalExecutionResult {
  success: boolean;
  signalId?: string;
  orderId?: string;
  error?: string;
  warnings?: string[];
  details?: {
    symbol: string;
    direction: string;
    entryPrice: number;
    quantity: number;
    leverage: number;
  };
}

export interface BotConfig {
  id: string;
  userId: string;
  exchangeId: string;
  accountId: string;
  amountPerTrade: number;
  amountType: "FIXED" | "PERCENTAGE";
  leverage: number;
  leverageOverride: boolean;
  maxLeverage: number;
  defaultMarginMode: "ISOLATED" | "CROSSED";
  allowedSymbols?: string[];
  blockedSymbols?: string[];
  isActive: boolean;
}

export class CornixSignalHandler {
  private parser = new CornixSignalParser();

  /**
   * Process and execute a trading signal
   */
  async processSignal(
    message: string,
    userId: string,
    botConfigId?: string,
    options?: { sourceChannel?: string; messageId?: number }
  ): Promise<SignalExecutionResult> {
    try {
      // Parse the signal
      const parseResult = this.parser.parse(message, options);
      
      if (!parseResult.success || !parseResult.signal) {
        return {
          success: false,
          error: parseResult.error || "Failed to parse signal",
        };
      }

      const signal = parseResult.signal;

      // Get bot configuration
      const botConfig = await this.getBotConfig(userId, botConfigId);
      if (!botConfig) {
        return {
          success: false,
          error: "No active bot configuration found",
        };
      }

      // Check symbol restrictions
      const symbolCheck = this.checkSymbolRestrictions(signal.symbol, botConfig);
      if (!symbolCheck.allowed) {
        return {
          success: false,
          error: symbolCheck.reason,
        };
      }

      // Get exchange client
      const exchangeClient = await this.getExchangeClient(botConfig);
      if (!exchangeClient) {
        return {
          success: false,
          error: "Failed to connect to exchange",
        };
      }

      // Calculate position size
      const positionInfo = await this.calculatePositionSize(signal, botConfig, exchangeClient);
      
      // Set leverage
      const leverage = botConfig.leverageOverride 
        ? botConfig.leverage 
        : (signal.leverage || botConfig.leverage);
      
      // Cap leverage at max
      const effectiveLeverage = Math.min(leverage, botConfig.maxLeverage);
      
      await exchangeClient.setLeverage({
        symbol: signal.symbol,
        leverage: effectiveLeverage,
        marginMode: botConfig.defaultMarginMode.toLowerCase() as "isolated" | "cross",
      });

      // Get current price
      const currentPrice = await priceService.getPrice(signal.symbol, botConfig.exchangeId);
      
      // Calculate quantity
      const quantity = (positionInfo.margin * effectiveLeverage) / currentPrice;

      // Place entry order
      const orderResult = await exchangeClient.createOrder({
        symbol: signal.symbol,
        side: signal.direction === "LONG" ? "buy" : "sell",
        type: "market",
        quantity,
      });

      if (!orderResult.success || !orderResult.order) {
        return {
          success: false,
          error: orderResult.error || "Order placement failed",
        };
      }

      // Save signal to database
      const savedSignal = await this.saveSignal(signal, userId, botConfig, orderResult.order.id);

      // Set TP/SL orders if supported
      if (signal.stopLoss || signal.takeProfits.length > 0) {
        await this.setTPSLOrders(
          exchangeClient,
          signal,
          quantity,
          orderResult.order.id
        );
      }

      return {
        success: true,
        signalId: savedSignal.id,
        orderId: orderResult.order.id,
        warnings: parseResult.warnings,
        details: {
          symbol: signal.symbol,
          direction: signal.direction,
          entryPrice: currentPrice,
          quantity,
          leverage: effectiveLeverage,
        },
      };
    } catch (error) {
      console.error("[CornixHandler] Error processing signal:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get bot configuration
   */
  private async getBotConfig(userId: string, botConfigId?: string): Promise<BotConfig | null> {
    try {
      let config;
      
      if (botConfigId) {
        config = await db.botConfig.findUnique({
          where: { id: botConfigId },
        });
      } else {
        config = await db.botConfig.findFirst({
          where: { userId, isActive: true },
          orderBy: { createdAt: "desc" },
        });
      }

      if (!config) return null;

      return {
        id: config.id,
        userId: config.userId,
        exchangeId: config.exchangeId || "binance",
        accountId: config.accountId || "",
        amountPerTrade: config.tradeAmount || 100,
        amountType: (config.amountType as "FIXED" | "PERCENTAGE") || "FIXED",
        leverage: config.leverage || 10,
        leverageOverride: config.leverageOverride || false,
        maxLeverage: config.maxLeverage || 100,
        defaultMarginMode: (config.marginMode as "ISOLATED" | "CROSSED") || "ISOLATED",
        allowedSymbols: config.allowedSymbols ? JSON.parse(config.allowedSymbols) : undefined,
        blockedSymbols: config.blockedSymbols ? JSON.parse(config.blockedSymbols) : undefined,
        isActive: config.isActive,
      };
    } catch (error) {
      console.error("[CornixHandler] Error getting bot config:", error);
      return null;
    }
  }

  /**
   * Check if symbol is allowed for trading
   */
  private checkSymbolRestrictions(
    symbol: string,
    config: BotConfig
  ): { allowed: boolean; reason?: string } {
    // Check blocked symbols
    if (config.blockedSymbols?.length && config.blockedSymbols.includes(symbol)) {
      return { allowed: false, reason: `Symbol ${symbol} is blocked in bot configuration` };
    }

    // Check allowed symbols (if specified)
    if (config.allowedSymbols?.length && !config.allowedSymbols.includes(symbol)) {
      return { allowed: false, reason: `Symbol ${symbol} is not in allowed symbols list` };
    }

    return { allowed: true };
  }

  /**
   * Get exchange client with decrypted credentials
   */
  private async getExchangeClient(config: BotConfig): Promise<BaseExchangeClient | null> {
    try {
      // Get account with encrypted credentials
      const account = await db.account.findFirst({
        where: {
          id: config.accountId,
          userId: config.userId,
          isActive: true,
        },
      });

      if (!account || !account.encryptedApiCredentials) {
        console.error("[CornixHandler] Account not found or no credentials");
        return null;
      }

      // Decrypt credentials
      const encryptedCreds = JSON.parse(account.encryptedApiCredentials);
      const credentials = {
        apiKey: decryptApiKey(encryptedCreds.apiKey),
        apiSecret: decryptApiKey(encryptedCreds.apiSecret),
        passphrase: encryptedCreds.passphrase 
          ? decryptApiKey(encryptedCreds.passphrase) 
          : undefined,
      };

      // Create exchange client
      return createExchangeClient(config.exchangeId, {
        credentials,
        marketType: "futures",
        testnet: account.isTestnet || false,
      });
    } catch (error) {
      console.error("[CornixHandler] Error creating exchange client:", error);
      return null;
    }
  }

  /**
   * Calculate position size based on config and available balance
   */
  private async calculatePositionSize(
    signal: CornixSignal,
    config: BotConfig,
    client: BaseExchangeClient
  ): Promise<{ margin: number; availableBalance: number }> {
    try {
      // Get account info
      const accountInfo = await client.getAccountInfo();
      const usdtBalance = accountInfo.balances.find(b => b.currency === "USDT");
      const availableBalance = usdtBalance?.available || 0;

      let margin: number;

      if (config.amountType === "PERCENTAGE") {
        margin = availableBalance * (config.amountPerTrade / 100);
      } else {
        margin = config.amountPerTrade;
      }

      // Ensure we have enough balance
      if (margin > availableBalance) {
        margin = availableBalance * 0.95; // Use 95% of available
      }

      return { margin, availableBalance };
    } catch (error) {
      console.error("[CornixHandler] Error calculating position size:", error);
      return { margin: config.amountPerTrade, availableBalance: 0 };
    }
  }

  /**
   * Save signal to database
   */
  private async saveSignal(
    signal: CornixSignal,
    userId: string,
    config: BotConfig,
    orderId: string
  ): Promise<{ id: string }> {
    // Get next signal ID
    const counter = await db.signalIdCounter.upsert({
      where: { id: "signal_counter" },
      update: { lastId: { increment: 1 } },
      create: { id: "signal_counter", lastId: 1 },
    });

    return db.signal.create({
      data: {
        signalId: counter.lastId,
        userId,
        source: "TELEGRAM",
        sourceMessage: JSON.stringify({
          symbol: signal.symbol,
          direction: signal.direction,
          entries: signal.entries,
          takeProfits: signal.takeProfits,
          stopLoss: signal.stopLoss,
          leverage: signal.leverage,
        }),
        symbol: signal.symbol,
        direction: signal.direction,
        action: signal.direction === "LONG" ? "BUY" : "SELL",
        marketType: signal.marketType || "FUTURES",
        entryPrices: JSON.stringify(signal.entries.values),
        takeProfits: JSON.stringify(signal.takeProfits),
        stopLoss: signal.stopLoss,
        leverage: signal.leverage || 10,
        status: "ACTIVE",
        processedAt: new Date(),
      },
    });
  }

  /**
   * Set TP/SL orders after main entry
   */
  private async setTPSLOrders(
    client: BaseExchangeClient,
    signal: CornixSignal,
    quantity: number,
    entryOrderId: string
  ): Promise<void> {
    try {
      // Set stop loss
      if (signal.stopLoss) {
        await client.createOrder({
          symbol: signal.symbol,
          side: signal.direction === "LONG" ? "sell" : "buy",
          type: "stop_market",
          quantity,
          stopPrice: signal.stopLoss,
          reduceOnly: true,
        });
      }

      // Set take profit orders
      // For simplicity, use first TP. In production, split quantity across TPs
      if (signal.takeProfits.length > 0) {
        const mainTP = signal.takeProfits[0].price;
        await client.createOrder({
          symbol: signal.symbol,
          side: signal.direction === "LONG" ? "sell" : "buy",
          type: "limit",
          quantity,
          price: mainTP,
          reduceOnly: true,
        });
      }
    } catch (error) {
      console.error("[CornixHandler] Error setting TP/SL orders:", error);
      // Don't fail the whole trade for TP/SL errors
    }
  }
}

// Export singleton instance
export const cornixSignalHandler = new CornixSignalHandler();

// Convenience function
export const processSignal = (
  message: string,
  userId: string,
  botConfigId?: string,
  options?: { sourceChannel?: string; messageId?: number }
) => cornixSignalHandler.processSignal(message, userId, botConfigId, options);
