import {
  mysqlTable,
  varchar,
  decimal,
  boolean,
  int,
  timestamp,
  serial,
  index,
  uniqueIndex,
  mysqlEnum,
} from "drizzle-orm/mysql-core";

export const pools = mysqlTable(
  "pools",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    poolId: varchar("pool_id", { length: 255 }).notNull(),
    chain: varchar("chain", { length: 100 }).notNull(),
    project: varchar("project", { length: 100 }).notNull(),
    symbol: varchar("symbol", { length: 100 }).notNull(),
    tvlUsd: decimal("tvl_usd", { precision: 24, scale: 2 }).notNull(),
    apyBase: decimal("apy_base", { precision: 10, scale: 4 }),
    apyReward: decimal("apy_reward", { precision: 10, scale: 4 }),
    apy: decimal("apy", { precision: 10, scale: 4 }).notNull(),
    stablecoin: boolean("stablecoin").default(true),
    riskScore: int("risk_score"),
    ilRisk: varchar("il_risk", { length: 20 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
    url: varchar("url", { length: 500 }),
  },
  (table) => ({
    poolIdIdx: uniqueIndex("pool_id_idx").on(table.poolId),
    chainIdx: index("chain_idx").on(table.chain),
    apyIdx: index("apy_idx").on(table.apy),
    tvlIdx: index("tvl_idx").on(table.tvlUsd),
    stableIdx: index("stable_idx").on(table.stablecoin),
  }),
);

export const yieldSnapshots = mysqlTable(
  "yield_snapshots",
  {
    id: serial("id").primaryKey(),
    poolId: varchar("pool_id", { length: 255 }).notNull(),
    apy: decimal("apy", { precision: 10, scale: 4 }).notNull(),
    tvlUsd: decimal("tvl_usd", { precision: 24, scale: 2 }).notNull(),
    timestamp: timestamp("ts").defaultNow().notNull(),
  },
  (table) => ({
    poolTimeIdx: index("pool_time_idx").on(table.poolId, table.timestamp),
    timeIdx: index("time_idx").on(table.timestamp),
  }),
);

export const alerts = mysqlTable(
  "alerts",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    poolId: varchar("pool_id", { length: 255 }).notNull(),
    condition: mysqlEnum("condition_type", [
      "APY_ABOVE",
      "APY_BELOW",
      "TVL_DROP",
      "DELTA_SPIKE",
    ]).notNull(),
    threshold: decimal("threshold", { precision: 10, scale: 4 }).notNull(),
    active: boolean("active").default(true),
    lastTriggered: timestamp("last_triggered"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    activeIdx: index("active_idx").on(table.active),
  }),
);

// Tipos para TypeScript
export type Pool = typeof pools.$inferSelect;
export type NewPool = typeof pools.$inferInsert;
export type YieldSnapshot = typeof yieldSnapshots.$inferSelect;
export type NewYieldSnapshot = typeof yieldSnapshots.$inferInsert;
