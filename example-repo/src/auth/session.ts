import { applyRateLimit } from '../middleware/rateLimit';
import { getDbConnection } from '../config/database';

export interface SessionData {
  sessionId: string;
  userId: string;
  email: string;
  role: 'user' | 'admin';
  createdAt: Date;
  expiresAt: Date;
  ipAddress: string;
}

export interface CreateSessionParams {
  userId: string;
  email: string;
  role: 'user' | 'admin';
  ipAddress: string;
  ttlSeconds?: number;
}

export interface SessionValidation {
  valid: boolean;
  session: SessionData | null;
  reason?: string;
}

const sessions = new Map<string, SessionData>();

export async function createSession(params: CreateSessionParams): Promise<SessionData> {
  const _db = getDbConnection();
  const sessionId = `sess_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const now = new Date();
  const ttl = params.ttlSeconds ?? 3600;

  const session: SessionData = {
    sessionId,
    userId: params.userId,
    email: params.email,
    role: params.role,
    createdAt: now,
    expiresAt: new Date(now.getTime() + ttl * 1000),
    ipAddress: params.ipAddress,
  };

  sessions.set(sessionId, session);
  return session;
}

export async function validateSession(
  sessionId: string,
  ipAddress: string
): Promise<SessionValidation> {
  const limitResult = await applyRateLimit(`session-validate:${ipAddress}`, { max: 200 });
  if (!limitResult.allowed) {
    return { valid: false, session: null, reason: 'rate_limited' };
  }

  const session = sessions.get(sessionId);
  if (!session) return { valid: false, session: null, reason: 'not_found' };
  if (new Date() > session.expiresAt) {
    sessions.delete(sessionId);
    return { valid: false, session: null, reason: 'expired' };
  }

  return { valid: true, session };
}

export async function revokeSession(sessionId: string): Promise<void> {
  sessions.delete(sessionId);
}

export async function revokeAllUserSessions(userId: string): Promise<number> {
  let count = 0;
  for (const [id, session] of sessions) {
    if (session.userId === userId) {
      sessions.delete(id);
      count++;
    }
  }
  return count;
}
