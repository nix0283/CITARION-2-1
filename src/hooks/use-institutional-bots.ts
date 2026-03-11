/**
 * Hook for Institutional Bots API integration
 * Provides CRUD operations and real-time state management
 */

import { useState, useEffect, useCallback } from 'react';

const API_BASE = '/api/bots/institutional';

export type BotType = 'SPECTRUM' | 'REED' | 'ARCHITECT' | 'EQUILIBRIST' | 'KRON';
export type BotStatus = 'stopped' | 'starting' | 'running' | 'paused' | 'error';

export interface InstitutionalBot {
  id: string;
  botType: BotType;
  name: string;
  symbol: string;
  isActive: boolean;
  status: BotStatus;
  totalProfit: number;
  totalTrades: number;
  winRate: number;
  maxDrawdown: number;
  algorithm: string;
  configJson: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  account?: {
    exchangeName: string;
    exchangeId: string;
  };
}

export interface CreateBotRequest {
  botType: BotType;
  name?: string;
  symbol?: string;
  accountId?: string;
  config?: Record<string, unknown>;
}

export interface UpdateBotRequest {
  name?: string;
  isActive?: boolean;
  status?: BotStatus;
  symbol?: string;
  leverage?: number;
  config?: Record<string, unknown>;
}

export interface BotsSummary {
  total: number;
  active: number;
  byType: Record<BotType, number>;
}

export function useInstitutionalBots() {
  const [bots, setBots] = useState<InstitutionalBot[]>([]);
  const [summary, setSummary] = useState<BotsSummary>({
    total: 0,
    active: 0,
    byType: { SPECTRUM: 0, REED: 0, ARCHITECT: 0, EQUILIBRIST: 0, KRON: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch all bots
  const fetchBots = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(API_BASE);
      const data = await response.json();

      if (data.success) {
        setBots(data.data);
        setSummary(data.summary);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch bots');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  // Create a new bot
  const createBot = useCallback(async (request: CreateBotRequest): Promise<InstitutionalBot | null> => {
    try {
      const response = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      const data = await response.json();

      if (data.success) {
        // Refresh the list
        await fetchBots();
        return data.data;
      } else {
        setError(data.error || 'Failed to create bot');
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    }
  }, [fetchBots]);

  // Update a bot
  const updateBot = useCallback(async (
    botType: BotType,
    id: string,
    updates: UpdateBotRequest
  ): Promise<InstitutionalBot | null> => {
    try {
      const response = await fetch(`${API_BASE}/${botType}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      const data = await response.json();

      if (data.success) {
        // Update local state
        setBots(prev => prev.map(bot => 
          bot.id === id ? { ...bot, ...data.data } : bot
        ));
        return data.data;
      } else {
        setError(data.error || 'Failed to update bot');
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    }
  }, []);

  // Delete a bot
  const deleteBot = useCallback(async (botType: BotType, id: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE}/${botType}/${id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (data.success) {
        setBots(prev => prev.filter(bot => bot.id !== id));
        return true;
      } else {
        setError(data.error || 'Failed to delete bot');
        return false;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  }, []);

  // Start a bot
  const startBot = useCallback(async (botType: BotType, id: string): Promise<InstitutionalBot | null> => {
    try {
      const response = await fetch(`${API_BASE}/${botType}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });

      const data = await response.json();

      if (data.success) {
        setBots(prev => prev.map(bot => 
          bot.id === id ? { ...bot, isActive: true, status: 'running' } : bot
        ));
        return data.data;
      } else {
        setError(data.error || 'Failed to start bot');
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    }
  }, []);

  // Stop a bot
  const stopBot = useCallback(async (botType: BotType, id: string): Promise<InstitutionalBot | null> => {
    try {
      const response = await fetch(`${API_BASE}/${botType}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });

      const data = await response.json();

      if (data.success) {
        setBots(prev => prev.map(bot => 
          bot.id === id ? { ...bot, isActive: false, status: 'stopped' } : bot
        ));
        return data.data;
      } else {
        setError(data.error || 'Failed to stop bot');
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    }
  }, []);

  // Toggle bot state
  const toggleBot = useCallback(async (botType: BotType, id: string): Promise<InstitutionalBot | null> => {
    try {
      const response = await fetch(`${API_BASE}/${botType}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle' }),
      });

      const data = await response.json();

      if (data.success) {
        setBots(prev => prev.map(bot => 
          bot.id === id ? data.data : bot
        ));
        return data.data;
      } else {
        setError(data.error || 'Failed to toggle bot');
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    }
  }, []);

  // Get a single bot
  const getBot = useCallback(async (botType: BotType, id: string): Promise<InstitutionalBot | null> => {
    try {
      const response = await fetch(`${API_BASE}/${botType}/${id}`);
      const data = await response.json();

      if (data.success) {
        return data.data;
      } else {
        setError(data.error || 'Failed to fetch bot');
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    }
  }, []);

  // Fetch bots on mount
  useEffect(() => {
    fetchBots();
  }, [fetchBots]);

  return {
    bots,
    summary,
    loading,
    error,
    fetchBots,
    createBot,
    updateBot,
    deleteBot,
    startBot,
    stopBot,
    toggleBot,
    getBot,
    clearError: () => setError(null),
  };
}

// Hook for a single bot type
export function useBotsByType(botType: BotType) {
  const { bots, loading, error, ...rest } = useInstitutionalBots();
  
  const filteredBots = bots.filter(bot => bot.botType === botType);
  
  return {
    bots: filteredBots,
    loading,
    error,
    ...rest,
  };
}
