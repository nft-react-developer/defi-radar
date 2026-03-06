# defi-radar

# 🎯 Stable Yield Radar

Sistema automatizado de monitoreo de yields para stablecoins en DeFi. Escanea múltiples protocolos (Aave, Curve, Convex, etc.), detecta oportunidades de alto APY y alerta sobre riesgos de liquidez en tiempo real.

## ✨ Características Principales

- **Sincronización Automática**: Actualiza datos cada 15 minutos desde DeFiLlama API
- **Motor de Alertas Inteligente**:
  - Cooldowns anti-spam (4h entre alertas similares)
  - Detección de "falsos positivos" (filtra pools con TVL &lt; $1M o APYs irreales)
  - Alertas de riesgo por caída de TVL (&gt;20% en 24h)
- **Scoring de Calidad**: Algoritmo que puntúa oportunidades basado en liquidez, antigüedad del pool y sostenibilidad del APY
- **Notificaciones Multi-canal**: Bot de Telegram con comandos interactivos (/status, /stats)
- **Arquitectura Multi-Chain**: Soporta Ethereum, Arbitrum, Base, Optimism, Polygon, etc.
- **URLs Directas**: Genera links automáticos a los protocolos (Aave, Curve, Uniswap) para depositar en un click

## 🏗️ Tecnologías

- **Backend**: Node.js 20 + TypeScript
- **Base de Datos**: MariaDB 10.7+ (time-series de históricos)
- **ORM**: Drizzle ORM (type-safe, performance)
- **APIs**: DeFiLlama Yields API
- **Notificaciones**: Telegram Bot API
- **Deployment**: Docker (optimizado para NAS ASUSTOR/Portainer)

## 📊 Arquitectura
