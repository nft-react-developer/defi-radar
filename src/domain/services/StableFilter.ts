import { PoolMetadata, StablePool } from "@domain/entities/Pool";

// Lista amplia de stablecoins reconocidas
const STABLE_COINS = [
  "USDC",
  "USDT",
  "DAI",
  "BUSD",
  "USDCE",
  "USDT.E",
  "DAI.E", // Bridged versions
  "PYUSD",
];

export class StableFilter {
  private isStableSymbol(symbol: string): boolean {
    const upper = symbol.toUpperCase();
    // Detecta símbolos como "USDC-USDT" o "USDC/USDT" o "aUSDC"
    const tokens = upper.split(/[-\/\s]+/);
    return tokens.every((t) => {
      const clean = t.replace(/^[acvx]|V2|V3$/i, "");
      return STABLE_COINS.includes(clean);
    });
  }

  private calculateIlRisk(symbol: string): StablePool["ilRisk"] {
    const stables = symbol.toUpperCase().split(/[-\/\s]+/).length;
    if (stables === 1) return "NONE"; // Single sided
    if (stables === 2) return "LOW"; // Stable pair
    return "MEDIUM"; // Multi-stable
  }

  filter(pools: PoolMetadata[]): StablePool[] {
    return pools
      .filter((p) => this.isStableSymbol(p.symbol))
      .map((p) => ({
        ...p,
        isStable: true,
        stableAssets: this.extractStables(p.symbol),
        riskLevel: this.calculateRisk(p),
        ilRisk: this.calculateIlRisk(p.symbol),
      }));
  }

  private extractStables(symbol: string): string[] {
    return symbol
      .toUpperCase()
      .split(/[-\/\s]+/)
      .map((s) => s.replace(/^[acvx]|V2|V3$/i, ""))
      .filter((s) => STABLE_COINS.includes(s));
  }

  private calculateRisk(pool: PoolMetadata): StablePool["riskLevel"] {
    // Lógica simple: mientras más TVL y más base APY (no inflacionario), menor riesgo
    if (
      pool.tvlUsd > 100_000_000 &&
      (pool.apyBase || 0) > (pool.apyReward || 0)
    ) {
      return "LOW";
    }
    if (pool.tvlUsd > 10_000_000) return "MEDIUM";
    return "HIGH";
  }
}
