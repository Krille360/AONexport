-- Kör detta mot den körande databasen för att lägga till index utan att
-- behöva återskapa databasen.
--
-- Kör med:
--   docker exec <container_name> mariadb -u root -p"LÖSENORD" vpn_logs < db/migrate-indexes.sql
--
-- Indexet idx_sampled_at gör att bandwidth-timeseries (BETWEEN-frågor) går
-- snabbt även när tabellen har miljontals rader.

USE vpn_logs;

-- Lägg till standalone sampled_at-index om det inte redan finns
SET @idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'vpn_logs'
    AND TABLE_NAME  = 'vpn_session_samples'
    AND INDEX_NAME  = 'idx_sampled_at'
);

SET @sql := IF(@idx = 0,
  'ALTER TABLE vpn_session_samples ADD INDEX idx_sampled_at (sampled_at)',
  'SELECT "idx_sampled_at already exists" AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Skapa vpn_user_prefs om tabellen inte redan finns
CREATE TABLE IF NOT EXISTS vpn_user_prefs (
    username        VARCHAR(255) NOT NULL PRIMARY KEY,
    layouts         LONGTEXT     NOT NULL,
    hidden_widgets  LONGTEXT     NOT NULL DEFAULT '[]',
    updated_at      DATETIME     NOT NULL DEFAULT NOW() ON UPDATE NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Skapa ny vpn_user_layouts (namngivna layoutprofiler per användare)
CREATE TABLE IF NOT EXISTS vpn_user_layouts (
    username        VARCHAR(255) NOT NULL,
    profile_name    VARCHAR(100) NOT NULL,
    is_active       TINYINT(1)   NOT NULL DEFAULT 0,
    layouts         LONGTEXT     NOT NULL,
    hidden_widgets  LONGTEXT     NOT NULL DEFAULT '[]',
    updated_at      DATETIME     NOT NULL DEFAULT NOW() ON UPDATE NOW(),
    PRIMARY KEY (username, profile_name),
    INDEX idx_ul_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Löser problemet med att samma användare/IP dyker upp på 10+ rader
CREATE OR REPLACE VIEW vpn_active_sessions AS
SELECT
    username,
    client_ip,
    client_external_ip,
    tunnel_type,
    auth_method,
    connected_since,
    duration_min,
    total_bytes_in,
    total_bytes_out,
    user_activity_state,
    last_seen
FROM (
    SELECT
        username,
        client_ip,
        client_external_ip,
        tunnel_type,
        auth_method,
        connected_since,
        duration_min,
        total_bytes_in,
        total_bytes_out,
        user_activity_state,
        last_seen,
        ROW_NUMBER() OVER (
            PARTITION BY client_ip, username
            ORDER BY last_seen DESC, total_bytes_in DESC
        ) AS rn
    FROM vpn_sessions
    WHERE last_seen >= NOW() - INTERVAL 2 MINUTE
) deduped
WHERE rn = 1;
