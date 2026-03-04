-- Crear BD
CREATE DATABASE IF NOT EXISTS yieldradar CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE yieldradar;

-- Tabla pools (sintaxis MariaDB 10.7+)
CREATE TABLE IF NOT EXISTS pools (
    id VARCHAR(36) PRIMARY KEY,
    pool_id VARCHAR(255) NOT NULL UNIQUE,
    chain VARCHAR(100) NOT NULL,
    project VARCHAR(100) NOT NULL,
    symbol VARCHAR(100) NOT NULL,
    tvl_usd DECIMAL(24, 2) NOT NULL,
    apy_base DECIMAL(10, 4) DEFAULT NULL,
    apy_reward DECIMAL(10, 4) DEFAULT NULL,
    apy DECIMAL(10, 4) NOT NULL,
    stablecoin BOOLEAN DEFAULT TRUE,
    risk_score INT DEFAULT NULL,
    il_risk VARCHAR(20) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_chain (chain),
    INDEX idx_apy (apy),
    INDEX idx_tvl (tvl_usd),
    INDEX idx_stable (stablecoin),
    INDEX idx_risk (risk_score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla yield_snapshots
CREATE TABLE IF NOT EXISTS yield_snapshots (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    pool_id VARCHAR(255) NOT NULL,
    apy DECIMAL(10, 4) NOT NULL,
    tvl_usd DECIMAL(24, 2) NOT NULL,
    ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pool_time (pool_id, ts),
    INDEX idx_ts (ts),
    CONSTRAINT fk_snapshot_pool FOREIGN KEY (pool_id) REFERENCES pools(pool_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla alerts
CREATE TABLE IF NOT EXISTS alerts (
    id VARCHAR(36) PRIMARY KEY,
    pool_id VARCHAR(255) NOT NULL,
    condition_type ENUM('ABOVE', 'BELOW') NOT NULL,
    threshold DECIMAL(10, 4) NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    last_triggered TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_active (active),
    INDEX idx_pool (pool_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verificación
SHOW TABLES;