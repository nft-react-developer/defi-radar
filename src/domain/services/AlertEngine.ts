import { TelegramService } from "../../infrastructure/notifications/TelegramService";
import { db } from "../../db";
import { pools, alerts } from "../../db/schema";
import { eq, and, gte, desc } from "drizzle-orm";

export interface AlertCondition {
  type: "APY_ABOVE" | "APY_BELOW" | "TVL_DROP" | "DELTA_SPIKE";
  threshold: number;
  minTvl?: number;
  maxRisk?: "LOW" | "MEDIUM" | "HIGH";
  chains?: string[];
}

export class AlertEngine {
  private telegram = new TelegramService();

  async checkAllAlerts(currentPools: any[]) {
    console.log("🔔 Evaluando alertas...");

    // Obtener alertas activas de la DB
    const activeAlerts = await db
      .select()
      .from(alerts)
      .where(eq(alerts.active, true));

    for (const alert of activeAlerts) {
      await this.evaluateAlert(alert, currentPools);
    }

    // Alertas automáticas por configuración (sin DB)
    await this.checkAutoAlerts(currentPools);
  }

  private async evaluateAlert(alert: any, pools: any[]) {
    // Lógica según el tipo de alerta
    switch (alert.condition) {
      case "APY_ABOVE":
        const highYieldPools = pools.filter(
          (p) =>
            Number(p.apy) >= Number(alert.threshold) &&
            (!alert.maxRisk ||
              this.riskToNumber(p.riskLevel) <=
                this.riskToNumber(alert.maxRisk)),
        );

        for (const pool of highYieldPools) {
          await this.telegram.sendAlert(this.telegram.formatYieldAlert(pool));
        }
        break;

      case "TVL_DROP":
        // Lógica para detectar caída de TVL (comparar con snapshot anterior)
        break;
    }
  }

  private async checkAutoAlerts(pools: any[]) {
    // Alertas "hardcoded" de alto valor (no necesitan crear registro en DB)
    const minApy = Number(process.env.ALERT_MIN_APY) || 15;
    const maxRiskScore = Number(process.env.ALERT_MAX_RISK) || 3;

    const opportunities = pools.filter(
      (p) =>
        Number(p.apy) >= minApy &&
        (p.riskScore || 9) <= maxRiskScore &&
        Number(p.tvlUsd) > 1_000_000, // Mínimo $1M TVL para evitar scams
    );

    if (opportunities.length > 0) {
      console.log(
        `🚨 Detectadas ${opportunities.length} oportunidades de alto yield`,
      );

      // Solo enviar las top 3 para no spamear
      for (const pool of opportunities.slice(0, 3)) {
        await this.telegram.sendAlert(
          this.telegram.formatYieldAlert({
            ...pool,
            apyDelta24h: 0, // Calcularlo si lo tenés disponible
          }),
        );
      }
    }
  }

  private riskToNumber(risk?: string): number {
    if (risk === "LOW") return 1;
    if (risk === "MEDIUM") return 2;
    return 3;
  }
}
