import { StablePool } from '@domain/entities/Pool';

export interface ScoredPool extends StablePool {
  score: number;
  metrics: {
    tvlScore: number;      // 0-100
    sustainabilityScore: number; // Basado en % de rewards vs base
    longevityScore: number; // Basado en historia del protocolo (si tenemos DB)
  };
}

export class YieldScorer {
  score(pools: StablePool[]): ScoredPool[] {
    const maxTvl = Math.max(...pools.map(p => p.tvlUsd));
    
    return pools.map(pool => {
      const tvlScore = Math.min((pool.tvlUsd / maxTvl) * 100, 100);
      
      // Preferimos yields base sobre rewards inflacionarios
      const totalApy = pool.apy || 0;
      const baseApy = pool.apyBase || 0;
      const sustainabilityScore = totalApy > 0 
        ? (baseApy / totalApy) * 100 
        : 0;

      // Score compuesto: 40% APY, 30% TVL, 30% Sostenibilidad
      const score = (
        (Math.min(pool.apy, 20) * 2) + // Cap en 20% APY para score
        (tvlScore * 0.3) +
        (sustainabilityScore * 0.3)
      );

      return {
        ...pool,
        score,
        metrics: {
          tvlScore,
          sustainabilityScore,
          longevityScore: 50, // Placeholder hasta tener histórico
        }
      };
    }).sort((a, b) => b.score - a.score);
  }
}