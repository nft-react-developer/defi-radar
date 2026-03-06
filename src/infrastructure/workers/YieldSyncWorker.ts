import cron from "node-cron";
import { db } from "../../db";
import {
  pools,
  yieldSnapshots,
  NewPool,
  NewYieldSnapshot,
} from "../../db/schema";
import { DefiLlamaClient } from "../api/DefiLlamaClient";
import { StableFilter } from "../../domain/services/StableFilter";
import { YieldScorer } from "../../domain/services/YieldScorer";
import { eq, sql } from "drizzle-orm";
import { faker } from "@faker-js/faker";
import { UrlBuilder } from "@/domain/services/UrlBuilder";
import { AlertEngine } from "@/domain/services/AlertEngine";

export class YieldSyncWorker {
  private llama = new DefiLlamaClient();
  private filter = new StableFilter();
  private scorer = new YieldScorer();
  private alertEngine = new AlertEngine();

  // Reducir batch size drásticamente para evitar locks
  private readonly BATCH_SIZE = 10;
  private readonly LOCK_TIMEOUT_MS = 5000;

  start() {
    const interval = process.env.SYNC_INTERVAL_MINUTES || "15";
    cron.schedule(`*/${interval} * * * *`, () => this.sync());
    console.log(`🚀 Worker iniciado (sync cada ${interval} min)`);
  }

  async sync() {
    const start = Date.now();
    try {
      console.log("🔄 Sync iniciado...");
      const allPools = await this.llama.getAllPools();
      const stablePools = this.filter.filter(allPools);
      const scored = this.scorer.score(stablePools);

      console.log(`📊 Procesando ${scored.length} pools estables...`);

      // Procesar uno por uno o en batches muy pequeños para evitar locks
      for (let i = 0; i < scored.length; i += this.BATCH_SIZE) {
        const batch = scored.slice(i, i + this.BATCH_SIZE);
        await this.processBatchSafe(batch);

        // Pequeña pausa entre batches para liberar presión en la DB
        if (i + this.BATCH_SIZE < scored.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      // Insertar snapshots históricos
      await this.saveSnapshots(scored);

      console.log("🔔 Evaluando alertas...");
      await this.alertEngine.analyzePools(scored);

      console.log(
        `✅ Sync completado: ${scored.length} pools en ${Date.now() - start}ms`,
      );

      // Cleanup de datos antiguos (>90 días)
      await this.cleanupOldData();
    } catch (error) {
      console.error("❌ Error en sync:", error);
    }
  }

  private async processBatchSafe(scoredPools: any[]) {
    // Usar INSERT ... ON DUPLICATE KEY UPDATE (atómico, no requiere transacción larga)
    for (const pool of scoredPools) {
      try {
        await this.upsertPoolAtomic(pool);
      } catch (error: any) {
        if (error.code === "ER_LOCK_WAIT_TIMEOUT") {
          console.warn(`⏱️ Timeout en pool ${pool.pool}, reintentando...`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          try {
            await this.upsertPoolAtomic(pool);
          } catch (retryError) {
            console.error(
              `❌ Fallo definitivo en pool ${pool.pool}`,
              retryError,
            );
          }
        } else {
          console.error(`❌ Error en pool ${pool.pool}:`, error.message);
        }
      }
    }
  }

  private async upsertPoolAtomic(pool: any) {
    const poolData = {
      poolId: pool.pool,
      chain: pool.chain,
      project: pool.project,
      symbol: pool.symbol,
      url: UrlBuilder.build(
        pool.project,
        pool.chain,
        pool.poolMeta,
        pool.underlyingTokens,
        pool.pool,
      )?.trim(),
      tvlUsd: String(pool.tvlUsd),
      apyBase: pool.apyBase ? String(pool.apyBase) : null,
      apyReward: pool.apyReward ? String(pool.apyReward) : null,
      apy: String(pool.apy),
      stablecoin: true,
      ilRisk: pool.ilRisk,
      riskScore:
        pool.riskLevel === "LOW" ? 3 : pool.riskLevel === "MEDIUM" ? 6 : 9,
    };

    try {
      // Intentar insertar primero
      await db.insert(pools).values({
        ...poolData,
        id: faker.string.uuid(),
      });
    } catch (error: any) {
      // Si falla por duplicate key, hacer update
      if (
        error.cause.code === "ER_DUP_ENTRY" ||
        error.cause.message?.includes("Duplicate")
      ) {
        await db
          .update(pools)
          .set({
            tvlUsd: poolData.tvlUsd,
            apy: poolData.apy,
            apyBase: poolData.apyBase,
            apyReward: poolData.apyReward,
            url: poolData.url,
            updatedAt: new Date(),
          })
          .where(eq(pools.poolId, pool.pool));
        return null;
      } else {
        throw error;
      }
    }
  }

  private async saveSnapshots(scoredPools: any[]) {
    const snapshots: NewYieldSnapshot[] = scoredPools.map((pool) => ({
      poolId: pool.pool,
      apy: String(pool.apy),
      tvlUsd: String(pool.tvlUsd),
    }));

    // Batch insert (Drizzle soporta insert many)
    if (snapshots.length > 0) {
      await db.insert(yieldSnapshots).values(snapshots);
    }
  }

  private async cleanupOldData() {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // Drizzle no tiene delete con where date < X fácil, usamos SQL raw
    await db.execute(
      sql`DELETE FROM yield_snapshots WHERE ts < ${ninetyDaysAgo}`,
    );

    console.log("🧹 Datos antiguos limpiados (>90 días)");
  }
}
