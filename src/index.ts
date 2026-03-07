import dotenv from "dotenv";
dotenv.config();

import { app } from "./presentation/http/server";
import { YieldSyncWorker } from "./infrastructure/workers/YieldSyncWorker";
import { closeDB, testConnection } from "./db";
import { TelegramService } from "./infrastructure/notifications/TelegramService";
import { initializeDailyLogger } from "./infrastructure/logging/dailyLogger";
const API_PORT = process.env.API_PORT || 3000;

async function bootstrap() {
  // Verificar DB
  const isDbConnected = await testConnection();
  if (!isDbConnected) {
    console.error("❌ No se pudo conectar a MariaDB");
    process.exit(1);
  }
  console.log("✅ MariaDB conectado via Drizzle");

  initializeDailyLogger();

  // Iniciar Worker
  const worker = new YieldSyncWorker();
  worker.start();

  // Sync inicial
  worker.sync();

  // Iniciar API
  app.listen(API_PORT, () => {
    console.log(`🎯 API escuchando en http://localhost:${API_PORT}`);
    console.log(`📊 Endpoints:`);
    console.log(`   - GET http://localhost:${API_PORT}/api/yields/top`);
    console.log(`   - GET http://localhost:${API_PORT}/health`);
    console.log(`   - POST http://localhost:${API_PORT}/api/test-alert`);
    console.log(`   - POST http://localhost:${API_PORT}/api/alerts`);
    console.log(`   - GET http://localhost:${API_PORT}/api/alerts`);
    console.log(`   - GET http://localhost:${API_PORT}/api/chains`);
    console.log(`   - ALERT_MIN_APY: ${process.env.ALERT_MIN_APY}`);
    console.log(`   - ALERT_MAX_RISK: ${process.env.ALERT_MAX_RISK}`);
    console.log(`   - MIN_TVL_FOR_ALERT: ${process.env.MIN_TVL_FOR_ALERT}`);
    console.log(
      `   - ALERT_COOLDOWN_HOURS: ${process.env.ALERT_COOLDOWN_HOURS}`,
    );
  });

  const telegram = new TelegramService();
  telegram.startCommandPolling(10000);

  console.log(
    "🤖 Bot de comandos iniciado (usá /status, /ping o /health en Telegram)",
  );
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n👋 Cerrando conexiones...");
  await closeDB();
  process.exit(0);
});

bootstrap();
