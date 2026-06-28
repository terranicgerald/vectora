import { handleError, createError, AppError } from '../middleware/errorHandler';
import { query } from '../config/database';

export interface ChargeRequest {
  userId: string;
  amountCents: number;
  currency: string;
  description: string;
  idempotencyKey: string;
}

export interface ChargeResult {
  chargeId: string;
  userId: string;
  amountCents: number;
  currency: string;
  status: 'succeeded' | 'pending' | 'failed';
  createdAt: Date;
}

export interface ChargeRecord {
  chargeId: string;
  userId: string;
  amountCents: number;
  currency: string;
  status: ChargeResult['status'];
  description: string;
  idempotencyKey: string;
  createdAt: Date;
}

const idempotencyCache = new Map<string, ChargeResult>();

export async function processCharge(req: ChargeRequest): Promise<ChargeResult> {
  if (idempotencyCache.has(req.idempotencyKey)) {
    return idempotencyCache.get(req.idempotencyKey)!;
  }

  if (req.amountCents <= 0) {
    throw createError('VALIDATION_ERROR', 'Amount must be positive', 400, { amountCents: req.amountCents });
  }

  if (req.amountCents > 999999999) {
    throw createError('VALIDATION_ERROR', 'Amount exceeds maximum allowed', 400);
  }

  try {
    const chargeId = `ch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();

    await query(
      'INSERT INTO charges (charge_id, user_id, amount_cents, currency, status, description, idempotency_key, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [chargeId, req.userId, req.amountCents, req.currency, 'succeeded', req.description, req.idempotencyKey, now]
    );

    const result: ChargeResult = {
      chargeId,
      userId: req.userId,
      amountCents: req.amountCents,
      currency: req.currency,
      status: 'succeeded',
      createdAt: now,
    };

    idempotencyCache.set(req.idempotencyKey, result);
    return result;
  } catch (err) {
    const appErr = handleError(err) as AppError;
    throw appErr;
  }
}

export async function getCharge(chargeId: string): Promise<ChargeRecord | null> {
  const result = await query<ChargeRecord>(
    'SELECT * FROM charges WHERE charge_id = $1',
    [chargeId]
  );
  return result.rows[0] ?? null;
}

export async function listChargesForUser(userId: string, limit = 20): Promise<ChargeRecord[]> {
  const result = await query<ChargeRecord>(
    'SELECT * FROM charges WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit]
  );
  return result.rows;
}
