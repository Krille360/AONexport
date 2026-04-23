# ============================================================
# AlwaysON VPN - Automatisk sessionsloggning till MariaDB
# Spara som: C:\Scripts\VPN_AutoExport.ps1
# ============================================================

$LogFile     = "C:\VPN_Rapporter\VPN_Export.log"
$IntervalSek = 5
$MySqlExe    = "C:\Program Files\MySQL\MySQL Workbench 8.0\mysql.exe"

# Heartbeat-logg var N:e cykel (5 sek * 60 = 5 min)
$HeartbeatIntervallCykler = 60

# Städning av föråldrade sessioner var N:e cykel (5 sek * 720 = 1 timme)
$StadningIntervallCykler = 720

# -- MariaDB-anslutning --
$DbHost = "10.181.111.50"
$DbPort = "3306"
$DbName = "vpn_logs"
$DbUser = "svc_vpn"
$DbPass = "temp"

if (-not (Test-Path "C:\VPN_Rapporter")) {
    New-Item -ItemType Directory -Path "C:\VPN_Rapporter" | Out-Null
}

# In-memory cache för att spåra kända sessioner (key = "clientIP|connectedSince")
$SessionCache = @{}
$CykelRaknare = 0

function Write-Log {
    param([string]$Message)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts  $Message" | Tee-Object -FilePath $LogFile -Append | Write-Host
}

function Invoke-SQL {
    param([string]$Sql)
    $env:MYSQL_PWD = $DbPass
    # Pipe via stdin – hanterar flerradigt SQL korrekt till skillnad från --execute
    $result = $Sql | & $MySqlExe --host=$DbHost --port=$DbPort --user=$DbUser --database=$DbName 2>&1
    $exitCode = $LASTEXITCODE
    $env:MYSQL_PWD = $null
    return [PSCustomObject]@{ Output = $result; ExitCode = $exitCode }
}

function Initialize-Database {
    $sql = @"
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
"@
    $r = Invoke-SQL -Sql $sql
    if ($r.ExitCode -eq 0) {
        Write-Log "OK: Tabell vpn_sessions kontrollerad/skapad"
    } else {
        Write-Log "FEL: Kunde inte skapa tabell - $($r.Output)"
        exit 1
    }

    $sqlSamples = @"
CREATE TABLE IF NOT EXISTS vpn_session_samples (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_ip       VARCHAR(45)     NOT NULL,
    connected_since DATETIME        NOT NULL,
    sampled_at      DATETIME        NOT NULL,
    bytes_in        BIGINT UNSIGNED NOT NULL DEFAULT 0,
    bytes_out       BIGINT UNSIGNED NOT NULL DEFAULT 0,
    INDEX idx_session (client_ip, connected_since, sampled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"@
    $r2 = Invoke-SQL -Sql $sqlSamples
    if ($r2.ExitCode -eq 0) {
        Write-Log "OK: Tabell vpn_session_samples kontrollerad/skapad"
    } else {
        Write-Log "FEL: Kunde inte skapa vpn_session_samples - $($r2.Output)"
        exit 1
    }
}

function Escape-SQL {
    param([string]$Value)
    return $Value -replace "'", "''" -replace "\\", "\\\\"
}

function Insert-Samples {
    param($Sessioner, $Timestamp)

    $ts = $Timestamp.ToString("yyyy-MM-dd HH:mm:ss")
    $values = @()

    foreach ($s in $Sessioner) {
        if ($null -eq $s.ClientIPv4Address -or $null -eq $s.ConnectionStartTime) { continue }
        $clientIp  = Escape-SQL $s.ClientIPv4Address.ToString()
        $connSince = $s.ConnectionStartTime.ToString("yyyy-MM-dd HH:mm:ss")
        $bytesIn   = [uint64]$s.TotalBytesIn
        $bytesOut  = [uint64]$s.TotalBytesOut
        $values += "('$clientIp','$connSince','$ts',$bytesIn,$bytesOut)"
    }

    $insertSql = "INSERT INTO vpn_session_samples (client_ip, connected_since, sampled_at, bytes_in, bytes_out) VALUES $($values -join ',')"

    $r = Invoke-SQL -Sql $insertSql
    if ($r.ExitCode -ne 0) {
        Write-Log "FEL: Insert-Samples misslyckades - $($r.Output)"
        return
    }

    # Behåll 30 dagars historik för graferna
    Invoke-SQL -Sql "DELETE FROM vpn_session_samples WHERE sampled_at < NOW() - INTERVAL 30 DAY" | Out-Null
}

function Upsert-Sessions {
    param($Sessioner, $Timestamp)

    $ts = $Timestamp.ToString("yyyy-MM-dd HH:mm:ss")
    $values = @()

    foreach ($s in $Sessioner) {
        if ($null -eq $s.ClientIPv4Address -or $null -eq $s.ConnectionStartTime) {
            Write-Log "VARNING: Session med null-fält hoppas över i Upsert"
            continue
        }
        $username    = Escape-SQL (($s.UserName -join ", ") + "")
        $tunnelType  = Escape-SQL ("$($s.TunnelType)")
        $authMethod  = Escape-SQL ("$($s.AuthMethod)")
        $clientIp    = Escape-SQL $s.ClientIPv4Address.ToString()
        $clientExtIp = Escape-SQL (if ($s.ClientExternalAddress) { $s.ClientExternalAddress.ToString() } else { "" })
        $connSince   = $s.ConnectionStartTime.ToString("yyyy-MM-dd HH:mm:ss")
        $durMin      = [math]::Round($s.ConnectionDuration / 60, 1)
        $bwKbps      = [math]::Round($s.Bandwidth / 1000, 1)
        $bytesIn     = [uint64]$s.TotalBytesIn
        $bytesOut    = [uint64]$s.TotalBytesOut
        $state       = Escape-SQL $s.UserActivityState
        $transition  = Escape-SQL $s.TransitionTechnology

        # first_seen sätts bara vid ny session (INSERT), last_seen uppdateras varje poll.
        $values += "('$ts','$ts','$username','$tunnelType','$authMethod','$clientIp','$clientExtIp','$connSince',$durMin,$bwKbps,$bytesIn,$bytesOut,'$state','$transition')"
    }

    if ($values.Count -eq 0) {
        Write-Log "VARNING: Inga giltiga sessioner att skriva till DB (alla hade null-fält)"
        return $false
    }

    $sql  = "INSERT INTO vpn_sessions"
    $sql += "  (first_seen,last_seen,username,tunnel_type,auth_method,client_ip,client_external_ip,"
    $sql += "   connected_since,duration_min,bandwidth_kbps,total_bytes_in,total_bytes_out,"
    $sql += "   user_activity_state,transition_technology)"
    $sql += " VALUES $($values -join ',')"
    $sql += " ON DUPLICATE KEY UPDATE"
    $sql += "  last_seen           = VALUES(last_seen),"
    $sql += "  duration_min        = VALUES(duration_min),"
    $sql += "  bandwidth_kbps      = VALUES(bandwidth_kbps),"
    $sql += "  total_bytes_in      = VALUES(total_bytes_in),"
    $sql += "  total_bytes_out     = VALUES(total_bytes_out),"
    $sql += "  user_activity_state = VALUES(user_activity_state);"

    $r = Invoke-SQL -Sql $sql
    if ($r.ExitCode -ne 0) {
        Write-Log "FEL: Upsert misslyckades - $($r.Output)"
    }
    return ($r.ExitCode -eq 0)
}

function Close-StaleSessions {
    param($AktivaSessioner)

    if ($AktivaSessioner.Count -gt 0) {
        $pairs = @()
        foreach ($s in $AktivaSessioner) {
            if ($null -eq $s.ClientIPv4Address -or $null -eq $s.ConnectionStartTime) { continue }
            $ip = Escape-SQL $s.ClientIPv4Address.ToString()
            $cs = $s.ConnectionStartTime.ToString("yyyy-MM-dd HH:mm:ss")
            $pairs += "('$ip','$cs')"
        }
        if ($pairs.Count -eq 0) {
            Write-Log "VARNING: Inga giltiga sessioner att skydda - städning hoppas över"
            return
        }
        $notIn = $pairs -join ","
        $sql = "UPDATE vpn_sessions SET last_seen = NOW() - INTERVAL 10 MINUTE WHERE last_seen >= NOW() - INTERVAL 2 MINUTE AND (client_ip, connected_since) NOT IN ($notIn);"
    } else {
        $sql = "UPDATE vpn_sessions SET last_seen = NOW() - INTERVAL 10 MINUTE WHERE last_seen >= NOW() - INTERVAL 2 MINUTE;"
    }

    try {
        $r = Invoke-SQL -Sql $sql
        if ($r.ExitCode -eq 0) {
            Write-Log "STÄDNING: Föråldrade sessioner stängda i DB"
        } else {
            Write-Log "FEL: Städning misslyckades - $($r.Output)"
        }
    } catch {
        Write-Log "FEL: Undantag i Close-StaleSessions - $_"
    }
}

function Export-VPNSessions {
    $timestamp = Get-Date
    $script:CykelRaknare++

    try {
        $sessioner = Get-RemoteAccessConnectionStatistics -ErrorAction Stop
    } catch {
        Write-Log "FEL: Kunde inte hämta sessioner - $_"
        return
    }

    # Bygg en mängd med nuvarande session-nycklar
    $nuvarandeNycklar = @{}
    foreach ($s in $sessioner) {
    # Nyckel matchar DB:s UNIQUE KEY (client_ip, connected_since) — trunkerat till sekund
        $nyckel = "$($s.ClientIPv4Address)|$($s.ConnectionStartTime.ToString('yyyy-MM-dd HH:mm:ss'))"
        $nuvarandeNycklar[$nyckel] = $s
    }

    # Identifiera nya och borttagna sessioner (loggvärdiga händelser)
    $nyaSessioner      = $nuvarandeNycklar.Keys | Where-Object { -not $script:SessionCache.ContainsKey($_) }
    $borttagnaSessioner = $script:SessionCache.Keys | Where-Object { -not $nuvarandeNycklar.ContainsKey($_) }

    foreach ($nyckel in $nyaSessioner) {
        $s = $nuvarandeNycklar[$nyckel]
        $anvandare = $s.UserName -join ", "
        Write-Log "NY SESSION: $anvandare | IP: $($s.ClientIPv4Address) | Ext: $($s.ClientExternalAddress)"
    }

    foreach ($nyckel in $borttagnaSessioner) {
        $cached = $script:SessionCache[$nyckel]
        Write-Log "SESSION AVSLUTAD: $($cached.User) | IP: $($cached.IP)"
    }

    # Uppdatera cache
    $script:SessionCache = @{}
    foreach ($nyckel in $nuvarandeNycklar.Keys) {
        $s = $nuvarandeNycklar[$nyckel]
        $script:SessionCache[$nyckel] = @{
            User = ($s.UserName -join ", ")
            IP   = $s.ClientIPv4Address.ToString()
        }
    }

    # Skicka till DB om det finns aktiva sessioner
    if ($sessioner.Count -gt 0) {
        Insert-Samples  -Sessioner $sessioner -Timestamp $timestamp
        $ok = Upsert-Sessions -Sessioner $sessioner -Timestamp $timestamp
        if (-not $ok) {
            Write-Log "VARNING: Upsert misslyckades för $($sessioner.Count) session(er)"
        }
    }

    # Heartbeat-logg (en rad per intervall istället för varje cykel)
    if ($script:CykelRaknare % $HeartbeatIntervallCykler -eq 0) {
        Write-Log "HEARTBEAT: $($sessioner.Count) aktiv(a) session(er)"
    }

    # Timvis städning: stäng sessioner i DB som inte längre är aktiva på servern
    if ($script:CykelRaknare % $StadningIntervallCykler -eq 0) {
        Close-StaleSessions -AktivaSessioner $sessioner
    }
}

# -- Testa anslutning --
Write-Log "START: Testar databasanslutning..."
$test = Invoke-SQL -Sql "SELECT 1;"
if ($test.ExitCode -ne 0) {
    Write-Log "FEL: Kan inte ansluta till MariaDB - $($test.Output)"
    exit 1
}
Write-Log "OK: Databasanslutning fungerar"

Initialize-Database

# Initial städning vid uppstart (fångar upp sessioner som aldrig stängdes korrekt)
# Körs bara om vi lyckades hämta sessioner (0 kan betyda cmdlet-fel, inte noll sessioner)
Write-Log "START: Kör initial städning av föråldrade sessioner..."
$initSessioner = $null
try {
    $initSessioner = Get-RemoteAccessConnectionStatistics -ErrorAction Stop
    Write-Log "START: Hämtade $($initSessioner.Count) aktiva sessioner från RRAS"
} catch {
    Write-Log "VARNING: Kunde inte hämta sessioner vid uppstart - städning hoppas över. Fel: $_"
}
if ($null -ne $initSessioner) {
    Close-StaleSessions -AktivaSessioner $initSessioner
}

Write-Log "START: VPN-loggning startad (intervall: $IntervalSek sek, heartbeat var $($HeartbeatIntervallCykler * $IntervalSek) sek)"

while ($true) {
    Export-VPNSessions
    Start-Sleep -Seconds $IntervalSek
}
