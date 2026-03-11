/**
 * Signal Parsing Module
 * 
 * Production-ready signal parsing for Cornix-compatible trading signals.
 * Supports multiple formats and integrates with exchange clients.
 */

export { 
  CornixSignalParser, 
  cornixSignalParser, 
  parseSignal,
  type CornixSignal,
  type ParseResult,
} from "./cornix-parser";

export { 
  CornixSignalHandler, 
  cornixSignalHandler, 
  processSignal,
  type SignalExecutionResult,
  type BotConfig,
} from "./cornix-handler";
