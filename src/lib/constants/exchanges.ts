/**
 * Shared Exchange Constants
 * 
 * Single source of truth for exchange configuration across the platform.
 * Eliminates code duplication found in 24+ files.
 * 
 * Based on Kimi_Solutions.md recommendations
 */

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

/**
 * Supported exchanges configuration
 */
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
    supportsTestnet: false,
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
    supported: false, // Disabled
    supportsSpot: true,
    supportsFutures: true,
    supportsTestnet: false,
    maxLeverage: 100,
    makerFee: 0.0002,
    takerFee: 0.0006,
  },
  {
    id: "huobi",
    name: "HTX (Huobi)",
    supported: false, // Disabled
    supportsSpot: true,
    supportsFutures: true,
    supportsTestnet: false,
    maxLeverage: 100,
    makerFee: 0.0002,
    takerFee: 0.0005,
  },
  {
    id: "gate",
    name: "Gate.io",
    supported: false, // Disabled
    supportsSpot: true,
    supportsFutures: true,
    supportsTestnet: false,
    maxLeverage: 100,
    makerFee: 0.0002,
    takerFee: 0.0005,
  },
  {
    id: "mexc",
    name: "MEXC",
    supported: false, // Disabled
    supportsSpot: true,
    supportsFutures: true,
    supportsTestnet: false,
    maxLeverage: 200,
    makerFee: 0.0002,
    takerFee: 0.0005,
  },
  {
    id: "coinbase",
    name: "Coinbase",
    supported: false, // Disabled
    supportsSpot: true,
    supportsFutures: false,
    supportsTestnet: false,
    maxLeverage: 1,
    makerFee: 0.005,
    takerFee: 0.005,
  },
  {
    id: "hyperliquid",
    name: "HyperLiquid",
    supported: false, // Disabled
    supportsSpot: false,
    supportsFutures: true,
    supportsTestnet: true,
    maxLeverage: 50,
    makerFee: 0.0001,
    takerFee: 0.00025,
  },
];

/**
 * Get active exchanges only
 */
export const ACTIVE_EXCHANGES = SUPPORTED_EXCHANGES.filter(e => e.supported);

/**
 * Simple exchange list for UI selects
 * Format: { id, name }
 */
export const EXCHANGES = ACTIVE_EXCHANGES.map(e => ({
  id: e.id,
  name: e.name,
}));

/**
 * Exchange IDs only
 */
export const EXCHANGE_IDS = ACTIVE_EXCHANGES.map(e => e.id);

/**
 * Get exchange info by ID
 */
export function getExchangeInfo(id: string): ExchangeInfo | undefined {
  return SUPPORTED_EXCHANGES.find(e => e.id === id.toLowerCase());
}

/**
 * Check if exchange is supported
 */
export function isExchangeSupported(id: string): boolean {
  const exchange = getExchangeInfo(id);
  return exchange?.supported ?? false;
}

/**
 * Get exchanges that support a specific feature
 */
export function getExchangesByFeature(feature: keyof ExchangeInfo): ExchangeInfo[] {
  return ACTIVE_EXCHANGES.filter(e => e[feature]);
}

/**
 * Get exchanges with testnet support
 */
export const getTestnetExchanges = () => 
  ACTIVE_EXCHANGES.filter(e => e.supportsTestnet);

/**
 * Get exchanges with futures support
 */
export const getFuturesExchanges = () => 
  ACTIVE_EXCHANGES.filter(e => e.supportsFutures);

/**
 * Get exchanges with spot support
 */
export const getSpotExchanges = () => 
  ACTIVE_EXCHANGES.filter(e => e.supportsSpot);

/**
 * Default exchange for new bots
 */
export const DEFAULT_EXCHANGE = "binance";

/**
 * Exchange display names for UI
 */
export const EXCHANGE_DISPLAY_NAMES: Record<string, string> = {
  binance: "Binance",
  bybit: "Bybit",
  okx: "OKX",
  bitget: "Bitget",
  bingx: "BingX",
};
