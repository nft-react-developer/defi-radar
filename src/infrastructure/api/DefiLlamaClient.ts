import axios from "axios";
import { PoolMetadata } from "@domain/entities/Pool";
import { UrlBuilder } from "@/domain/services/UrlBuilder";

export class DefiLlamaClient {
  private readonly baseUrl = "https://yields.llama.fi";
  private readonly http = axios.create({
    baseURL: this.baseUrl,
    timeout: 10000,
  });

  async getAllPools(): Promise<PoolMetadata[]> {
    const { data } = await this.http.get("/pools");
    return data.data.map((pool: PoolMetadata) => {
      return {
        ...pool,
        url: (pool.url = this.buildPoolUrl(pool)),
      };
    });
  }
  buildPoolUrl(pool: PoolMetadata): string {
    return (
      UrlBuilder.build(
        pool.project,
        pool.chain,
        pool.poolMeta,
        pool.underlyingTokens,
        pool.pool,
      )?.trim() || `https://defillama.com/yields/pool/${pool.pool}`
    );
  }

  async getChart(poolId: string): Promise<any> {
    const { data } = await this.http.get(`/chart/${poolId}`);
    return data.data;
  }
}
