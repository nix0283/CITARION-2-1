/**
 * Application Startup Service
 * 
 * Initializes all background services when the application starts.
 * Includes: Funding WebSocket, Bot Monitors, Risk Monitors, etc.
 */

import { getFundingRateWebSocket } from './funding';

// Track initialized services
const initializedServices: Map<string, boolean> = new Map();

/**
 * Initialize all background services
 * Call this once when the application starts
 */
export async function initializeServices(): Promise<{
  success: boolean;
  services: Record<string, { status: string; error?: string }>;
}> {
  const results: Record<string, { status: string; error?: string }> = {};

  // Initialize Funding Rate WebSocket
  try {
    const fundingWs = getFundingRateWebSocket(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT']);
    
    // Connect to primary exchanges
    await fundingWs.connect('binance');
    
    // Subscribe to funding rate updates
    fundingWs.subscribe(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
    
    initializedServices.set('funding-websocket', true);
    results['funding-websocket'] = { status: 'connected' };
    
    console.log('[Startup] Funding WebSocket initialized successfully');
  } catch (error) {
    results['funding-websocket'] = { 
      status: 'error', 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
    console.error('[Startup] Failed to initialize Funding WebSocket:', error);
  }

  // Initialize other services here as needed
  // ...

  const allSuccess = Object.values(results).every(r => r.status !== 'error');

  return {
    success: allSuccess,
    services: results,
  };
}

/**
 * Shutdown all background services
 * Call this when the application is shutting down
 */
export async function shutdownServices(): Promise<void> {
  // Shutdown Funding WebSocket
  if (initializedServices.get('funding-websocket')) {
    try {
      const fundingWs = getFundingRateWebSocket();
      fundingWs.disconnect();
      initializedServices.set('funding-websocket', false);
      console.log('[Shutdown] Funding WebSocket disconnected');
    } catch (error) {
      console.error('[Shutdown] Error disconnecting Funding WebSocket:', error);
    }
  }

  // Shutdown other services here as needed
  // ...

  console.log('[Shutdown] All services shut down');
}

/**
 * Check if a specific service is initialized
 */
export function isServiceInitialized(serviceName: string): boolean {
  return initializedServices.get(serviceName) === true;
}

/**
 * Get all initialized services
 */
export function getInitializedServices(): string[] {
  return Array.from(initializedServices.entries())
    .filter(([_, initialized]) => initialized)
    .map(([name]) => name);
}

/**
 * Health check for all services
 */
export async function healthCheck(): Promise<Record<string, { healthy: boolean; details?: string }>> {
  const health: Record<string, { healthy: boolean; details?: string }> = {};

  // Check Funding WebSocket
  if (initializedServices.get('funding-websocket')) {
    try {
      const fundingWs = getFundingRateWebSocket();
      const rates = fundingWs.getAllFundingRates();
      health['funding-websocket'] = {
        healthy: true,
        details: `${rates.size} symbols tracked`,
      };
    } catch (error) {
      health['funding-websocket'] = {
        healthy: false,
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  } else {
    health['funding-websocket'] = {
      healthy: false,
      details: 'Not initialized',
    };
  }

  return health;
}

// Auto-initialize on import in server environment
if (typeof window === 'undefined') {
  // Server-side only
  initializeServices()
    .then(result => {
      if (result.success) {
        console.log('[Startup] All services initialized successfully');
      } else {
        console.warn('[Startup] Some services failed to initialize:', result.services);
      }
    })
    .catch(error => {
      console.error('[Startup] Critical error during initialization:', error);
    });
}
