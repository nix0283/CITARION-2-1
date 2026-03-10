/**
 * Sentiment Analyzer for Crypto News
 * Production-ready sentiment analysis using keyword matching and scoring
 */

import type { SentimentType, SentimentResult } from './types';

// Bullish keywords with weights
const BULLISH_KEYWORDS: Record<string, number> = {
  // Strong bullish (0.8-1.0)
  'surge': 0.9,
  'soar': 0.9,
  'skyrocket': 0.95,
  'moon': 0.85,
  'breakout': 0.8,
  'rally': 0.85,
  'bull run': 0.9,
  'all-time high': 0.95,
  'ath': 0.9,
  'record high': 0.9,
  'breaks resistance': 0.8,
  'breaks out': 0.8,
  
  // Medium bullish (0.5-0.8)
  'gain': 0.6,
  'rise': 0.55,
  'climb': 0.55,
  'jump': 0.65,
  'pump': 0.7,
  'bullish': 0.75,
  'buy': 0.5,
  'accumulate': 0.6,
  'adoption': 0.65,
  'institutional': 0.6,
  'approval': 0.7,
  'launch': 0.55,
  'partnership': 0.55,
  'upgrade': 0.5,
  'support': 0.45,
  'holding': 0.4,
  'hodl': 0.5,
  'whale buying': 0.75,
  'accumulation': 0.6,
  
  // Mild bullish (0.3-0.5)
  'positive': 0.4,
  'optimistic': 0.45,
  'growth': 0.4,
  'potential': 0.35,
  'opportunity': 0.35,
  'undervalued': 0.45,
  'oversold': 0.5,
};

// Bearish keywords with weights
const BEARISH_KEYWORDS: Record<string, number> = {
  // Strong bearish (0.8-1.0)
  'crash': 0.95,
  'collapse': 0.95,
  'plummet': 0.9,
  'tank': 0.85,
  'dump': 0.85,
  'sell-off': 0.85,
  'bloodbath': 0.95,
  'bear market': 0.9,
  'liquidation': 0.8,
  'bankruptcy': 0.95,
  'fraud': 0.9,
  'scam': 0.9,
  'hack': 0.85,
  'exploit': 0.85,
  
  // Medium bearish (0.5-0.8)
  'drop': 0.6,
  'fall': 0.55,
  'decline': 0.55,
  'lose': 0.5,
  'loss': 0.55,
  'bearish': 0.75,
  'sell': 0.5,
  'selling': 0.55,
  'dumping': 0.7,
  'rejection': 0.6,
  'ban': 0.7,
  'regulation': 0.5,
  'lawsuit': 0.65,
  'investigation': 0.6,
  'fine': 0.55,
  'penalty': 0.55,
  'breaks support': 0.7,
  'breakdown': 0.65,
  'whale selling': 0.7,
  'distribution': 0.55,
  
  // Mild bearish (0.3-0.5)
  'negative': 0.4,
  'pessimistic': 0.45,
  'concern': 0.35,
  'risk': 0.35,
  'warning': 0.4,
  'caution': 0.35,
  'overvalued': 0.45,
  'overbought': 0.45,
  'resistance': 0.3,
  'uncertainty': 0.35,
};

// Neutral/filler words that reduce sentiment intensity
const NEUTRAL_WORDS = new Set([
  'may', 'might', 'could', 'would', 'should', 'potentially',
  'possibly', 'perhaps', 'seems', 'appears', 'reported',
  'according', 'suggested', 'expected', 'forecast', 'prediction',
]);

// Crypto symbols for context
const CRYPTO_SYMBOLS = new Set([
  'btc', 'bitcoin', 'eth', 'ethereum', 'bnb', 'binance', 'sol', 'solana',
  'xrp', 'ripple', 'ada', 'cardano', 'doge', 'dogecoin', 'dot', 'polkadot',
  'matic', 'polygon', 'avax', 'avalanche', 'link', 'chainlink', 'uni', 'uniswap',
  'atom', 'cosmos', 'ltc', 'litecoin', 'near', 'ftm', 'fantom', 'arb', 'arbitrum',
  'op', 'optimism', 'inj', 'injective', 'sui', 'apt', 'aptos', 'sei',
]);

/**
 * Analyze sentiment of news text
 */
export function analyzeSentiment(text: string): SentimentResult {
  if (!text || text.trim().length === 0) {
    return { sentiment: 'neutral', score: 0, confidence: 0.5 };
  }

  const lowerText = text.toLowerCase();
  const words = lowerText.split(/\s+/);
  
  let bullishScore = 0;
  let bearishScore = 0;
  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;
  
  // Count word matches
  for (const word of words) {
    // Check for multi-word phrases first
    let found = false;
    
    for (const [phrase, weight] of Object.entries(BULLISH_KEYWORDS)) {
      if (phrase.includes(' ') && lowerText.includes(phrase)) {
        bullishScore += weight;
        bullishCount++;
        found = true;
        break;
      } else if (!phrase.includes(' ') && word === phrase) {
        bullishScore += weight;
        bullishCount++;
        found = true;
        break;
      }
    }
    
    if (!found) {
      for (const [phrase, weight] of Object.entries(BEARISH_KEYWORDS)) {
        if (phrase.includes(' ') && lowerText.includes(phrase)) {
          bearishScore += weight;
          bearishCount++;
          found = true;
          break;
        } else if (!phrase.includes(' ') && word === phrase) {
          bearishScore += weight;
          bearishCount++;
          found = true;
          break;
        }
      }
    }
    
    // Count neutral words
    if (NEUTRAL_WORDS.has(word)) {
      neutralCount++;
    }
  }
  
  // Normalize scores
  const totalSignals = bullishCount + bearishCount;
  
  if (totalSignals === 0) {
    return { sentiment: 'neutral', score: 0, confidence: 0.6 };
  }
  
  // Calculate net sentiment
  const avgBullishScore = bullishCount > 0 ? bullishScore / bullishCount : 0;
  const avgBearishScore = bearishCount > 0 ? bearishScore / bearishCount : 0;
  
  // Weight by count
  const bullishWeight = bullishCount / (totalSignals + neutralCount * 0.5);
  const bearishWeight = bearishCount / (totalSignals + neutralCount * 0.5);
  
  // Calculate final score (-1 to +1)
  const rawScore = (avgBullishScore * bullishWeight) - (avgBearishScore * bearishWeight);
  const score = Math.max(-1, Math.min(1, rawScore));
  
  // Calculate confidence based on signal strength and quantity
  const confidence = Math.min(0.95, 0.5 + (totalSignals * 0.05) + (Math.abs(score) * 0.3));
  
  // Determine sentiment label
  let sentiment: SentimentType;
  if (score > 0.15) {
    sentiment = 'bullish';
  } else if (score < -0.15) {
    sentiment = 'bearish';
  } else {
    sentiment = 'neutral';
  }
  
  return { sentiment, score, confidence };
}

/**
 * Extract mentioned crypto symbols from text
 */
export function extractSymbols(text: string): string[] {
  const found = new Set<string>();
  const lowerText = text.toLowerCase();
  const words = lowerText.split(/\s+/);
  
  for (const word of words) {
    // Clean word of punctuation
    const cleanWord = word.replace(/[^a-z]/g, '');
    if (CRYPTO_SYMBOLS.has(cleanWord)) {
      // Map to standard symbol
      const symbol = mapToSymbol(cleanWord);
      if (symbol) found.add(symbol);
    }
  }
  
  // Also check for symbol patterns like BTCUSDT, ETHUSDT
  const symbolPattern = /\b([A-Z]{2,10})USDT?\b/g;
  let match;
  while ((match = symbolPattern.exec(text)) !== null) {
    found.add(match[1]);
  }
  
  return Array.from(found);
}

/**
 * Map common names to standard symbols
 */
function mapToSymbol(name: string): string | null {
  const mapping: Record<string, string> = {
    'btc': 'BTC',
    'bitcoin': 'BTC',
    'eth': 'ETH',
    'ethereum': 'ETH',
    'bnb': 'BNB',
    'binance': 'BNB',
    'sol': 'SOL',
    'solana': 'SOL',
    'xrp': 'XRP',
    'ripple': 'XRP',
    'ada': 'ADA',
    'cardano': 'ADA',
    'doge': 'DOGE',
    'dogecoin': 'DOGE',
    'dot': 'DOT',
    'polkadot': 'DOT',
    'matic': 'MATIC',
    'polygon': 'MATIC',
    'avax': 'AVAX',
    'avalanche': 'AVAX',
    'link': 'LINK',
    'chainlink': 'LINK',
    'uni': 'UNI',
    'uniswap': 'UNI',
    'atom': 'ATOM',
    'cosmos': 'ATOM',
    'ltc': 'LTC',
    'litecoin': 'LTC',
    'near': 'NEAR',
    'ftm': 'FTM',
    'fantom': 'FTM',
    'arb': 'ARB',
    'arbitrum': 'ARB',
    'op': 'OP',
    'optimism': 'OP',
    'inj': 'INJ',
    'injective': 'INJ',
    'sui': 'SUI',
    'apt': 'APT',
    'aptos': 'APT',
    'sei': 'SEI',
  };
  
  return mapping[name] || null;
}

/**
 * Determine article importance based on keywords and patterns
 */
export function determineImportance(title: string, summary: string): 'low' | 'medium' | 'high' | 'critical' {
  const text = (title + ' ' + summary).toLowerCase();
  
  // Critical importance triggers
  const criticalPatterns = [
    /\b(sec|cftc|fed|treasury)\b.*\b(ban|lawsuit|settlement|fine|investigation)\b/,
    /\b(exchange|platform)\b.*\b(hack|exploit|collapse|bankruptcy)\b/,
    /\b(ethereum|bitcoin)\b.*\b(etf|spot etf)\b.*\b(approved|rejected)\b/,
    /\b(halving|upgrade|fork)\b.*\b(bitcoin|btc|ethereum|eth)\b/,
    /\b(all.time.high|ath|record.high)\b/,
    /\b(crash|collapse|bloodbath)\b/,
    /\b(legal.action|class.action|arrest)\b/,
  ];
  
  // High importance triggers
  const highPatterns = [
    /\b(breakout|breaks? (resistance|support))\b/,
    /\b(partnership|acquisition|merger)\b/,
    /\b(listing|delisting)\b/,
    /\b(upgrade|fork|airdrop)\b/,
    /\b(whale|institutional)\b/,
    /\b(regulation|legislation)\b/,
    /\b(bull.run|bear.market)\b/,
  ];
  
  // Medium importance triggers
  const mediumPatterns = [
    /\b(analysis|prediction|forecast)\b/,
    /\b(market|price|volume)\b/,
    /\b(adoption|integration)\b/,
    /\b(launch|release|update)\b/,
  ];
  
  for (const pattern of criticalPatterns) {
    if (pattern.test(text)) return 'critical';
  }
  
  for (const pattern of highPatterns) {
    if (pattern.test(text)) return 'high';
  }
  
  for (const pattern of mediumPatterns) {
    if (pattern.test(text)) return 'medium';
  }
  
  return 'low';
}

/**
 * Categorize article by topic
 */
export function categorizeArticle(title: string, summary: string): string {
  const text = (title + ' ' + summary).toLowerCase();
  
  // Category patterns with priority
  const categories: Array<{ pattern: RegExp; category: string }> = [
    { pattern: /\b(sec|cftc|regulation|legislation|law|court|lawsuit)\b/, category: 'regulation' },
    { pattern: /\b(defi|dex|yield|liquidity|staking|lending)\b/, category: 'defi' },
    { pattern: /\b(nft|collectible|opensea|blur)\b/, category: 'nft' },
    { pattern: /\b(trading|strategy|indicator|analysis)\b/, category: 'trading' },
    { pattern: /\b(bitcoin|btc)\b/, category: 'bitcoin' },
    { pattern: /\b(ethereum|eth)\b/, category: 'ethereum' },
    { pattern: /\b(exchange|binance|coinbase|kraken|bybit|okx)\b/, category: 'exchange' },
    { pattern: /\b(technology|blockchain|protocol|upgrade|fork)\b/, category: 'technology' },
    { pattern: /\b(market|price|rally|crash|surge|drop)\b/, category: 'market' },
    { pattern: /\b(altcoin|altcoins|solana|cardano|xrp|dogecoin)\b/, category: 'altcoins' },
  ];
  
  for (const { pattern, category } of categories) {
    if (pattern.test(text)) return category;
  }
  
  return 'general';
}
