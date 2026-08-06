import { eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { settings } from './db/schema.js';

/**
 * Behavioural settings that used to be hardcoded constants or env vars in
 * v2. Stored in the DB (key/value, JSON-encoded) so the dashboard (Phase 4)
 * can edit them without a redeploy. Falls back to the defaults below if a
 * key has never been set.
 */
const DEFAULTS = {
  maxDownloadsPerDay: 50,
  maxDownloadsPerUserPerDay: 10,
  queueCooldownMs: 5000,
} as const;

export type SettingKey = keyof typeof DEFAULTS;
// All current settings are numeric (rate limits, a cooldown in ms). Widened
// to `number` here rather than the literal default values, since these are
// meant to be edited at runtime from the dashboard, not fixed constants.
export type SettingsValues = { [K in SettingKey]: number };

export function getSetting<K extends SettingKey>(key: K): number {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return DEFAULTS[key];
  try {
    return JSON.parse(row.value);
  } catch {
    return DEFAULTS[key];
  }
}

export function setSetting<K extends SettingKey>(key: K, value: number): void {
  const encoded = JSON.stringify(value);
  db.insert(settings)
    .values({ key, value: encoded })
    .onConflictDoUpdate({ target: settings.key, set: { value: encoded } })
    .run();
}

export function getAllSettings(): SettingsValues {
  return {
    maxDownloadsPerDay: getSetting('maxDownloadsPerDay'),
    maxDownloadsPerUserPerDay: getSetting('maxDownloadsPerUserPerDay'),
    queueCooldownMs: getSetting('queueCooldownMs'),
  };
}
