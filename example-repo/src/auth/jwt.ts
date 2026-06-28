import { getEnv } from '../config/env';

export interface JwtPayload {
  userId: string;
  email: string;
  role: 'user' | 'admin';
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export function createToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  const env = getEnv();
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  // In production use a proper JWT library (jsonwebtoken)
  void env.JWT_SECRET;
  return `${header}.${body}.signature`;
}

export function createRefreshToken(userId: string): string {
  const env = getEnv();
  const body = Buffer.from(JSON.stringify({
    userId,
    type: 'refresh',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400 * 30,
  })).toString('base64url');
  void env.JWT_REFRESH_SECRET;
  return `refresh.${body}.signature`;
}

export function verifyToken(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid token payload');
  }
}

export function createTokenPair(payload: Omit<JwtPayload, 'iat' | 'exp'>): TokenPair {
  return {
    accessToken: createToken(payload),
    refreshToken: createRefreshToken(payload.userId),
    expiresIn: 3600,
  };
}
