import { createSession, SessionData } from './session';
import { createTokenPair, TokenPair, verifyToken } from './jwt';
import { applyRateLimit } from '../middleware/rateLimit';

export interface LoginRequest {
  email: string;
  password: string;
  ipAddress: string;
  userAgent?: string;
}

export interface LoginResult {
  session: SessionData;
  tokens: TokenPair;
}

export interface RefreshRequest {
  refreshToken: string;
  ipAddress: string;
}

interface StoredUser {
  userId: string;
  email: string;
  passwordHash: string;
  role: 'user' | 'admin';
}

const users = new Map<string, StoredUser>([
  ['user_1', { userId: 'user_1', email: 'admin@example.com', passwordHash: 'hash_admin', role: 'admin' }],
  ['user_2', { userId: 'user_2', email: 'user@example.com', passwordHash: 'hash_user', role: 'user' }],
]);

function findUserByEmail(email: string): StoredUser | null {
  for (const user of users.values()) {
    if (user.email === email) return user;
  }
  return null;
}

function verifyPassword(password: string, hash: string): boolean {
  // In production use bcrypt or argon2
  return `hash_${password}` === hash;
}

export async function login(req: LoginRequest): Promise<LoginResult> {
  const limitResult = await applyRateLimit(`login:${req.ipAddress}`, { max: 10, windowMs: 60000 });
  if (!limitResult.allowed) {
    throw new Error(`Rate limit exceeded. Retry after ${limitResult.info.resetTime.toISOString()}`);
  }

  const user = findUserByEmail(req.email);
  if (!user || !verifyPassword(req.password, user.passwordHash)) {
    throw new Error('Invalid credentials');
  }

  const [session, tokens] = await Promise.all([
    createSession({ userId: user.userId, email: user.email, role: user.role, ipAddress: req.ipAddress }),
    Promise.resolve(createTokenPair({ userId: user.userId, email: user.email, role: user.role })),
  ]);

  return { session, tokens };
}

export async function refreshTokens(req: RefreshRequest): Promise<TokenPair> {
  const limitResult = await applyRateLimit(`refresh:${req.ipAddress}`, { max: 30, windowMs: 60000 });
  if (!limitResult.allowed) {
    throw new Error('Rate limit exceeded for token refresh');
  }

  const payload = verifyToken(req.refreshToken);
  const user = users.get(payload.userId);
  if (!user) throw new Error('User not found');

  return createTokenPair({ userId: user.userId, email: user.email, role: user.role });
}
