import dotenv from "dotenv";
dotenv.config();

import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  driver: "mysql2",
  dbCredentials: {
    host: process.env.DATABASE_HOST_NAME || "192.168.1.133",
    user: process.env.DATABASE_USER_NAME || "dev",
    password: process.env.DATABASE_USER_PASSWORD || "",
    database: process.env.DATABASE_DB_NAME || "yieldradar",
    port: Number(process.env.DB_PORT) || 3306,
  },
} satisfies Config;
