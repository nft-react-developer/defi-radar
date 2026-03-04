import { app } from "./presentation/http/server";
import { YieldSyncWorker } from "./infrastructure/workers/YieldSyncWorker";
import { closeDB, testConnection } from "./db";

const API_PORT = process.env.API_PORT || 3000;

async function bootstrap() {
  // Verificar DB
  const isDbConnected = await testConnection();
  if (!isDbConnected) {
    console.error("❌ No se pudo conectar a MariaDB");
    process.exit(1);
  }
  console.log("✅ MariaDB conectado via Drizzle");

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
  });
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n👋 Cerrando conexiones...");
  await closeDB();
  process.exit(0);
});

bootstrap();
