// Auto-load .env file. No external dependency — reads key=value lines manually.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnv(envDir: string): void {
  try {
    const envPath = resolve(envDir, '.env');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key && value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env is optional — production may use platform env vars directly
  }
}
