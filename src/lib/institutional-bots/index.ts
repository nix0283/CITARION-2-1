/**
 * Institutional Bots Module
 * 
 * Export all institutional bot engines and common utilities.
 */

// Types and interfaces
export * from './types';

// Bot Engines
export { SpectrumEngine, getSpectrumEngine, type SpectrumConfig } from './spectrum-engine';
export { ReedEngine, getReedEngine, type ReedConfig } from './reed-engine';
export { ArchitectEngine, getArchitectEngine, type ArchitectConfig, type Quote } from './architect-engine';
export { EquilibristEngine, getEquilibristEngine, type EquilibristConfig } from './equilibrist-engine';
export { KronEngine, getKronEngine, type KronConfig, type TrendState } from './kron-engine';

// Bot type constants
export const INSTITUTIONAL_BOT_TYPES = ['SPECTRUM', 'REED', 'ARCHITECT', 'EQUILIBRIST', 'KRON'] as const;
export type InstitutionalBotType = typeof INSTITUTIONAL_BOT_TYPES[number];

// Bot type to name mapping
export const BOT_TYPE_NAMES: Record<InstitutionalBotType, string> = {
  SPECTRUM: 'Spectrum Bot (PR)',
  REED: 'Reed Bot (STA)',
  ARCHITECT: 'Architect Bot (MM)',
  EQUILIBRIST: 'Equilibrist Bot (MR)',
  KRON: 'Kron Bot (TRF)',
};

// Bot type to algorithm mapping
export const BOT_TYPE_ALGORITHMS: Record<InstitutionalBotType, string> = {
  SPECTRUM: 'Pairs Trading',
  REED: 'Statistical Arbitrage',
  ARCHITECT: 'Market Making',
  EQUILIBRIST: 'Mean Reversion',
  KRON: 'Trend Following',
};

// Factory function to create bot engine by type
import { IBotEngine, BotConfig } from './types';
import { SpectrumEngine } from './spectrum-engine';
import { ReedEngine } from './reed-engine';
import { ArchitectEngine } from './architect-engine';
import { EquilibristEngine } from './equilibrist-engine';
import { KronEngine } from './kron-engine';

export function createBotEngine(botType: InstitutionalBotType): IBotEngine {
  switch (botType) {
    case 'SPECTRUM':
      return new SpectrumEngine();
    case 'REED':
      return new ReedEngine();
    case 'ARCHITECT':
      return new ArchitectEngine();
    case 'EQUILIBRIST':
      return new EquilibristEngine();
    case 'KRON':
      return new KronEngine();
    default:
      throw new Error(`Unknown bot type: ${botType}`);
  }
}

// Utility to validate bot configuration
export function validateBotConfig(config: Partial<BotConfig>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.symbol) {
    errors.push('Symbol is required');
  }

  if (config.maxPositionSize !== undefined && config.maxPositionSize <= 0) {
    errors.push('Max position size must be positive');
  }

  if (config.leverage !== undefined && (config.leverage <= 0 || config.leverage > 100)) {
    errors.push('Leverage must be between 0 and 100');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
