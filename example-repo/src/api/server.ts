import { handleRequest, RouteContext } from './routes';
import { getEnv } from '../config/env';

export interface ServerConfig {
  port: number;
  host: string;
}

export interface ServerInstance {
  config: ServerConfig;
  isRunning: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function createServer(overrides?: Partial<ServerConfig>): ServerInstance {
  const env = getEnv();

  const config: ServerConfig = {
    port: overrides?.port ?? env.PORT,
    host: overrides?.host ?? '0.0.0.0',
  };

  let isRunning = false;
  let serverHandle: { close: (cb: () => void) => void } | null = null;

  async function start(): Promise<void> {
    if (isRunning) throw new Error('Server is already running');

    const http = await import('http');
    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', async () => {
        let body: Record<string, unknown> = {};
        if (chunks.length > 0) {
          try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
        }

        const ip = req.socket.remoteAddress ?? '127.0.0.1';
        const ctx: RouteContext = {
          method: req.method ?? 'GET',
          path: req.url ?? '/',
          body,
          headers: req.headers as Record<string, string>,
          ipAddress: ip,
        };

        const response = await handleRequest(ctx);
        res.writeHead(response.statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response.body));
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(config.port, config.host, () => resolve());
      server.on('error', reject);
    });

    serverHandle = server;
    isRunning = true;
    console.log(`Server listening on ${config.host}:${config.port}`);
  }

  async function stop(): Promise<void> {
    if (!isRunning || !serverHandle) return;
    await new Promise<void>((resolve) => serverHandle!.close(resolve));
    isRunning = false;
  }

  return { config, get isRunning() { return isRunning; }, start, stop };
}

export async function startServer(port?: number): Promise<ServerInstance> {
  const server = createServer(port ? { port } : undefined);
  await server.start();
  return server;
}
