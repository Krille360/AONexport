export interface ActiveSession {
  username:            string;
  client_ip:           string;
  client_external_ip:  string | null;
  tunnel_type:         string | null;
  auth_method:         string | null;
  connected_since:     string | null;
  duration_min:        number | null;
  total_bytes_in:      number;
  total_bytes_out:     number;
  user_activity_state: string | null;
  last_seen:           string;
  avg_bps_in:          number;
  avg_bps_out:         number;
}

export interface HourlyStat {
  dag:              string;
  timme:            number;
  unika_anvandare:  number;
  antal_samples:    number;
}

export interface DailySummary {
  dag:                string;
  username:           string;
  antal_samples:      number;
  forsta_anslutning:  string | null;
  senaste_aktivitet:  string;
  max_duration_min:   number | null;
  max_mb_in:          number | null;
  max_mb_out:         number | null;
  tunnel_type:        string | null;
  auth_method:        string | null;
}

export interface DashboardStats {
  active_users:     number;
  total_today:      number;
  avg_duration_min: number;
  total_bps_in:     number;
  total_bps_out:    number;
}
