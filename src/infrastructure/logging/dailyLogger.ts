import fs from "fs";
import path from "path";
import cron from "node-cron";

let initialized = false;

export function initializeDailyLogger(): void {
  if (initialized) return; // Evitar doble inicialización

  const name = process.env.APP_NAME || "app";
  const LOG_DIR = "../logs";
  const LOG_FILE = path.join(LOG_DIR, `${name}.log`);

  // Crear directorio si no existe
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  // Stream de escritura
  let logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });

  // Función de rotación
  const rotateLogs = () => {
    console.log("🔄 Rotando logs...");
    logStream.end(() => {
      try {
        fs.unlinkSync(LOG_FILE);
      } catch (e) {
        // No existía
      }
      logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
      logStream.write(
        `[${new Date().toISOString()}] 🚀 Nuevo log iniciado para ${name}\n`,
      );
    });
  };

  // Rotar a las 00:00
  cron.schedule("0 0 * * *", rotateLogs);

  // Guardar referencias originales
  const originalLog = console.log;
  const originalError = console.error;

  // Sobrescribir console.log
  console.log = (...args: any[]) => {
    const line = `[${new Date().toISOString()}] ${args.join(" ")}\n`;
    logStream.write(line);
    originalLog.apply(console, args); // Para Portainer
  };

  console.error = (...args: any[]) => {
    const line = `[${new Date().toISOString()}] [ERROR] ${args.join(" ")}\n`;
    logStream.write(line);
    originalError.apply(console, args);
  };

  initialized = true;
  console.log(`📝 Logger inicializado: ${LOG_FILE}`);
}
