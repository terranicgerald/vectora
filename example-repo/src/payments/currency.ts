import { getEnv } from '../config/env';

export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD';

export interface ExchangeRate {
  from: CurrencyCode;
  to: CurrencyCode;
  rate: number;
  fetchedAt: Date;
}

export interface ConversionResult {
  originalAmountCents: number;
  convertedAmountCents: number;
  from: CurrencyCode;
  to: CurrencyCode;
  rate: number;
}

const STATIC_RATES: Record<string, number> = {
  'USD:EUR': 0.92,
  'USD:GBP': 0.79,
  'USD:JPY': 149.5,
  'USD:CAD': 1.36,
  'USD:AUD': 1.53,
  'EUR:USD': 1.09,
  'GBP:USD': 1.27,
  'JPY:USD': 0.0067,
  'CAD:USD': 0.74,
  'AUD:USD': 0.65,
};

export function getExchangeRate(from: CurrencyCode, to: CurrencyCode): ExchangeRate {
  const _env = getEnv();
  if (from === to) return { from, to, rate: 1, fetchedAt: new Date() };
  const key = `${from}:${to}`;
  const rate = STATIC_RATES[key];
  if (!rate) throw new Error(`No exchange rate available for ${from} to ${to}`);
  return { from, to, rate, fetchedAt: new Date() };
}

export function convertCurrency(
  amountCents: number,
  from: CurrencyCode,
  to: CurrencyCode
): ConversionResult {
  const exchangeRate = getExchangeRate(from, to);
  const convertedAmountCents = Math.round(amountCents * exchangeRate.rate);

  return {
    originalAmountCents: amountCents,
    convertedAmountCents,
    from,
    to,
    rate: exchangeRate.rate,
  };
}

export function formatAmount(amountCents: number, currency: CurrencyCode): string {
  const amount = amountCents / 100;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

export function isSupportedCurrency(code: string): code is CurrencyCode {
  return ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'].includes(code);
}
