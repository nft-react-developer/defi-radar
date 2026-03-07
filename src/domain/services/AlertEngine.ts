import { db } from "../../db";
import { pools, yieldSnapshots, alerts } from "../../db/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { TelegramService } from "../../infrastructure/notifications/TelegramService";
import { randomUUID } from "crypto";
import { ScoredPool } from "./YieldScorer";
import {
  AnalyticsEngine,
  VolatilityMetrics,
  volatilityTrendDaysEnum,
} from "./AnalyticsEngine";

// Configuración desde variables de entorno o defaults
const CONFIG = {
  COOLDOWN_HOURS: Number(process.env.ALERT_COOLDOWN_HOURS) || 4,
  MIN_TVL_FOR_OPPORTUNITY: Number(process.env.MIN_TVL_FOR_ALERT) || 20_000_000, // $20M
  TVL_DROP_THRESHOLD: Number(process.env.TVL_DROP_THRESHOLD) || 0.2, // 20%
  SIGNIFICANT_CHANGE_THRESHOLD: 0.5, // Si cambia 50% más, ignorar cooldown
  MIN_POOL_AGE_DAYS: 3, // Pools con menos de 3 días son sospechosos
};

export class AlertEngine {
  private telegram = new TelegramService();

  /**
   * Método principal: analiza todos los pools y decide si alertar
   */
  async analyzePools(currentPools: ScoredPool[]) {
    console.log(`🔔 Analizando ${currentPools.length} pools...`);

    // Instanciar analytics
    const analytics = new AnalyticsEngine();
    const stats = { opportunities: 0, risks: 0, skipped: 0, volatile: 0 };

    for (const pool of currentPools) {
      try {
        // 1. Validar calidad básica
        const quality = await this.validateQuality(pool);
        if (!quality.isValid && quality.severity !== "CRITICAL") {
          console.log(`⏭️  Pool ${pool.pool} descartado: ${quality.reason}`);
          stats.skipped++;
          continue;
        }

        // 2. NUEVO: Calcular volatilidad (máx 30 días)
        console.log(`📊 Analizando volatilidad de ${pool.pool}...`);
        const volatility = await analytics.calculateVolatility(
          pool.pool,
          volatilityTrendDaysEnum.MEDIUM,
        );

        // Filtrar pools muy volátiles (CV > 0.6 = montaña rusa)
        if (volatility.coefficientOfVariation > 0.6) {
          console.log(
            `📉 Pool ${pool.pool} muy volátil (CV: ${volatility.coefficientOfVariation}), ignorando`,
          );
          stats.volatile++;
          continue;
        }
        console.log(
          `📈 ${pool.pool}: CV=${volatility.coefficientOfVariation}, 
            Score=${volatility.reliabilityScore}, 
            Trend=${volatility.trend}`,
        );

        // 3. Detectar riesgos (TVL cayendo)
        const risk = await this.detectRisk(pool);
        if (risk.isRisk) {
          const shouldSend = await this.shouldAlert(
            pool.pool,
            "TVL_DROP",
            risk.severity,
            pool.apy,
          );

          if (shouldSend) {
            await this.sendRiskAlert(pool, risk, volatility);
            stats.risks++;
          }
          continue;
        }

        // 4. Detectar oportunidades (ahora con filtro de volatilidad)
        // Ajustamos: si es estable (CV < 0.3) y APY > 8, ya es bueno
        // Si es moderado (CV 0.3-0.6), requiere APY más alto (>15)
        const isStable = volatility.coefficientOfVariation < 0.3;
        const apyThreshold = isStable ? 8 : 15;

        if (
          Number(pool.apy) > apyThreshold &&
          volatility.reliabilityScore > 60
        ) {
          const shouldSend = await this.shouldAlert(
            pool.pool,
            "APY_ABOVE",
            isStable ? "HIGH" : "MEDIUM", // Menos urgente si es volátil
            pool.apy,
          );

          if (shouldSend) {
            await this.sendOpportunityAlert(pool, quality, volatility);
            stats.opportunities++;
          }
        }
      } catch (error) {
        console.error(`❌ Error analizando pool ${pool.pool}:`, error);
      }
    }

    console.log(
      `📊 Resumen: ${stats.opportunities} oportunidades, 
        ${stats.risks} riesgos, 
        ${stats.volatile} muy volátiles, 
        ${stats.skipped} descartados`,
    );
  }

  /**
   * Cooldown inteligente: verifica si debemos alertar o es spam
   * Retorna true si se debe enviar la alerta
   */
  private async shouldAlert(
    poolId: string,
    condition: "APY_ABOVE" | "APY_BELOW" | "TVL_DROP" | "DELTA_SPIKE",
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
    currentApy?: number,
  ): Promise<boolean> {
    // Buscar última alerta de este tipo para este pool
    const lastAlert = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.poolId, poolId),
          eq(alerts.condition, condition), // Cambiado: condition en lugar de conditionType
          eq(alerts.active, true),
        ),
      )
      .orderBy(desc(alerts.lastTriggered))
      .limit(1);

    if (lastAlert.length === 0) return true; // Nunca alertamos, enviar

    const lastTime = lastAlert[0].lastTriggered;
    if (!lastTime) return true;

    const hoursSince = (Date.now() - lastTime.getTime()) / (1000 * 60 * 60);

    // Riesgos críticos siempre alertan (pero con throttle de 1 hora)
    if (condition === "TVL_DROP" && severity === "CRITICAL") {
      return hoursSince >= 1;
    }

    // Cooldown normal de 4 horas
    if (hoursSince < CONFIG.COOLDOWN_HOURS) {
      // Excepción: Si el APY cambió significativamente (>50% adicional), alertar igual
      if (currentApy && lastAlert[0].threshold) {
        const lastApy = parseFloat(lastAlert[0].threshold);
        const changePercent = Math.abs(currentApy - lastApy) / lastApy;

        if (changePercent > CONFIG.SIGNIFICANT_CHANGE_THRESHOLD) {
          console.log(
            `⚡ Cambio significativo detectado en ${poolId}: ${(changePercent * 100).toFixed(0)}%`,
          );
          return true;
        }
      }

      console.log(
        `⏱️ Cooldown activo para ${poolId} (${condition}): ${hoursSince.toFixed(1)}h`,
      );
      return false;
    }

    return true;
  }

  /**
   * Valida calidad del pool para evitar falsos positivos
   * Retorna score 0-100 y motivo si es inválido
   */
  private async validateQuality(pool: any): Promise<{
    isValid: boolean;
    score: number;
    reason?: string;
    severity?: "LOW" | "CRITICAL";
  }> {
    const tvl = Number(pool.tvlUsd) || 0;
    const apy = Number(pool.apy) || 0;
    let score = 100;

    // Filtro 1: TVL mínimo para oportunidades
    if (tvl < CONFIG.MIN_TVL_FOR_OPPORTUNITY) {
      return {
        isValid: false,
        score: 0,
        reason: `TVL muy bajo: $${(tvl / 1000).toFixed(0)}K < $${(CONFIG.MIN_TVL_FOR_OPPORTUNITY / 1000000).toFixed(1)}M`,
        severity: "LOW",
      };
    }

    // Filtro 2: APY sospechosamente alto (posible trampa)
    if (apy > 100) {
      score -= 50;
      // No descartamos pero bajamos score
    }

    // Filtro 3: Antigüedad del pool (evitar scams nuevos)
    const ageDays = await this.getPoolAge(pool.poolId);
    if (ageDays < CONFIG.MIN_POOL_AGE_DAYS) {
      score -= 30;
      if (apy > 50) {
        return {
          isValid: false,
          score: 0,
          reason: `Pool nuevo (${ageDays} días) con APY sospechoso (${apy}%)`,
          severity: "CRITICAL",
        };
      }
    }

    // Filtro 4: Ratio APY/TVL (APY alto pero TVL bajando = peligro)
    const tvlChange = await this.calculateTvlChange(pool.poolId, 24);
    if (apy > 20 && tvlChange < -0.1) {
      return {
        isValid: false,
        score: 0,
        reason: `APY alto (${apy}%) pero TVL cayendo (${(tvlChange * 100).toFixed(0)}%)`,
        severity: "CRITICAL",
      };
    }

    return { isValid: score >= 50, score };
  }

  /**
   * Detecta riesgos: caídas de TVL, exploits, fugas de capital
   */
  private async detectRisk(pool: any): Promise<{
    isRisk: boolean;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    reason: string;
    tvlChange24h: number;
  }> {
    const tvlChange24h = await this.calculateTvlChange(pool.poolId, 24);
    const tvlChange1h = await this.calculateTvlChange(pool.poolId, 1);

    // Riesgo Crítico: Caída masiva de TVL (exploit o rug pull)
    if (tvlChange24h < -CONFIG.TVL_DROP_THRESHOLD) {
      return {
        isRisk: true,
        severity: "CRITICAL",
        reason: `TVL cayó ${(tvlChange24h * 100).toFixed(0)}% en 24h`,
        tvlChange24h,
      };
    }

    // Riesgo Alto: Caída acelerada (>10% en 1 hora)
    if (tvlChange1h < -0.1) {
      return {
        isRisk: true,
        severity: "HIGH",
        reason: `TVL cayendo rápido: ${(tvlChange1h * 100).toFixed(0)}% en 1h`,
        tvlChange24h,
      };
    }

    // Riesgo Medio: Tendencia bajista sostenida
    if (tvlChange24h < -0.05 && tvlChange1h < -0.02) {
      return {
        isRisk: true,
        severity: "MEDIUM",
        reason: `Tendencia bajista: ${(tvlChange24h * 100).toFixed(0)}% en 24h`,
        tvlChange24h,
      };
    }

    return { isRisk: false, severity: "LOW", reason: "", tvlChange24h };
  }

  /**
   * Calcula cambio porcentual de TVL en las últimas N horas
   */
  private async calculateTvlChange(
    poolId: string,
    hours: number,
  ): Promise<number> {
    try {
      const snapshots = await db
        .select({
          tvlUsd: yieldSnapshots.tvlUsd,
          ts: yieldSnapshots.timestamp,
        })
        .from(yieldSnapshots)
        .where(eq(yieldSnapshots.poolId, poolId))
        .orderBy(desc(yieldSnapshots.timestamp))
        .limit(hours * 4); // 4 snapshots por hora (cada 15 min)

      if (snapshots.length < 2) return 0;

      const current = Number(snapshots[0].tvlUsd);
      const past = Number(snapshots[snapshots.length - 1].tvlUsd);

      if (past === 0) return 0;
      return (current - past) / past;
    } catch (error) {
      console.error(`Error calculando TVL change para ${poolId}:`, error);
      return 0;
    }
  }

  /**
   * Calcula antigüedad del pool en días
   */
  private async getPoolAge(poolId: string): Promise<number> {
    const firstSnapshot = await db
      .select({ ts: yieldSnapshots.timestamp })
      .from(yieldSnapshots)
      .where(eq(yieldSnapshots.poolId, poolId))
      .orderBy(yieldSnapshots.timestamp)
      .limit(1);

    if (firstSnapshot.length === 0) return 0;

    const ageMs = Date.now() - firstSnapshot[0].ts.getTime();
    return Math.floor(ageMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Envía alerta de oportunidad
   */
  private async sendOpportunityAlert(
    pool: any,
    quality: any,
    volatility: VolatilityMetrics,
  ) {
    const stabilityEmoji =
      volatility.coefficientOfVariation < 0.2
        ? "🟢"
        : volatility.coefficientOfVariation < 0.4
          ? "🟡"
          : "🟠";

    const message = `🚀 <b>OPORTUNIDAD ${stabilityEmoji}. (Score: ${quality.score}/100)</b> 
  
    <b>${pool.project}</b> - ${pool.symbol}
    📊 APY: <b>${Number(pool.apy).toFixed(2)}%</b>
    📉 Volatilidad: ${volatility.coefficientOfVariation.toFixed(2)} (${volatility.trend})
    💯 Score: ${volatility.reliabilityScore}/100
    💰 TVL: $${(Number(pool.tvlUsd) / 1_000_000).toFixed(2)}M

    ${pool.url ? `<a href="${pool.url}">🔗 Ir al Protocolo</a>` : ""}`;

    await this.sendAlert(pool.pool, "APY_ABOVE", pool.apy, message);
  }
  /**
   * Envía alerta de riesgo
   */
  private async sendRiskAlert(
    pool: any,
    risk: any,
    volatility?: VolatilityMetrics,
  ) {
    const emoji = risk.severity === "CRITICAL" ? "🚨" : "⚠️";

    // Formatear datos de volatilidad si existen
    let volatilityInfo = "";
    if (volatility) {
      const cv = volatility.coefficientOfVariation.toFixed(2);
      const reliability = volatility.reliabilityScore;

      volatilityInfo = `📉 <b>Perfil antes del incidente:</b>
        • Volatilidad: ${cv} (${volatility.trend})
        • Score: ${reliability}/100
        • Datos: ${volatility.dataPoints} puntos`;
    }

    const message = `${emoji} <b>ALERTA DE RIESGO - ${risk.severity}</b>
  
    <b>${pool.project}</b> - ${pool.symbol}
    ❌ ${risk.reason}
    💰 TVL Actual: $${(Number(pool.tvlUsd) / 1_000_000).toFixed(2)}M
    📉 Cambio 24h: ${(risk.tvlChange24h * 100).toFixed(1)}%${volatilityInfo}

    <i>⚠️ Posible exploit, bug o fuga de capitales.
    Verificar antes de interactuar.</i>

    ${pool.url ? `<a href="${pool.url}">Ver en explorador</a>` : ""}`;

    await this.sendAlert(pool.pool, "TVL_DROP", pool.apy, message, true);
  }

  /**
   * Wrapper para enviar alerta y guardar en DB
   */
  private async sendAlert(
    poolId: string,
    condition: "APY_ABOVE" | "APY_BELOW" | "TVL_DROP" | "DELTA_SPIKE",
    threshold: number,
    message: string,
    isUrgent: boolean = false,
  ) {
    // Enviar por Telegram
    await this.telegram.sendAlert(message, {
      disableNotification: !isUrgent,
    });

    // Guardar en DB para trackeo de cooldowns
    await db
      .insert(alerts)
      .values({
        id: randomUUID(),
        poolId,
        condition, // Usamos condition (no conditionType)
        threshold: String(threshold),
        active: true,
        lastTriggered: new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
          lastTriggered: new Date(),
          threshold: String(threshold),
        },
      });
  }
}
