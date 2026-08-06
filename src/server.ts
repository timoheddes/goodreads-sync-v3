import Fastify from 'fastify';
import { config } from './config.js';
import { registerDashboardRoutes } from './routes/dashboard.js';

/**
 * Single process serving both the background sync jobs and the web UI.
 * The dashboard (Phase 4) is server-rendered HTML with htmx for
 * progressive enhancement -- no auth, since this is intended for LAN-only
 * access (see README).
 *
 * Fastify gets its own pino logger (for request logs) configured the same
 * way as src/logger.ts; background jobs and sync code use that standalone
 * logger directly instead of going through the request logger.
 */
export async function buildServer() {
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

  await registerDashboardRoutes(app);

  return app;
}
