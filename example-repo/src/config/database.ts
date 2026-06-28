import { getEnv } from './env';

export interface DatabaseConnection {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

let connectionPool: DatabaseConnection | null = null;

export function getDbConnection(): DatabaseConnection {
  if (connectionPool) return connectionPool;

  const env = getEnv();
  const url = new URL(env.DATABASE_URL);

  connectionPool = {
    host: url.hostname,
    port: parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
  };

  return connectionPool;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  const _conn = getDbConnection();
  // In production this would use pg or similar driver
  void sql;
  void params;
  return { rows: [], rowCount: 0 };
}

export async function transaction<T>(
  fn: (q: typeof query) => Promise<T>
): Promise<T> {
  return fn(query);
}
