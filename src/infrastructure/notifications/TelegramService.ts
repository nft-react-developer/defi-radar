export class TelegramService {
  private readonly apiUrl: string;
  private readonly chatId: string;
  private readonly enabled: boolean;
  // Agregar estas propiedades a la clase
  private lastOffset = 0;
  private isPolling = false;
  private startTime = new Date();

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = process.env.TELEGRAM_CHAT_ID || "";
    this.enabled = !!token && !!this.chatId;

    if (this.enabled) {
      this.apiUrl = `https://api.telegram.org/bot${token}`;
      console.log("✅ TelegramService inicializado");
    } else {
      console.log("⚠️ TelegramService deshabilitado (falta token o chat ID)");
      this.apiUrl = "";
    }
  }

  async sendAlert(
    message: string,
    options?: {
      parseMode?: "HTML" | "Markdown";
      disableNotification?: boolean;
    },
  ): Promise<boolean> {
    if (!this.enabled) {
      console.log(
        "📨 Alerta simulada (Telegram no configurado):",
        message.substring(0, 100),
      );
      return true;
    }

    try {
      const response = await fetch(`${this.apiUrl}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          parse_mode: options?.parseMode || "HTML",
          disable_notification: options?.disableNotification || false,
          disable_web_page_preview: false,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("❌ Error enviando a Telegram:", error);
        return false;
      }

      console.log("✅ Alerta enviada a Telegram");
      return true;
    } catch (error) {
      console.error("❌ Error de red con Telegram:", error);
      return false;
    }
  }

  // Formato bonito para alertas de yield
  formatYieldAlert(pool: {
    project: string;
    symbol: string;
    chain: string;
    apy: number;
    apyDelta24h: number;
    tvlUsd: number;
    url?: string | null;
    riskLevel?: string;
  }): string {
    const trend =
      pool.apyDelta24h > 5 ? "🚀" : pool.apyDelta24h > 0 ? "📈" : "📉";
    const riskEmoji =
      pool.riskLevel === "LOW"
        ? "🟢"
        : pool.riskLevel === "MEDIUM"
          ? "🟡"
          : "🔴";

    return `
${trend} <b>¡Oportunidad de Yield Detectada!</b>

<b>Protocolo:</b> ${pool.project}
<b>Asset:</b> ${pool.symbol}
<b>Chain:</b> ${pool.chain}
<b>APY:</b> ${pool.apy.toFixed(2)}% ${pool.apyDelta24h > 0 ? `(+${pool.apyDelta24h.toFixed(2)}% 24h)` : ""}
<b>TVL:</b> $${(pool.tvlUsd / 1_000_000).toFixed(2)}M
<b>Riesgo:</b> ${riskEmoji} ${pool.riskLevel || "UNKNOWN"}

${pool.url ? `<a href="${pool.url}">🔗 Ir al Protocolo</a>` : ""}

<i>StableRadar Bot - ${new Date().toLocaleString()}</i>
    `.trim();
  }

  // Método para iniciar el polling de comandos
  startCommandPolling(intervalMs = 30000) {
    if (!this.enabled || this.isPolling) return;

    this.isPolling = true;
    console.log("🤖 Bot de Telegram escuchando comandos...");

    const poll = async () => {
      if (!this.isPolling) return;

      try {
        await this.checkForCommands();
      } catch (error) {
        console.error("Error en polling de Telegram:", error);
      }

      setTimeout(poll, intervalMs);
    };

    poll();
  }

  stopCommandPolling() {
    this.isPolling = false;
  }

  private async checkForCommands() {
    const response = await fetch(
      `${this.apiUrl}/getUpdates?offset=${this.lastOffset + 1}&limit=10`,
    );

    if (!response.ok) return;

    const data: any = await response.json();
    if (!data.ok || !data.result.length) return;

    for (const update of data.result) {
      this.lastOffset = update.update_id;

      if (!update.message?.text) continue;

      const text = update.message.text.trim();
      const chatId = update.message.chat.id;

      // Solo responder al chat configurado
      if (String(chatId) !== this.chatId) continue;

      await this.handleCommand(text, chatId);
    }
  }

  private async handleCommand(command: string, chatId: string) {
    const cmd = command.toLowerCase();

    if (cmd === "/status" || cmd === "/ping" || cmd === "/health") {
      await this.sendStatusReport();
    } else if (cmd === "/help") {
      await this.sendHelp();
    } else if (cmd === "/stats") {
      await this.sendStats();
    }
  }

  private async sendStatusReport() {
    const uptime = Math.floor(
      (Date.now() - this.startTime.getTime()) / 1000 / 60,
    ); // minutos

    const status = await this.getSystemStatus();

    const message = `🤖 <b>Stable Radar - Status Report</b>

⏱️ <b>Uptime:</b> ${uptime} minutos
🔄 <b>Último sync:</b> ${status.lastSync || "Nunca"}
📊 <b>Pools activos:</b> ${status.poolCount}
🎯 <b>Alertas hoy:</b> ${status.alertsToday}
💾 <b>DB:</b> ${status.dbStatus ? "🟢 Conectada" : "🔴 Desconectada"}

<i>Comandos disponibles:</i>
/status - Estado actual
/stats - Estadísticas detalladas
/help - Ayuda`;

    await this.sendAlert(message);
  }

  private async sendHelp() {
    const message = `🛟 <b>Comandos disponibles:</b>

/status - Ver si el bot está vivo y último sync
/stats - Estadísticas de pools y rendimiento
/help - Mostrar este mensaje

<i>El sistema actualiza datos cada 15 minutos.</i>
<i>Las alertas se envían automáticamente por APY alto o riesgos.</i>`;

    await this.sendAlert(message);
  }

  private async sendStats() {
    // Aquí podrías agregar más métricas
    const message = `📈 <b>Estadísticas del Sistema</b>

🕐 Hora actual: ${new Date().toLocaleString()}
⏳ Intervalo de sync: ${process.env.SYNC_INTERVAL_MINUTES || 15} min
🔔 Cooldown entre alertas: 4 horas

<i>Para ver el estado general usá /status</i>`;

    await this.sendAlert(message);
  }

  // Método que consulta el estado real del sistema
  private async getSystemStatus() {
    // Importar dinámicamente para evitar circular dependency
    const { testConnection } = await import("../../db");
    const { db } = await import("../../db");
    const { pools, alerts } = await import("../../db/schema");
    const { sql } = await import("drizzle-orm");

    const isDbConnected = await testConnection();

    let poolCount = 0;
    let lastSync = null;
    let alertsToday = 0;

    if (isDbConnected) {
      // Contar pools
      const [countRes]: any = await db.execute(
        sql`SELECT COUNT(*) as count FROM pools`,
      );
      poolCount = countRes[0]?.count || 0;

      // Último sync (último updated_at)
      const [lastUpdate]: any = await db.execute(
        sql`SELECT MAX(updated_at) as last FROM pools`,
      );
      lastSync = lastUpdate[0]?.last
        ? new Date(lastUpdate[0].last).toLocaleString()
        : null;

      // Alertas hoy
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const [alertRes]: any = await db.execute(sql`
      SELECT COUNT(*) as count FROM alerts 
      WHERE DATE(created_at) = CURDATE()
    `);
      alertsToday = alertRes[0]?.count || 0;
    }

    return {
      dbStatus: isDbConnected,
      poolCount,
      lastSync,
      alertsToday,
    };
  }
}
