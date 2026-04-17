-- VPN Dashboard - Databasstruktur
-- En rad per session (UPSERT), uppdaterad varje poll-cykel.
-- Mycket lägre datamängd än INSERT-per-poll.

CREATE DATABASE IF NOT EXISTS vpn_logs
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE vpn_logs;

CREATE TABLE IF NOT EXISTS vpn_sessions (
    id                    BIGINT UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
    first_seen            DATETIME          NOT NULL,
    last_seen             DATETIME          NOT NULL,
    username              VARCHAR(255)      NOT NULL,
    tunnel_type           VARCHAR(50),
    auth_method           VARCHAR(100),
    client_ip             VARCHAR(45),
    client_external_ip    VARCHAR(45),
    connected_since       DATETIME,
    duration_min          DECIMAL(10,1),
    bandwidth_kbps        DECIMAL(10,1),
    total_bytes_in        BIGINT UNSIGNED   DEFAULT 0,
    total_bytes_out       BIGINT UNSIGNED   DEFAULT 0,
    user_activity_state   VARCHAR(50),
    transition_technology VARCHAR(50),

    UNIQUE KEY uk_session     (client_ip, connected_since),
    INDEX idx_first_seen      (first_seen),
    INDEX idx_last_seen       (last_seen),
    INDEX idx_username        (username),
    INDEX idx_client_ip       (client_ip),
    INDEX idx_client_external (client_external_ip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- Rullande byte-samples per session (max 20 per session).
-- Används för att beräkna genomsnittlig Mbit/s på serversidan.
CREATE TABLE IF NOT EXISTS vpn_session_samples (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_ip       VARCHAR(45)     NOT NULL,
    connected_since DATETIME        NOT NULL,
    sampled_at      DATETIME        NOT NULL,
    bytes_in        BIGINT UNSIGNED NOT NULL DEFAULT 0,
    bytes_out       BIGINT UNSIGNED NOT NULL DEFAULT 0,
    INDEX idx_session   (client_ip, connected_since, sampled_at),
    INDEX idx_sampled_at (sampled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- Aktiva sessioner: senast sedd inom 2 minuter, deduplicerad per (username, client_ip).
-- Vid variationer i connected_since visas enbart den senaste raden.
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


-- Daglig sammanfattning per användare.
-- first_seen används som "sessionens dag" för att undvika att
-- en nattlig session hamnar på fel dag.
CREATE OR REPLACE VIEW vpn_daily_summary AS
SELECT
    DATE(first_seen)                           AS dag,
    username,
    COUNT(*)                                   AS antal_samples,
    MIN(connected_since)                       AS forsta_anslutning,
    MAX(last_seen)                             AS senaste_aktivitet,
    ROUND(MAX(duration_min), 1)                AS max_duration_min,
    ROUND(MAX(total_bytes_in)  / 1048576, 2)   AS max_mb_in,
    ROUND(MAX(total_bytes_out) / 1048576, 2)   AS max_mb_out,
    tunnel_type,
    auth_method
FROM vpn_sessions
GROUP BY DATE(first_seen), username, tunnel_type, auth_method;


-- Unika aktiva användare per timme.
-- Varje session räknas in i alla timmar den var aktiv (first_seen → last_seen).
CREATE OR REPLACE VIEW vpn_hourly_users AS
WITH RECURSIVE all_hours AS (
  SELECT 0 AS h
  UNION ALL
  SELECT h + 1 FROM all_hours WHERE h < 23
)
SELECT
    DATE(s.first_seen)            AS dag,
    ah.h                          AS timme,
    COUNT(DISTINCT s.username)    AS unika_anvandare,
    COUNT(*)                      AS antal_samples
FROM vpn_sessions s
JOIN all_hours ah
  ON ah.h BETWEEN HOUR(s.first_seen) AND HOUR(s.last_seen)
WHERE s.first_seen >= NOW() - INTERVAL 7 DAY
GROUP BY DATE(s.first_seen), ah.h
ORDER BY dag, timme;


-- Personliga layoutinställningar per användare (identifierad via Nexus DA X-Remote-User).
-- layouts: JSON med react-grid-layout-format per breakpoint (lg/md).
-- hidden_widgets: JSON-array med widget-id:n som ska döljas.
CREATE TABLE IF NOT EXISTS vpn_user_prefs (
    username        VARCHAR(255) NOT NULL PRIMARY KEY,
    layouts         LONGTEXT     NOT NULL,
    hidden_widgets  LONGTEXT     NOT NULL DEFAULT '[]',
    updated_at      DATETIME     NOT NULL DEFAULT NOW() ON UPDATE NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- Namngivna layoutprofiler per användare. Ersätter vpn_user_prefs.
-- En rad per profil; is_active=1 markerar den aktiva profilen.
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
