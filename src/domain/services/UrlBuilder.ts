export class UrlBuilder {
  private static explorers: Record<string, string> = {
    Ethereum: "etherscan.io",
    Arbitrum: "arbiscan.io",
    Optimism: "optimistic.etherscan.io",
    Base: "basescan.org",
    Polygon: "polygonscan.com",
    Avalanche: "snowtrace.io",
    BSC: "bscscan.com",
    Fantom: "ftmscan.com",
    Metis: "andromeda-explorer.metis.io",
    Scroll: "scrollscan.com",
    Linea: "lineascan.build",
    Mantle: "mantlescan.info",
  };

  static build(
    project: string,
    chain: string,
    poolMeta: string | undefined,
    underlyingTokens: string[] | undefined,
    poolId?: string,
  ): string | null {
    // const normalizedProject = project.toLowerCase().replace(/[-_]/g, "");
    // const chainLower = chain.toLowerCase();

    // // Intentar obtener address del pool
    // const rawAddress = underlyingTokens?.[0] || poolMeta;
    // const address = rawAddress?.trim(); // <-- AGREGAR ESTO

    // // Builders por protocolo (agregados los faltantes)
    // const builders: Record<string, () => string | null> = {
    //   // Protocolos principales
    //   aave: () => this.aaveUrl(chainLower, address),
    //   aavev3: () => this.aaveUrl(chainLower, address),
    //   aavev2: () => this.aaveUrl(chainLower, address),
    //   compound: () =>
    //     `https://app.compound.finance/?market=${chainLower}-${address}`,
    //   uniswap: () => this.uniswapUrl(chainLower, address),
    //   uniswapv3: () => this.uniswapUrl(chainLower, address),
    //   uniswapv4: () => this.uniswapUrl(chainLower, address),
    //   curve: () =>
    //     `https://curve.fi/#/${chainLower}/pools/${poolMeta || address}`,
    //   convexfinance: () => "https://www.convexfinance.com/stake",
    //   convex: () => "https://www.convexfinance.com/stake",
    //   yearnfinance: () =>
    //     `https://yearn.fi/v3/#/vaults/${chainLower}/${address}`,
    //   yearn: () => `https://yearn.fi/v3/#/vaults/${chainLower}/${address}`,
    //   lido: () => "https://stake.lido.fi/",
    //   rocketpool: () => "https://stake.rocketpool.net/",
    //   makerdao: () => "https://oasis.app/",
    //   pendle: () =>
    //     `https://app.pendle.finance/trade/pools?chain=${chainLower}`,
    //   gmx: () => "https://app.gmx.io/#/earn",
    //   dydx: () => "https://dydx.exchange/portfolio/overview",
    //   synthetix: () => "https://staking.synthetix.io/",

    //   // Nuevos protocolos de los logs
    //   balancerv2: () =>
    //     `https://balancer.fi/pools/${chainLower}/${address || poolMeta}`,
    //   balancer: () =>
    //     `https://balancer.fi/pools/${chainLower}/${address || poolMeta}`,
    //   sushiswap: () => `https://www.sushi.com/pool/${chainLower}/${address}`,
    //   sushiswapv3: () => `https://www.sushi.com/pool/${chainLower}/${address}`,
    //   euler: () => `https://app.euler.finance/?market=${address}`,
    //   eulerv2: () => `https://app.euler.finance/?market=${address}`,
    //   silo: () => `https://app.silo.finance/silo/${address}`,
    //   silov2: () => `https://app.silo.finance/silo/${address}`,
    //   goldfinch: () => "https://app.goldfinch.finance/pools",
    //   clearpool: () => "https://app.clearpool.finance/",
    //   clearpoollending: () => "https://app.clearpool.finance/",
    //   gainsnetwork: () => "https://gains.trade/",
    //   deltaprime: () => "https://app.deltaprime.io/",
    //   traderjoe: () => `https://lfj.gg/${chainLower}/pool/${address}`,
    //   joe: () => `https://lfj.gg/${chainLower}/pool/${address}`,
    //   joev21: () => `https://lfj.gg/${chainLower}/pool/${address}`,
    //   aerodrome: () =>
    //     `https://aerodrome.finance/deposit?token0=${underlyingTokens?.[0]}&token1=${underlyingTokens?.[1]}`,
    //   aerodromeslipstream: () => `https://aerodrome.finance/deposit`,
    //   tenderfinance: () => "https://app.tender.fi/",
    //   nablafinance: () => "https://app.nabla.fi/",
    //   avantis: () => "https://avantisfi.com/",
    //   usdai: () => "https://usds.money/",
    //   singularityfinance: () => "https://app.singularitydao.ai/",
    //   lendle: () => "https://app.lendle.xyz/",
    //   lendlepooledmarkets: () => "https://app.lendle.xyz/",
    //   peapods: () => "https://peapods.finance/",
    //   peapodsfinance: () => "https://peapods.finance/",
    //   fusionbyipor: () => "https://app.ipor.io/",
    //   ipor: () => "https://app.ipor.io/",
    //   accountable: () => "https://accountable.capital/",
    //   kiloex: () => "https://app.kiloex.io/",
    // };

    // const builder = builders[normalizedProject];
    // if (builder) {
    //   try {
    //     const url = builder ? builder() : null;
    //     return url ? url.trim() : null;
    //   } catch (e) {
    //     // Si falla el builder específico, continuar al fallback
    //     return null;
    //   }
    // }

    // // Fallback: Si tenemos address, mandar al explorer de la chain
    // if (address && this.isAddress(address)) {
    //   const explorer = this.explorers[chain] || "etherscan.io";
    //   return `https://${explorer}/address/${address}`;
    // }

    if (poolId) {
      return `https://defillama.com/yields/pool/${poolId}`;
    }

    // No se pudo generar URL
    return null;
  }

  private static aaveUrl(
    chain: string,
    token: string | undefined,
  ): string | null {
    if (!token) return "https://app.aave.com/";
    const markets: Record<string, string> = {
      ethereum: "mainnet",
      arbitrum: "arbitrum",
      optimism: "optimism",
      polygon: "polygon",
      avalanche: "avalanche",
      base: "base",
      metis: "metis",
      scroll: "scroll",
    };
    const market = markets[chain] || "mainnet";
    return `https://app.aave.com/reserve-overview/?underlyingAsset=${token.toLowerCase()}&marketName=proto_${market}_v3`;
  }

  private static uniswapUrl(
    chain: string,
    poolAddress: string | undefined,
  ): string | null {
    if (!poolAddress) return "https://app.uniswap.org/";
    const chains: Record<string, string> = {
      ethereum: "ethereum",
      arbitrum: "arbitrum",
      optimism: "optimism",
      polygon: "polygon",
      base: "base",
      celo: "celo",
      bsc: "bnb",
    };
    return `https://app.uniswap.org/explore/pools/${chains[chain] || "ethereum"}/${poolAddress}`;
  }

  private static isAddress(str: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(str);
  }
}
