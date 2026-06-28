import { validateSession, SessionData } from '../auth/session';
import { listChargesForUser, ChargeRecord } from '../payments/charge';

export interface DashboardStats {
  userId: string;
  totalCharges: number;
  totalAmountCents: number;
  recentCharges: ChargeRecord[];
  activeSessions: number;
  lastLogin: Date | null;
}

export interface OverviewRequest {
  sessionId: string;
  ipAddress: string;
  limit?: number;
}

export interface OverviewResult {
  stats: DashboardStats;
  session: SessionData;
}

export async function getDashboardOverview(req: OverviewRequest): Promise<OverviewResult> {
  const validation = await validateSession(req.sessionId, req.ipAddress);
  if (!validation.valid || !validation.session) {
    throw new Error(`Session invalid: ${validation.reason}`);
  }

  const { session } = validation;
  const limit = req.limit ?? 10;

  const recentCharges = await listChargesForUser(session.userId, limit);

  const totalAmountCents = recentCharges
    .filter(c => c.status === 'succeeded')
    .reduce((sum, c) => sum + c.amountCents, 0);

  const stats: DashboardStats = {
    userId: session.userId,
    totalCharges: recentCharges.length,
    totalAmountCents,
    recentCharges,
    activeSessions: 1,
    lastLogin: session.createdAt,
  };

  return { stats, session };
}

export async function getUserSummary(userId: string): Promise<Omit<DashboardStats, 'activeSessions' | 'lastLogin'>> {
  const charges = await listChargesForUser(userId, 100);
  const succeeded = charges.filter(c => c.status === 'succeeded');

  return {
    userId,
    totalCharges: succeeded.length,
    totalAmountCents: succeeded.reduce((sum, c) => sum + c.amountCents, 0),
    recentCharges: charges.slice(0, 5),
  };
}
