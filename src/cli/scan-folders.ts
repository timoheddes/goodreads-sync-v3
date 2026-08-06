/**
 * Runs a folder scan immediately, without waiting for the daily cron.
 * Same effect as sending SIGUSR2 to the running container, but usable as a
 * one-off from a fresh process (e.g. for testing).
 *
 * Usage: node dist/cli/scan-folders.js
 */
import { listUsers } from '../db/repo.js';
import { scanAllUserFolders } from '../folderScan.js';

scanAllUserFolders(listUsers());
