import axios from 'axios';
import { PoolMetadata } from '@domain/entities/Pool';

export class DefiLlamaClient {
  private readonly baseUrl = 'https://yields.llama.fi';
  private readonly http = axios.create({
    baseURL: this.baseUrl,
    timeout: 10000,
  });

  async getAllPools(): Promise<PoolMetadata[]> {
    const { data } = await this.http.get('/pools');
    return data.data;
  }

  async getChart(poolId: string): Promise<any> {
    const { data } = await this.http.get(`/chart/${poolId}`);
    return data.data;
  }
}