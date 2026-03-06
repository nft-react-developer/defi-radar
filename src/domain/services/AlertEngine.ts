import { db } from "../../db";
import { pools, yieldSnapshots, alerts } from "../../db/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { TelegramService } from "../../infrastructure/notifications/TelegramService";
import { randomUUID } from "crypto";

// Configuración desde variables de entorno o defaults
const CONFIG = {
  COOLDOWN_HOURS: Number(process.env.ALERT_COOLDOWN_HOURS) || 4,
  MIN_TVL_FOR_OPPORTUNITY: Number(process.env.MIN_TVL_FOR_ALERT) || 1_000_000, // $1M
  TVL_DROP_THRESHOLD: Number(process.env.TVL_DROP_THRESHOLD) || 0.2, // 20%
  SIGNIFICANT_CHANGE_THRESHOLD: 0.5, // Si cambia 50% más, ignorar cooldown
  MIN_POOL_AGE_DAYS: 3, // Pools con menos de 3 días son sospechosos
};

export class AlertEngine {
  private telegram = new TelegramService();

  /**
   * Método principal: analiza todos los pools y decide si alertar
   */
  async analyzePools(currentPools: any[]) {
    console.log(`🔔 Analizando ${currentPools.length} pools...`);

    const stats = { opportunities: 0, risks: 0, skipped: 0 };

    for (const pool of currentPools) {
      try {
        // 1. Validar calidad básica (evitar falsos positivos)
        const quality = await this.validateQuality(pool);
        if (!quality.isValid && quality.severity !== "CRITICAL") {
          console.log(`⏭️  Pool ${pool.poolId} descartado: ${quality.reason}`);
          stats.skipped++;
          continue;
        }

        // 2. Detectar riesgos (TVL cayendo, exploit, etc.)
        const risk = await this.detectRisk(pool);
        if (risk.isRisk) {
          const shouldSend = await this.shouldAlert(
            pool.poolId,
            "TVL_DROP", // Usamos TVL_DROP del enum
            risk.severity,
            pool.apy, // Para comparar si cambió mucho
          );

          if (shouldSend) {
            await this.sendRiskAlert(pool, risk);
            stats.risks++;
          }
          continue; // Si hay riesgo grave, no alertar como oportunidad
        }

        // 3. Detectar oportunidades (solo si pasa filtros de calidad)
        if (quality.score >= 70) {
          // Score mínimo de calidad
          const isOpportunity = Number(pool.apy) > 10; // Ejemplo: >10% APY

          if (isOpportunity) {
            const shouldSend = await this.shouldAlert(
              pool.poolId,
              "APY_ABOVE", // Usamos APY_ABOVE del enum
              "HIGH",
              pool.apy,
            );

            if (shouldSend) {
              await this.sendOpportunityAlert(pool, quality);
              stats.opportunities++;
            }
          }
        }
      } catch (error) {
        console.error(`❌ Error analizando pool ${pool.poolId}:`, error);
      }
    }

    console.log(
      `📊 Resumen: ${stats.opportunities} oportunidades, ${stats.risks} riesgos, ${stats.skipped} descartados`,
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
  private async sendOpportunityAlert(pool: any, quality: any) {
    const message = `🚀 <b>OPORTUNIDAD DETECTADA</b> (Score: ${quality.score}/100)
    
<b>${pool.project}</b> - ${pool.symbol}
📊 APY: <b>${Number(pool.apy).toFixed(2)}%</b>
💰 TVL: $${(Number(pool.tvlUsd) / 1_000_000).toFixed(2)}M
⛓️ Chain: ${pool.chain}
🎯 Riesgo: ${pool.riskLevel || "MEDIUM"}

${pool.url ? `<a href="${pool.url}">🔗 Ir al Protocolo</a>` : ""}

<i>Alerta filtrada por calidad • StableRadar</i>`;

    await this.sendAlert(pool.poolId, "APY_ABOVE", pool.apy, message);
  }

  /**
   * Envía alerta de riesgo
   */
  private async sendRiskAlert(pool: any, risk: any) {
    const emoji = risk.severity === "CRITICAL" ? "🚨" : "⚠️";

    const message = `${emoji} <b>ALERTA DE RIESGO - ${risk.severity}</b>
    
<b>${pool.project}</b> - ${pool.symbol}
❌ ${risk.reason}
💰 TVL Actual: $${(Number(pool.tvlUsd) / 1_000_000).toFixed(2)}M
📉 Cambio 24h: ${(risk.tvlChange24h * 100).toFixed(1)}%

<i>Posible exploit, bug o fuga de capitales.
Verificar antes de interactuar.</i>

${pool.url ? `<a href="${pool.url}">Ver en explorador</a>` : ""}`;

    await this.sendAlert(pool.poolId, "TVL_DROP", pool.apy, message, true);
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
