import Fastify from 'fastify';
import { config } from './config.js';

/**
 * Phase 0: just enough of a web server to prove the container boots and is
 * reachable. The dashboard (Phase 4) and API routes (Phase 1-4) get added
 * here as they're built -- this stays the single process serving both the
 * background sync jobs and the web UI.
 *
 * Fastify gets its own pino logger (for request logs) configured the same
 * way as src/logger.ts; background jobs and sync code use that standalone
 * logger directly instead of going through the request logger.
 */
export function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport:
        config.nodeEnv !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
          : undefined,
    },
  });

  app.get('/health', async () => ({
    status: 'ok',
    version: process.env.npm_package_version || '3.0.0',
  }));

  return app;
}
