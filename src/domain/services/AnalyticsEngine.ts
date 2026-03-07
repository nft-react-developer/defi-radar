// src/domain/services/AnalyticsEngine.ts
import { db } from "../../db";
import { yieldSnapshots } from "../../db/schema";
import { eq, gte, and, avg, sql, count as SqlCount } from "drizzle-orm";
import { subDays, subMonths } from "date-fns";

export interface VolatilityMetrics {
  standardDeviation: number;
  coefficientOfVariation: number;
  trend: "STABLE" | "VOLATILE" | "DEGRADING";
  reliabilityScore: number;
  dataPoints: number;
}

export enum volatilityTrendDaysEnum {
  // days
  SHORT = 7,
  MEDIUM = 14,
  LONG = 30,
}

export class AnalyticsEngine {
  /**
   * Calcula volatilidad del APY en los últimos N días
   */
  async calculateVolatility(
    poolId: string,
    days: volatilityTrendDaysEnum = volatilityTrendDaysEnum.SHORT,
  ): Promise<VolatilityMetrics> {
    // Límite estricto: máximo 30 días
    const lookbackDays = Math.min(days, 30);
    const cutoffDate = subDays(new Date(), lookbackDays);

    const snapshots = await db
      .select({ apy: yieldSnapshots.apy })
      .from(yieldSnapshots)
      .where(
        and(
          eq(yieldSnapshots.poolId, poolId),
          gte(yieldSnapshots.timestamp, cutoffDate),
        ),
      )
      .orderBy(yieldSnapshots.timestamp);

    const dataPoints = snapshots.length;
    const MIN_SNAPSHOTS_STORED_IN_DB = 10; // Mínimo para análisis confiable
    if (dataPoints < MIN_SNAPSHOTS_STORED_IN_DB) {
      return {
        standardDeviation: 0,
        coefficientOfVariation: 0,
        trend: "STABLE",
        reliabilityScore: 50,
        dataPoints,
      };
    }

    const apys = snapshots.map((s) => Number(s.apy));
    const mean = apys.reduce((a, b) => a + b, 0) / dataPoints;

    if (mean === 0) {
      return {
        standardDeviation: 0,
        coefficientOfVariation: 0,
        trend: "STABLE",
        reliabilityScore: 0,
        dataPoints,
      };
    }

    const variance =
      apys.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / dataPoints;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / mean;

    // Tendencia: primera mitad vs segunda mitad
    const mid = Math.floor(dataPoints / 2);
    const firstHalf = apys.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
    const secondHalf =
      apys.slice(mid).reduce((a, b) => a + b, 0) / (dataPoints - mid);

    let trend: "STABLE" | "VOLATILE" | "DEGRADING";
    if (cv > 0.5) trend = "VOLATILE";
    else if (secondHalf < firstHalf * 0.85) trend = "DEGRADING";
    else trend = "STABLE";

    return {
      standardDeviation: Number(stdDev.toFixed(4)),
      coefficientOfVariation: Number(cv.toFixed(4)),
      trend,
      reliabilityScore: Math.round(
        Math.min(100, Math.max(0, mean * 2 - cv * 100 + 50)),
      ),
      dataPoints,
    };
  }

  /**
   * Análisis de patrones históricos (últimos 3 meses)
   * Detecta cuánto duran los spikes de APY alto
   */
  async analyzeHistoricalPattern(poolId: string) {
    const threeMonthsAgo = subMonths(new Date(), 3);

    // Usar agregaciones de SQL en vez de traer todo a memoria
    const stats: any = await db
      .select({
        avgApy: avg(yieldSnapshots.apy),
        maxApy: sql`MAX(${yieldSnapshots.apy})`,
        minApy: sql`MIN(${yieldSnapshots.apy})`,
        count: SqlCount(),
      })
      .from(yieldSnapshots)
      .where(
        and(
          eq(yieldSnapshots.poolId, poolId),
          gte(yieldSnapshots.timestamp, threeMonthsAgo),
        ),
      );

    if (!stats.length || stats[0].count === 0) {
      return null;
    }

    const { avgApy, maxApy, minApy, count } = stats[0];

    // Si tenemos suficientes datos, buscar duración de spikes
    // Un "spike" es cuando APY > media + 1 desviación estándar
    // Simplificación: buscamos cuánto tiempo pasa por encima del percentil 75
    const threshold = Number(avgApy) + (Number(maxApy) - Number(minApy)) * 0.25;

    // Contar cuántos snapshots estuvieron por encima del threshold
    const aboveThreshold = await db
      .select({ count: count() })
      .from(yieldSnapshots)
      .where(
        and(
          eq(yieldSnapshots.poolId, poolId),
          gte(yieldSnapshots.timestamp, threeMonthsAgo),
          sql`${yieldSnapshots.apy} > ${threshold}`,
        ),
      );

    const totalSnapshots = Number(count);
    const highApySnapshots = Number(aboveThreshold[0]?.count || 0);
    const percentageHigh =
      totalSnapshots > 0 ? highApySnapshots / totalSnapshots : 0;

    return {
      averageApy: Number(Number(avgApy).toFixed(2)),
      maxApy: Number(Number(maxApy).toFixed(2)),
      minApy: Number(Number(minApy).toFixed(2)),
      threshold: Number(threshold.toFixed(2)),
      percentageTimeHigh: Number((percentageHigh * 100).toFixed(1)),
      interpretation:
        percentageHigh > 0.3
          ? "FREQUENT_HIGH_YIELDS"
          : percentageHigh > 0.1
            ? "OCCASIONAL_SPIKES"
            : "RARELY_HIGH",
    };
  }

  /**
   * Compara rendimiento actual vs período anterior
   */
  async compareWithPast(poolId: string, daysBack: number = 30) {
    const now = new Date();
    const pastStart = subDays(now, daysBack + 7); // Ventana de 7 días hace X días atrás
    const pastEnd = subDays(now, daysBack);

    const [currentAvg, pastAvg] = await Promise.all([
      this.getAverageInWindow(poolId, subDays(now, 3), now), // Últimos 3 días
      this.getAverageInWindow(poolId, pastStart, pastEnd), // Hace 1 mes (ventana 7 días)
    ]);

    const change = pastAvg > 0 ? ((currentAvg - pastAvg) / pastAvg) * 100 : 0;

    return {
      current: Number(currentAvg.toFixed(2)),
      past: Number(pastAvg.toFixed(2)),
      changePercent: Number(change.toFixed(2)),
      verdict:
        change > 20
          ? "MUCH_BETTER"
          : change > 5
            ? "IMPROVING"
            : change > -5
              ? "STABLE"
              : change > -20
                ? "DECLINING"
                : "MUCH_WORSE",
    };
  }

  private async getAverageInWindow(
    poolId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const result = await db
      .select({ avg: avg(yieldSnapshots.apy) })
      .from(yieldSnapshots)
      .where(
        and(
          eq(yieldSnapshots.poolId, poolId),
          gte(yieldSnapshots.timestamp, start),
          sql`${yieldSnapshots.timestamp} <= ${end}`,
        ),
      );

    return Number(result[0]?.avg || 0);
  }
}
