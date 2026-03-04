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
import { faker } from "@faker-js/faker/.";

export class YieldSyncWorker {
  private llama = new DefiLlamaClient();
  private filter = new StableFilter();
  private scorer = new YieldScorer();
  private batchSize = 50;

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

      // Procesar en batches para no saturar la DB
      for (let i = 0; i < scored.length; i += this.batchSize) {
        const batch = scored.slice(i, i + this.batchSize);
        await this.processBatch(batch);
      }

      // Insertar snapshots históricos
      await this.saveSnapshots(scored);

      console.log(
        `✅ Sync completado: ${scored.length} pools en ${Date.now() - start}ms`,
      );

      // Cleanup de datos antiguos (>90 días)
      await this.cleanupOldData();
    } catch (error) {
      console.error("❌ Error en sync:", error);
    }
  }

  private async processBatch(scoredPools: any[]) {
    // Drizzle no tiene bulk upsert nativo, hacemos uno por uno en una transaction
    await db.transaction(async (tx) => {
      for (const pool of scoredPools) {
        const poolData: NewPool = {
          id: faker.string.uuid(),
          poolId: pool.pool,
          chain: pool.chain,
          project: pool.project,
          symbol: pool.symbol,
          tvlUsd: String(pool.tvlUsd),
          apyBase: pool.apyBase ? String(pool.apyBase) : null,
          apyReward: pool.apyReward ? String(pool.apyReward) : null,
          apy: String(pool.apy),
          stablecoin: true,
          ilRisk: pool.ilRisk,
          riskScore:
            pool.riskLevel === "LOW" ? 3 : pool.riskLevel === "MEDIUM" ? 6 : 9,
        };

        // Upsert manual: intentar update, si no existe insert
        const existing = await tx
          .select({ id: pools.id })
          .from(pools)
          .where(eq(pools.poolId, pool.pool))
          .limit(1);

        if (existing.length > 0) {
          const updateResult = await tx
            .update(pools)
            .set({
              tvlUsd: poolData.tvlUsd,
              apy: poolData.apy,
              apyBase: poolData.apyBase,
              apyReward: poolData.apyReward,
              updatedAt: new Date(),
            })
            .where(eq(pools.poolId, pool.pool));
          console.log("Filas actualizadas:", updateResult[0].affectedRows);
        } else {
          const result = await tx.insert(pools).values(poolData);
          console.log("ID insertado:", result[0].insertId);
          console.log("Filas insertadas:", result[0].affectedRows);
        }
      }
    });
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
      sql`DELETE FROM yield_snapshots WHERE timestamp < ${ninetyDaysAgo}`,
    );

    console.log("🧹 Datos antiguos limpiados (>90 días)");
  }
}
