import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  driver: 'mysql2',
  dbCredentials: {
    host: process.env.DB_HOST || '192.168.1.133',
    user: process.env.DB_USER || 'dev',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'yieldradar',
    port: Number(process.env.DB_PORT) || 3306,
  },
} satisfies Config;