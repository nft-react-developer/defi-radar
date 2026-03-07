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

const SERIOUS_TOKENS: Record<string, string[]> = {
  ethereum: [
    "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
    "0xa0b86a33e677680c4de89a56e0e4b1a5f5e8e0b8", // USDC (Mainnet)
    "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
  ],
  arbitrum: [
    "0xaf88d065e77c8cc2239327c5edb3a432268e5831", // USDC Nativo
    "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", // USDT
    "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", // DAI
  ],
  base: [
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC
    "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", // USDT
    "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", // DAI
  ],
};

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
      .filter(
        (p) =>
          p.chain &&
          process.env.SUPPORTED_CHAINS?.split(",")?.includes(
            p.chain.toUpperCase(),
          ),
      )
      .filter((p) => {
        if (!p.chain) return false;

        const chainKey = p.chain.toLowerCase();
        const seriousAddress = SERIOUS_TOKENS[chainKey];

        // Si no tenemos lista para esta chain, rechazar (precaución)
        if (!seriousAddress) return false;

        // Verificar underlyingTokens
        if (!p.underlyingTokens || p.underlyingTokens.length === 0) {
          // Si no hay underlyingTokens, fallback a verificación por símbolo
          return this.isSeriousSymbolOnly(p.symbol);
        }

        // Todos los tokens del pool deben ser serios
        const allSerious = p.underlyingTokens.every((addr) =>
          seriousAddress.includes(addr.toLowerCase()),
        );

        return allSerious;
      })
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

  // Fallback si DeFiLlama no provee underlyingTokens
  private isSeriousSymbolOnly(symbol: string): boolean {
    const seriousSymbols = ["USDC", "USDT", "DAI", "PYUSD", "USDS", "LUSD"];
    const tokens = symbol.toUpperCase().split(/[-\/\s]+/);
    return tokens.every((t) => seriousSymbols.includes(t.replace(/\.E$/i, "")));
  }
}
