import express from "express";
import cors from "cors";
import { db } from "../../db";
import { pools, yieldSnapshots, alerts } from "../../db/schema";
import { eq, and, gte, desc, sql, lt } from "drizzle-orm";
import { TelegramService } from "@/infrastructure/notifications/TelegramService";
import { faker } from "@faker-js/faker";

const app = express();
app.use(cors());
app.use(express.json());

// GET /api/yields/top
app.get("/api/yields/top", async (req, res) => {
  try {
    const {
      chain,
      minTvl = 100000,
      limit = 20,
      riskLevel,
      project, // Nuevo filtro opcional por protocolo
    } = req.query;

    let conditions = [
      eq(pools.stablecoin, true),
      gte(pools.tvlUsd, String(minTvl)),
    ];

    if (chain) conditions.push(eq(pools.chain, String(chain)));
    if (project) conditions.push(eq(pools.project, String(project)));

    if (riskLevel) {
      if (riskLevel === "LOW") conditions.push(lt(pools.riskScore, 4));
      else if (riskLevel === "MEDIUM")
        conditions.push(and(gte(pools.riskScore, 4), lt(pools.riskScore, 7)));
      else conditions.push(gte(pools.riskScore, 7));
    }

    const results = await db
      .select({
        poolId: pools.poolId,
        chain: pools.chain,
        project: pools.project,
        symbol: pools.symbol,
        url: pools.url, // <-- URL incluida explícitamente
        tvlUsd: pools.tvlUsd,
        apy: pools.apy,
        apyBase: pools.apyBase,
        apyReward: pools.apyReward,
        riskScore: pools.riskScore,
        ilRisk: pools.ilRisk,
        updatedAt: pools.updatedAt,
      })
      .from(pools)
      .where(and(...conditions))
      .orderBy(desc(pools.apy))
      .limit(Number(limit));

    // Enriquecer con delta de 24h
    const enriched = await Promise.all(
      results.map(async (pool) => {
        const snapshot24h = await db
          .select({ apy: yieldSnapshots.apy })
          .from(yieldSnapshots)
          .where(eq(yieldSnapshots.poolId, pool.poolId))
          .orderBy(desc(yieldSnapshots.timestamp))
          .offset(96) // Aprox 24h si guardamos cada 15min
          .limit(1);

        const currentApy = Number(pool.apy);
        const previousApy =
          snapshot24h.length > 0 ? Number(snapshot24h[0].apy) : currentApy;
        const apyDelta24h =
          previousApy > 0
            ? Number(
                (((currentApy - previousApy) / previousApy) * 100).toFixed(2),
              )
            : 0;

        return {
          ...pool,
          tvlUsd: Number(pool.tvlUsd),
          apy: currentApy,
          apyBase: pool.apyBase ? Number(pool.apyBase) : null,
          apyReward: pool.apyReward ? Number(pool.apyReward) : null,
          apyDelta24h,
          // Agregar flag para saber si el link es directo o genérico
          hasDirectLink: !!pool.url && pool.url !== "",
        };
      }),
    );

    res.json({
      count: enriched.length,
      timestamp: new Date().toISOString(),
      data: enriched,
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/yields/:id/redirect - Redirigir directo al protocolo
app.get("/api/yields/:id/redirect", async (req, res) => {
  try {
    const { id } = req.params;

    const pool = await db
      .select({ url: pools.url, project: pools.project })
      .from(pools)
      .where(eq(pools.poolId, id))
      .limit(1);

    if (!pool.length || !pool[0].url) {
      return res.status(404).json({
        error: "URL not found",
        message: `No direct link available for ${id}. Try searching ${pool[0]?.project || "the protocol"} manually.`,
      });
    }

    // Opción A: Redirigir directo (mejor UX)
    return res.redirect(pool[0].url);

    // Opción B: Devolver la URL y dejar que el frontend decida
    // return res.json({ url: pool[0].url });
  } catch (error) {
    res.status(500).json({ error: "Error fetching URL" });
  }
});

// GET /api/yields/:id/history
app.get("/api/yields/:id/history", async (req, res) => {
  try {
    const { id } = req.params;
    const { range = "7d" } = req.query;

    const days =
      { "1d": 1, "7d": 7, "30d": 30, "90d": 90 }[range as string] || 7;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const history = await db.execute(sql`
      SELECT 
        DATE_FORMAT(ts, '%Y-%m-%d %H:00:00') as hour,
        AVG(apy) as avgApy,
        AVG(tvl_usd) as avgTvl,
        MIN(apy) as minApy,
        MAX(apy) as maxApy,
        COUNT(*) as samples
      FROM yield_snapshots
      WHERE pool_id = ${id}
        AND ts >= ${startDate}
      GROUP BY DATE_FORMAT(ts, '%Y-%m-%d %H:00:00')
      ORDER BY hour ASC
    `);

    res.json({
      poolId: id,
      range,
      data: history[0],
    });
  } catch (error) {
    res.status(500).json({ error: "Error fetching history" });
  }
});

// GET /api/chains - Listar chains disponibles (útil para filtros frontend)
app.get("/api/chains", async (req, res) => {
  try {
    const chains = await db
      .select({ chain: pools.chain })
      .from(pools)
      .where(eq(pools.stablecoin, true))
      .groupBy(pools.chain);

    res.json(chains.map((c) => c.chain));
  } catch (error) {
    res.status(500).json({ error: "Error fetching chains" });
  }
});

// Health check
app.get("/health", async (req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({
      status: "ok",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: "error",
      database: "disconnected",
    });
  }
});

// Crear alerta personalizada
app.post("/api/alerts", async (req, res) => {
  try {
    const { condition, threshold, poolId, active = true } = req.body;

    const newAlert = await db.insert(alerts).values({
      id: faker.string.uuid(),
      poolId: poolId || "*", // * = todas las pools
      condition,
      threshold: String(threshold),
      active,
    });

    res.json({ success: true, alert: newAlert });
  } catch (error) {
    res.status(500).json({ error: "Error creando alerta" });
  }
});

// Listar alertas
app.get("/api/alerts", async (req, res) => {
  try {
    const allAlerts = await db
      .select()
      .from(alerts)
      .orderBy(desc(alerts.createdAt));
    res.json(allAlerts);
  } catch (error) {
    res.status(500).json({ error: "Error obteniendo alertas" });
  }
});

// Desactivar alerta
app.patch("/api/alerts/:id", async (req, res) => {
  try {
    const { active } = req.body;
    await db.update(alerts).set({ active }).where(eq(alerts.id, req.params.id));

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error actualizando alerta" });
  }
});

// Test de Telegram (para verificar que funciona)
app.post("/api/test-alert", async (req, res) => {
  try {
    console.log("🔔 Enviando alerta de prueba a Telegram...");
    const telegram = new TelegramService();
    const success = await telegram.sendAlert(
      telegram.formatYieldAlert({
        project: "Test Protocol",
        symbol: "USDC",
        chain: "Ethereum",
        apy: 18.5,
        apyDelta24h: 25,
        tvlUsd: 5_000_000,
        url: "https://example.com",
        riskLevel: "LOW",
      }),
    );

    res.json({
      success,
      message: success ? "Mensaje enviado" : "Fallo el envío",
    });
  } catch (error) {
    res.status(500).json({ error: "Error en test" });
  }
});

export { app };
