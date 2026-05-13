import mysql from "mysql2/promise";
import type { ExecuteValues } from "mysql2";

let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host:     process.env.DB_HOST     ?? "mariadb",
      port:     parseInt(process.env.DB_PORT ?? "3306", 10),
      user:     process.env.DB_USER     ?? "vpnuser",
      password: process.env.DB_PASSWORD ?? "",
      database: process.env.DB_NAME     ?? "vpn_logs",
      waitForConnections: true,
      connectionLimit:    10,
      queueLimit:         0,
      timezone:           "+00:00",
    });
  }
  return pool;
}

export async function query<T = unknown>(
  sql: string,
  params?: ExecuteValues[]
): Promise<T[]> {
  const [rows] = await getPool().execute(sql, params);
  return rows as T[];
}
