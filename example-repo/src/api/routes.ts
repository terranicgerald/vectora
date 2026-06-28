import { login, refreshTokens, LoginRequest, RefreshRequest } from '../auth/login';
import { processCharge, getCharge, ChargeRequest } from '../payments/charge';
import { applyRateLimit } from '../middleware/rateLimit';
import { handleError, toErrorResponse, createError } from '../middleware/errorHandler';

export interface RouteContext {
  method: string;
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  ipAddress: string;
}

export interface RouteResponse {
  statusCode: number;
  body: unknown;
}

type RouteHandler = (ctx: RouteContext) => Promise<RouteResponse>;

const routeTable = new Map<string, RouteHandler>();

function register(method: string, path: string, handler: RouteHandler): void {
  routeTable.set(`${method}:${path}`, handler);
}

register('POST', '/auth/login', async (ctx) => {
  const req = ctx.body as LoginRequest & { ipAddress: string };
  req.ipAddress = ctx.ipAddress;
  const result = await login(req);
  return { statusCode: 200, body: result };
});

register('POST', '/auth/refresh', async (ctx) => {
  const req = ctx.body as RefreshRequest & { ipAddress: string };
  req.ipAddress = ctx.ipAddress;
  const tokens = await refreshTokens(req);
  return { statusCode: 200, body: { tokens } };
});

register('POST', '/charges', async (ctx) => {
  const limitResult = await applyRateLimit(`charges:${ctx.ipAddress}`, { max: 20, windowMs: 60000 });
  if (!limitResult.allowed) {
    return { statusCode: 429, body: toErrorResponse(createError('RATE_LIMITED', 'Too many requests', 429)) };
  }
  const req = ctx.body as ChargeRequest;
  const result = await processCharge(req);
  return { statusCode: 201, body: result };
});

register('GET', '/charges/:id', async (ctx) => {
  const chargeId = ctx.path.split('/').pop()!;
  const charge = await getCharge(chargeId);
  if (!charge) {
    return { statusCode: 404, body: toErrorResponse(createError('NOT_FOUND', 'Charge not found', 404)) };
  }
  return { statusCode: 200, body: charge };
});

export async function handleRequest(ctx: RouteContext): Promise<RouteResponse> {
  const exactKey = `${ctx.method}:${ctx.path}`;
  let handler = routeTable.get(exactKey);

  if (!handler) {
    for (const [pattern, h] of routeTable) {
      if (matchesPattern(ctx.method, ctx.path, pattern)) {
        handler = h;
        break;
      }
    }
  }

  if (!handler) {
    return { statusCode: 404, body: toErrorResponse(createError('NOT_FOUND', `Route ${ctx.method} ${ctx.path} not found`, 404)) };
  }

  try {
    return await handler(ctx);
  } catch (err) {
    const appErr = handleError(err);
    return { statusCode: appErr.statusCode, body: toErrorResponse(appErr) };
  }
}

function matchesPattern(method: string, path: string, pattern: string): boolean {
  const [patternMethod, patternPath] = pattern.split(':');
  if (method !== patternMethod) return false;
  const pathParts = path.split('/');
  const patternParts = patternPath.split('/');
  if (pathParts.length !== patternParts.length) return false;
  return patternParts.every((p, i) => p.startsWith(':') || p === pathParts[i]);
}

export function registerRoutes(): Map<string, RouteHandler> {
  return routeTable;
}
