/**
 * Entry Strategy Service
 * Cornix-compatible entry weight distribution strategies
 * 
 * Supports multi-entry with custom weights for DCA strategies
 * @version 2.0 - Production Ready
 */

import type { Signal } from "@prisma/client";
import {
  parseMultiEntryWithWeights,
  validateMultiEntryConfig,
  type MultiEntryConfig,
  type EntryTarget as ParsedEntryTarget
} from "@/lib/signal-parser";

// ==================== TYPES ====================

export type EntryStrategyType =
  | "EVENLY_DIVIDED"
  | "ONE_TARGET"
  | "TWO_TARGETS"
  | "THREE_TARGETS"
  | "FIFTY_ON_FIRST"
  | "DECREASING_EXP"
  | "INCREASING_EXP"
  | "SKIP_FIRST"
  | "CUSTOM_RATIOS"
  | "WEIGHTED_DISTRIBUTION"; // NEW: Signal-provided weights

export interface EntryStrategyConfig {
  type: EntryStrategyType;
  customRatios?: number[]; // e.g., [50, 30, 20]
  totalTargets: number;
  /** Signal-provided multi-entry configuration with weights */
  multiEntryConfig?: MultiEntryConfig;
}

export interface EntryTarget {
  index: number;
  price: number;
  amount: number;
  percentage: number;
  /** Weight for this entry (0-100) */
  weight: number;
  /** Order ID once placed */
  orderId?: string;
  /** Status of this entry target */
  status: "PENDING" | "PLACED" | "FILLED" | "CANCELLED" | "FAILED";
  /** Filled quantity */
  filledQuantity?: number;
  /** Average fill price */
  avgFillPrice?: number;
}

export interface WeightedEntryDistribution {
  targets: EntryTarget[];
  totalAmount: number;
  totalWeight: number;
  strategy: EntryStrategyType;
  isValid: boolean;
  validationErrors: string[];
}

// ==================== WEIGHT CALCULATION ====================

/**
 * Calculate entry weights based on strategy
 */
export function calculateEntryWeights(
  config: EntryStrategyConfig
): number[] {
  const n = config.totalTargets;

  // If multi-entry config with weights is provided, use it
  if (config.multiEntryConfig && config.type === "WEIGHTED_DISTRIBUTION") {
    return config.multiEntryConfig.targets.map(t => t.weight);
  }

  switch (config.type) {
    case "EVENLY_DIVIDED":
      return Array(n).fill(100 / n);

    case "ONE_TARGET":
      return [100, ...Array(n - 1).fill(0)];

    case "TWO_TARGETS": {
      const first = 100 / 2;
      const second = 100 / 2;
      const rest = Array(Math.max(0, n - 2)).fill(0);
      return [first, second, ...rest];
    }

    case "THREE_TARGETS": {
      const each = 100 / 3;
      const rest = Array(Math.max(0, n - 3)).fill(0);
      return [each, each, each, ...rest];
    }

    case "FIFTY_ON_FIRST": {
      const rest = (n - 1) > 0 ? (50 / (n - 1)) : 0;
      return [50, ...Array(n - 1).fill(rest)];
    }

    case "DECREASING_EXP": {
      // Exponentially decreasing: each target gets half of previous
      const weights: number[] = [];
      let remaining = 100;
      for (let i = 0; i < n; i++) {
        const w = i < n - 1 ? remaining / 2 : remaining;
        weights.push(w);
        remaining -= w;
      }
      return weights;
    }

    case "INCREASING_EXP": {
      // Exponentially increasing: each target gets double of previous
      const weights: number[] = [];
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.pow(2, i);
        weights.push(w);
        sum += w;
      }
      // Normalize to 100%
      return weights.map(w => (w / sum) * 100);
    }

    case "SKIP_FIRST": {
      const rest = n > 1 ? 100 / (n - 1) : 100;
      return [0, ...Array(n - 1).fill(rest)];
    }

    case "CUSTOM_RATIOS": {
      if (!config.customRatios || config.customRatios.length === 0) {
        return Array(n).fill(100 / n);
      }
      // Normalize custom ratios
      const sum = config.customRatios.reduce((a, b) => a + b, 0);
      const normalized = config.customRatios.map(r => (r / sum) * 100);
      // Pad or trim to match target count
      while (normalized.length < n) normalized.push(0);
      return normalized.slice(0, n);
    }

    case "WEIGHTED_DISTRIBUTION":
      // Should be handled above, but fallback to evenly divided
      return Array(n).fill(100 / n);

    default:
      return Array(n).fill(100 / n);
  }
}

// ==================== SIGNAL-BASED WEIGHT EXTRACTION ====================

/**
 * Extract entry weights from a Signal record
 * Parses the entryWeights JSON field and validates
 */
export function extractWeightsFromSignal(signal: Signal): {
  weights: number[] | null;
  config: MultiEntryConfig | null;
  errors: string[];
} {
  const errors: string[] = [];

  if (!signal.entryWeights) {
    return { weights: null, config: null, errors: [] };
  }

  try {
    const weights = JSON.parse(signal.entryWeights) as number[];

    if (!Array.isArray(weights)) {
      errors.push("entryWeights must be an array");
      return { weights: null, config: null, errors };
    }

    if (weights.length < 2) {
      errors.push("At least 2 weights required for multi-entry");
      return { weights: null, config: null, errors };
    }

    // Validate weights
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    if (Math.abs(totalWeight - 100) > 5) {
      // Auto-normalize if not close to 100
      const normalized = weights.map(w => (w / totalWeight) * 100);
      return {
        weights: normalized,
        config: {
          targets: normalized.map((w, i) => ({
            index: i + 1,
            price: 0, // Will be set from entry prices
            weight: w
          })),
          totalWeight: 100,
          strategy: "CUSTOM_RATIOS"
        },
        errors: []
      };
    }

    // Parse entry prices to build full config
    const entryPrices = signal.entryPrices ? JSON.parse(signal.entryPrices) : [];

    const config: MultiEntryConfig = {
      targets: weights.map((w, i) => ({
        index: i + 1,
        price: entryPrices[i] || 0,
        weight: w
      })),
      totalWeight,
      strategy: "CUSTOM_RATIOS"
    };

    return { weights, config, errors: [] };
  } catch (error) {
    errors.push(`Failed to parse entryWeights: ${error}`);
    return { weights: null, config: null, errors };
  }
}

/**
 * Determine the best entry strategy based on signal data
 */
export function determineEntryStrategy(signal: Signal): EntryStrategyConfig {
  // Check if signal has custom weights
  const { weights, config } = extractWeightsFromSignal(signal);

  if (weights && weights.length >= 2) {
    return {
      type: "WEIGHTED_DISTRIBUTION",
      totalTargets: weights.length,
      customRatios: weights,
      multiEntryConfig: config || undefined
    };
  }

  // Parse entry prices to determine target count
  let entryPrices: number[] = [];
  try {
    entryPrices = signal.entryPrices ? JSON.parse(signal.entryPrices) : [];
  } catch {
    // Ignore parse errors
  }

  const totalTargets = Math.max(1, entryPrices.length);

  // Default to evenly divided
  return {
    type: "EVENLY_DIVIDED",
    totalTargets
  };
}

// ==================== ENTRY TARGET GENERATION ====================

/**
 * Generate entry targets from signal with weighted distribution
 */
export function generateEntryTargets(
  entryPrices: number[],
  totalAmount: number,
  config: EntryStrategyConfig,
  direction: "LONG" | "SHORT"
): EntryTarget[] {
  const weights = calculateEntryWeights(config);
  const targets: EntryTarget[] = [];

  // Ensure we have prices for all targets
  const targetCount = Math.max(weights.length, entryPrices.length);
  const adjustedWeights = weights.slice(0, targetCount);
  while (adjustedWeights.length < targetCount) {
    adjustedWeights.push(100 / targetCount);
  }

  // Normalize weights
  const totalWeight = adjustedWeights.reduce((sum, w) => sum + w, 0);
  const normalizedWeights = adjustedWeights.map(w => (w / totalWeight) * 100);

  for (let i = 0; i < targetCount; i++) {
    const weight = normalizedWeights[i] || 0;
    const percentage = weight;
    const amount = (weight / 100) * totalAmount;

    // Get price for this target
    let price = entryPrices[i];
    if (!price && entryPrices.length > 0) {
      // If no specific price for this target, use the last known price
      price = entryPrices[entryPrices.length - 1];
    }

    targets.push({
      index: i,
      price: price || 0,
      amount,
      percentage,
      weight,
      status: "PENDING"
    });
  }

  return targets;
}

/**
 * Generate weighted entry distribution from signal
 * This is the main function to use when processing a signal for execution
 */
export function generateWeightedEntryDistribution(
  signal: Signal,
  totalAmount: number
): WeightedEntryDistribution {
  const validationErrors: string[] = [];

  // Parse entry prices
  let entryPrices: number[] = [];
  try {
    entryPrices = signal.entryPrices ? JSON.parse(signal.entryPrices) : [];
  } catch (error) {
    validationErrors.push("Failed to parse entry prices");
  }

  if (entryPrices.length === 0) {
    validationErrors.push("No entry prices found");
  }

  // Determine strategy
  const config = determineEntryStrategy(signal);

  // Generate targets
  const targets = generateEntryTargets(
    entryPrices,
    totalAmount,
    config,
    signal.direction as "LONG" | "SHORT"
  );

  // Calculate totals
  const totalWeight = targets.reduce((sum, t) => sum + t.weight, 0);
  const actualTotalAmount = targets.reduce((sum, t) => sum + t.amount, 0);

  // Validate
  if (targets.length === 0) {
    validationErrors.push("No entry targets generated");
  }

  if (Math.abs(totalWeight - 100) > 1) {
    validationErrors.push(`Weights do not sum to 100% (got ${totalWeight.toFixed(2)}%)`);
  }

  return {
    targets,
    totalAmount: actualTotalAmount,
    totalWeight,
    strategy: config.type,
    isValid: validationErrors.length === 0,
    validationErrors
  };
}

// ==================== DCA-SPECIFIC FUNCTIONS ====================

/**
 * Calculate DCA entry amounts with increasing position sizes
 * Used for martingale-style DCA strategies
 */
export function calculateDCAEntryAmounts(
  baseAmount: number,
  levels: number,
  multiplier: number = 1.5
): number[] {
  const amounts: number[] = [];

  for (let i = 0; i < levels; i++) {
    const amount = baseAmount * Math.pow(multiplier, i);
    amounts.push(amount);
  }

  // Normalize to percentage of total
  const total = amounts.reduce((sum, a) => sum + a, 0);
  return amounts.map(a => (a / total) * 100);
}

/**
 * Generate DCA-style entry targets with price drops
 */
export function generateDCAEntryTargets(
  baseEntryPrice: number,
  totalAmount: number,
  levels: number,
  priceDropPercent: number,
  amountMultiplier: number,
  direction: "LONG" | "SHORT"
): EntryTarget[] {
  const weights = calculateDCAEntryAmounts(1, levels, amountMultiplier);
  const targets: EntryTarget[] = [];

  for (let i = 0; i < levels; i++) {
    const weight = weights[i];
    const amount = (weight / 100) * totalAmount;

    // Calculate price for this DCA level
    const priceDrop = priceDropPercent * i;
    let price: number;
    if (direction === "LONG") {
      price = baseEntryPrice * (1 - priceDrop / 100);
    } else {
      price = baseEntryPrice * (1 + priceDrop / 100);
    }

    targets.push({
      index: i,
      price,
      amount,
      percentage: weight,
      weight,
      status: "PENDING"
    });
  }

  return targets;
}

// ==================== VALIDATION ====================

/**
 * Validate entry strategy config
 */
export function validateEntryStrategyConfig(
  config: EntryStrategyConfig
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.totalTargets < 1 || config.totalTargets > 10) {
    errors.push("totalTargets must be between 1 and 10");
  }

  if (config.type === "CUSTOM_RATIOS") {
    if (!config.customRatios || config.customRatios.length === 0) {
      errors.push("customRatios required for CUSTOM_RATIOS strategy");
    } else {
      const sum = config.customRatios.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 100) > 5) {
        errors.push(`customRatios should sum to ~100% (got ${sum.toFixed(2)}%)`);
      }
    }
  }

  if (config.type === "WEIGHTED_DISTRIBUTION" && config.multiEntryConfig) {
    const validation = validateMultiEntryConfig(config.multiEntryConfig);
    if (!validation.valid) {
      errors.push(...validation.errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate entry targets before execution
 */
export function validateEntryTargets(targets: EntryTarget[]): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (targets.length === 0) {
    errors.push("No entry targets provided");
    return { valid: false, errors, warnings };
  }

  // Check total weight
  const totalWeight = targets.reduce((sum, t) => sum + t.weight, 0);
  if (Math.abs(totalWeight - 100) > 1) {
    errors.push(`Weights must sum to ~100% (got ${totalWeight.toFixed(2)}%)`);
  }

  // Check for zero weights
  const zeroWeightTargets = targets.filter(t => t.weight === 0);
  if (zeroWeightTargets.length > 0) {
    warnings.push(`${zeroWeightTargets.length} targets have zero weight`);
  }

  // Check for valid prices
  const invalidPrices = targets.filter(t => t.price <= 0);
  if (invalidPrices.length > 0) {
    errors.push(`${invalidPrices.length} targets have invalid prices`);
  }

  // Check for duplicate prices
  const prices = targets.map(t => t.price);
  const uniquePrices = new Set(prices);
  if (uniquePrices.size !== prices.length && prices.length > 1) {
    warnings.push("Some targets have the same price");
  }

  // Check amounts
  const zeroAmountTargets = targets.filter(t => t.amount <= 0 && t.weight > 0);
  if (zeroAmountTargets.length > 0) {
    errors.push(`${zeroAmountTargets.length} targets have zero amount but non-zero weight`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Format entry targets for display/logging
 */
export function formatEntryTargets(targets: EntryTarget[]): string {
  const lines = targets.map(t =>
    `  ${t.index + 1}. Price: ${t.price.toFixed(8)}, Weight: ${t.weight.toFixed(1)}%, Amount: ${t.amount.toFixed(2)} USDT`
  );
  return `Entry Targets:\n${lines.join("\n")}`;
}

/**
 * Calculate average entry price from targets
 */
export function calculateAverageEntryPrice(targets: EntryTarget[]): number {
  const totalAmount = targets.reduce((sum, t) => sum + t.amount, 0);
  if (totalAmount === 0) return 0;

  const weightedSum = targets.reduce((sum, t) => sum + (t.price * t.amount), 0);
  return weightedSum / totalAmount;
}

/**
 * Get the next pending entry target
 */
export function getNextPendingTarget(targets: EntryTarget[]): EntryTarget | null {
  return targets.find(t => t.status === "PENDING") || null;
}

/**
 * Mark a target as filled
 */
export function markTargetFilled(
  targets: EntryTarget[],
  index: number,
  filledQuantity: number,
  avgFillPrice: number
): EntryTarget[] {
  return targets.map(t => {
    if (t.index === index) {
      return {
        ...t,
        status: "FILLED" as const,
        filledQuantity,
        avgFillPrice
      };
    }
    return t;
  });
}

/**
 * Calculate remaining amount to be filled
 */
export function calculateRemainingAmount(targets: EntryTarget[]): number {
  return targets
    .filter(t => t.status === "PENDING" || t.status === "PLACED")
    .reduce((sum, t) => sum + t.amount, 0);
}

/**
 * Calculate filled amount so far
 */
export function calculateFilledAmount(targets: EntryTarget[]): number {
  return targets
    .filter(t => t.status === "FILLED")
    .reduce((sum, t) => sum + (t.filledQuantity || t.amount), 0);
}

export default {
  calculateEntryWeights,
  extractWeightsFromSignal,
  determineEntryStrategy,
  generateEntryTargets,
  generateWeightedEntryDistribution,
  calculateDCAEntryAmounts,
  generateDCAEntryTargets,
  validateEntryStrategyConfig,
  validateEntryTargets,
  formatEntryTargets,
  calculateAverageEntryPrice,
  getNextPendingTarget,
  markTargetFilled,
  calculateRemainingAmount,
  calculateFilledAmount
};
