import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";
import dotenv from "dotenv";

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || "192.168.1.133",
  user: process.env.DB_USER || "dev",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "yieldradar",
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  // Timeouts importantes
  connectTimeout: 10000, // 10 segundos para conectar
  // acquireTimeout: 60000,      // 60 segundos para adquirir conexión del pool
  // timeout: 60000,             // Timeout general
});

export const db = drizzle(pool, { schema, mode: "default" });

// Helper para cerrar graceful
export async function closeDB() {
  await pool.end();
}

// Health check
export async function testConnection() {
  try {
    await pool.execute("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
