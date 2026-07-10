import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export interface ReleaseEnvFileDeps {
  cwd: string;
  readTextFile(path: string): string;
}

export interface ReleaseEnvFileResult {
  env: Record<string, string | undefined>;
  loaded: boolean;
  error?: string;
}

const DEFAULT_DEPS: ReleaseEnvFileDeps = {
  cwd: process.cwd(),
  readTextFile: (path) => readFileSync(path, 'utf8'),
};

export function mergeReleaseEnvFile(
  baseEnv: Record<string, string | undefined>,
  envFile: string | undefined,
  deps: ReleaseEnvFileDeps = DEFAULT_DEPS,
): ReleaseEnvFileResult {
  if (!envFile) return { env: baseEnv, loaded: false };

  try {
    const path = resolveInputPath(deps.cwd, envFile);
    const parsed = parseEnvFile(deps.readTextFile(path));
    return { env: mergeEnv(baseEnv, parsed), loaded: true };
  } catch {
    return {
      env: baseEnv,
      loaded: false,
      error: 'Env file could not be loaded. No env file path or secret value was printed.',
    };
  }
}

export function applyReleaseEnvToProcessEnv(env: Record<string, string | undefined>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    if (!value || !value.trim()) continue;
    if (process.env[key] && process.env[key]!.trim()) continue;
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function parseEnvFile(contents: string): Record<string, string | undefined> {
  const parsed: Record<string, string | undefined> = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trimStart().startsWith('#')) continue;
    const key = match[1]!;
    parsed[key] = unquoteEnvValue(match[2] ?? '');
  }
  return parsed;
}

function mergeEnv(
  baseEnv: Record<string, string | undefined>,
  fileEnv: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const merged = { ...baseEnv };
  for (const [key, value] of Object.entries(fileEnv)) {
    if (!value || !value.trim()) continue;
    if (merged[key] && merged[key]!.trim()) continue;
    merged[key] = value;
  }
  return merged;
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function resolveInputPath(cwd: string, inputPath: string): string {
  return isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath);
}
