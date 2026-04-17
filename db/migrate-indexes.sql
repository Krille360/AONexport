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
