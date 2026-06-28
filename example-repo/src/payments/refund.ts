import { getCharge, ChargeRecord } from './charge';
import { handleError, createError } from '../middleware/errorHandler';

export interface RefundRequest {
  chargeId: string;
  amountCents?: number;
  reason: 'duplicate' | 'fraudulent' | 'requested_by_customer';
}

export interface RefundResult {
  refundId: string;
  chargeId: string;
  amountCents: number;
  reason: RefundRequest['reason'];
  status: 'succeeded' | 'pending' | 'failed';
  createdAt: Date;
}

export async function processRefund(req: RefundRequest): Promise<RefundResult> {
  const charge = await getCharge(req.chargeId);

  if (!charge) {
    throw createError('NOT_FOUND', `Charge ${req.chargeId} not found`, 404);
  }

  if (charge.status !== 'succeeded') {
    throw createError(
      'VALIDATION_ERROR',
      `Cannot refund a charge with status: ${charge.status}`,
      400,
      { status: charge.status }
    );
  }

  const refundAmount = req.amountCents ?? charge.amountCents;

  if (refundAmount > charge.amountCents) {
    throw createError(
      'VALIDATION_ERROR',
      'Refund amount exceeds original charge amount',
      400,
      { requested: refundAmount, available: charge.amountCents }
    );
  }

  try {
    const refundId = `re_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return {
      refundId,
      chargeId: req.chargeId,
      amountCents: refundAmount,
      reason: req.reason,
      status: 'succeeded',
      createdAt: new Date(),
    };
  } catch (err) {
    throw handleError(err);
  }
}

export async function getRefundableAmount(chargeId: string): Promise<number> {
  const charge: ChargeRecord | null = await getCharge(chargeId);
  if (!charge || charge.status !== 'succeeded') return 0;
  return charge.amountCents;
}
