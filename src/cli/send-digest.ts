/**
 * Sends the daily digest immediately, without waiting for the cron
 * schedule. Handy for testing SMTP config from a fresh process, or as a
 * one-off from outside the running container.
 *
 * Usage: node dist/cli/send-digest.js
 */
import { sendDailyDigests } from '../digest.js';

sendDailyDigests().catch((err) => {
  console.error(err);
  process.exit(1);
});
