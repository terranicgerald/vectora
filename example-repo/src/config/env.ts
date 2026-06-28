export interface EnvConfig {
  PORT: number;
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  NODE_ENV: 'development' | 'production' | 'test';
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX: number;
}

export function getEnv(): EnvConfig {
  return {
    PORT: parseInt(process.env.PORT ?? '3000', 10),
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://localhost:5432/app',
    JWT_SECRET: process.env.JWT_SECRET ?? '',
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? '',
    NODE_ENV: (process.env.NODE_ENV as EnvConfig['NODE_ENV']) ?? 'development',
    RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
    RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
  };
}

export function requireEnv(key: keyof EnvConfig): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}
