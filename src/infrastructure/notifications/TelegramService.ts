export class TelegramService {
  private readonly apiUrl: string;
  private readonly chatId: string;
  private readonly enabled: boolean;

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
}
