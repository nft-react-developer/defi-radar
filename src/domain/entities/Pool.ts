export interface PoolMetadata {
  pool: string;           // ID único DeFiLlama
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apyBase?: number;
  apyReward?: number;
  apy: number;
  rewardTokens?: string[];
  underlyingTokens?: string[];
  poolMeta?: string;      // Info extra (maturity, leverage, etc)
  exposure?: string;      // single, multi, etc
}

export interface StablePool extends PoolMetadata {
  isStable: true;
  stableAssets: string[]; // ['USDC', 'USDT']
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  ilRisk: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
}