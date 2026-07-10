import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mergeReleaseEnvFile } from './release-env-file';

const DEFAULT_VIEWER_TOKEN_ENV = 'NNZ_OPS_VIEWER_TOKEN';
const DEFAULT_OPERATOR_TOKEN_ENV = 'NNZ_OPS_OPERATOR_TOKEN';
const DEFAULT_ADMIN_TOKEN_ENV = 'NNZ_OPS_ADMIN_TOKEN';
const SMOKE_CONFIRM = 'RUN_OPS_ROLE_TOKEN_SMOKE';
const DELETE_CONFIRM = 'RUN_OPS_ROLE_TOKEN_DELETE_SMOKE';

const USAGE = `Usage:
  npm run ops:role-smoke -- --base-url <https://service.example> --confirm RUN_OPS_ROLE_TOKEN_SMOKE
  npm run ops:role-smoke -- --base-url <https://service.example> --viewer-token-env NNZ_OPS_VIEWER_TOKEN --operator-token-env NNZ_OPS_OPERATOR_TOKEN --admin-token-env NNZ_OPS_ADMIN_TOKEN --confirm RUN_OPS_ROLE_TOKEN_SMOKE
  npm run ops:role-smoke -- --env-file .env.release --base-url <https://service.example> --confirm RUN_OPS_ROLE_TOKEN_SMOKE

Optional destructive admin cleanup check:
  npm run ops:role-smoke -- --base-url <https://service.example> --include-delete --delete-confirm RUN_OPS_ROLE_TOKEN_DELETE_SMOKE --confirm RUN_OPS_ROLE_TOKEN_SMOKE

Verifies Soul Ops viewer/operator/admin token boundaries without printing env file paths, token values, response payloads, user content, or raw network details.
Default mode is non-destructive: admin delete is only checked for missing confirmation.`;

export interface OpsRoleSmokeCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface OpsRoleSmokeCliDeps {
  env: Record<string, string | undefined>;
  fetch: FetchLike;
  cwd: string;
  readTextFile(path: string): string;
}

export interface OpsRoleSmokeResult {
  kind: 'ops-role-token-smoke';
  baseUrl: string;
  deleteMode: 'skipped' | 'confirmed';
  sessionMode: 'direct-token' | 'short-lived-session';
  tokenEnvs: {
    viewer: string;
    operator: string;
    admin: string;
  };
  checks: {
    missingTokenRejected: true;
    invalidTokenRejected: true;
    viewerCanRead: true;
    viewerCannotCleanup: true;
    operatorCanDryRun: true;
    operatorCannotDelete: true;
    adminCanDryRun: true;
    adminDeleteBoundary: true;
    auditQueryReadable: true;
  };
}

interface FetchResponseLike {
  status: number;
  text(): Promise<string>;
}

type FetchLike = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<FetchResponseLike>;

type ParsedArgs = {
  help: boolean;
  baseUrl?: string;
  viewerTokenEnv: string;
  operatorTokenEnv: string;
  adminTokenEnv: string;
  confirm?: string;
  envFile?: string;
  includeDelete: boolean;
  deleteConfirm?: string;
  error?: string;
};

interface HttpResponse<T> {
  status: number;
  body: T;
}

const DEFAULT_DEPS: OpsRoleSmokeCliDeps = {
  env: process.env,
  fetch: fetch as FetchLike,
  cwd: process.cwd(),
  readTextFile: (path) => readFileSync(path, 'utf8'),
};

export async function runOpsRoleSmokeCommand(
  args: string[],
  deps: OpsRoleSmokeCliDeps = DEFAULT_DEPS,
): Promise<OpsRoleSmokeCliResult> {
  const parsedArgs = parseArgs(args);
  if (parsedArgs.help) {
    return { exitCode: 0, stdout: `${USAGE}\n`, stderr: '' };
  }
  if (parsedArgs.error) {
    return { exitCode: 1, stdout: '', stderr: `${parsedArgs.error}\n\n${USAGE}\n` };
  }

  const envFileResult = mergeReleaseEnvFile(deps.env, parsedArgs.envFile, deps);
  if (envFileResult.error) {
    return { exitCode: 1, stdout: '', stderr: `${envFileResult.error}\n\n${USAGE}\n` };
  }

  const guardrailError = validateGuardrails(parsedArgs, envFileResult.env);
  if (guardrailError) {
    return { exitCode: 1, stdout: '', stderr: `${guardrailError}\n\n${USAGE}\n` };
  }

  try {
    const result = await runOpsRoleSmoke({
      baseUrl: normalizeBaseUrl(parsedArgs.baseUrl!),
      viewerToken: readRequiredEnv(envFileResult.env, parsedArgs.viewerTokenEnv)!,
      operatorToken: readRequiredEnv(envFileResult.env, parsedArgs.operatorTokenEnv)!,
      adminToken: readRequiredEnv(envFileResult.env, parsedArgs.adminTokenEnv)!,
      tokenEnvs: {
        viewer: parsedArgs.viewerTokenEnv,
        operator: parsedArgs.operatorTokenEnv,
        admin: parsedArgs.adminTokenEnv,
      },
      includeDelete: parsedArgs.includeDelete,
      fetch: deps.fetch,
    });
    return { exitCode: 0, stdout: formatSmokeSummary(result), stderr: '' };
  } catch (error) {
    return { exitCode: 1, stdout: '', stderr: formatSmokeError(error) };
  }
}

async function runOpsRoleSmoke(input: {
  baseUrl: string;
  viewerToken: string;
  operatorToken: string;
  adminToken: string;
  tokenEnvs: OpsRoleSmokeResult['tokenEnvs'];
  includeDelete: boolean;
  fetch: FetchLike;
}): Promise<OpsRoleSmokeResult> {
  const missing = await requestJson(input.fetch, input.baseUrl, '/api/ops/overview', {
    allowStatuses: [401],
  });
  assert(missing.status === 401, 'missing token was not rejected');

  const invalid = await requestJson(input.fetch, input.baseUrl, '/api/ops/overview', {
    token: `invalid-${Date.now()}`,
    allowStatuses: [403],
  });
  assert(invalid.status === 403, 'invalid token was not rejected');

  const viewerAccess = await resolveOpsAccessToken(input.fetch, input.baseUrl, input.viewerToken);
  const sessionMode = viewerAccess.sessionToken ? 'short-lived-session' : 'direct-token';
  const viewerToken = viewerAccess.sessionToken ?? input.viewerToken;
  const operatorToken = sessionMode === 'short-lived-session'
    ? await requireOpsSessionToken(input.fetch, input.baseUrl, input.operatorToken)
    : input.operatorToken;
  const adminToken = sessionMode === 'short-lived-session'
    ? await requireOpsSessionToken(input.fetch, input.baseUrl, input.adminToken)
    : input.adminToken;

  const viewerOverview = await requestJson<{ principal?: { role?: string }; permissions?: Record<string, unknown> }>(
    input.fetch,
    input.baseUrl,
    '/api/ops/overview',
    { token: viewerToken },
  );
  assert(viewerOverview.body.principal?.role === 'viewer', 'viewer token did not resolve as viewer');
  assert(viewerOverview.body.permissions?.['canReadOverview'] === true, 'viewer cannot read overview');
  assert(viewerOverview.body.permissions?.['canDryRunCleanup'] === false, 'viewer unexpectedly can dry-run cleanup');
  assert(viewerOverview.body.permissions?.['canDeleteCleanup'] === false, 'viewer unexpectedly can delete cleanup');

  const auditQuery = await requestJson<{ principal?: { role?: string } }>(
    input.fetch,
    input.baseUrl,
    '/api/ops/audit-events?limit=1',
    { token: viewerToken },
  );
  assert(auditQuery.body.principal?.role === 'viewer', 'viewer cannot read audit query');

  const viewerCleanup = await requestJson(input.fetch, input.baseUrl, '/api/ops/cleanup-test-users', {
    method: 'POST',
    token: viewerToken,
    body: { dryRun: true },
    allowStatuses: [403],
  });
  assert(viewerCleanup.status === 403, 'viewer cleanup dry-run was not rejected');

  const operatorOverview = await requestJson<{ principal?: { role?: string }; permissions?: Record<string, unknown> }>(
    input.fetch,
    input.baseUrl,
    '/api/ops/overview',
    { token: operatorToken },
  );
  assert(operatorOverview.body.principal?.role === 'operator', 'operator token did not resolve as operator');
  assert(operatorOverview.body.permissions?.['canDryRunCleanup'] === true, 'operator cannot dry-run cleanup');
  assert(operatorOverview.body.permissions?.['canDeleteCleanup'] === false, 'operator unexpectedly can delete cleanup');

  const operatorDryRun = await requestJson<{ result?: { dryRun?: boolean; deletedUserIds?: unknown[] } }>(
    input.fetch,
    input.baseUrl,
    '/api/ops/cleanup-test-users',
    { method: 'POST', token: operatorToken, body: { dryRun: true } },
  );
  assert(operatorDryRun.body.result?.dryRun === true, 'operator dry-run did not return dryRun true');
  assert(Array.isArray(operatorDryRun.body.result.deletedUserIds), 'operator dry-run did not return deleted ids');
  assert(operatorDryRun.body.result.deletedUserIds.length === 0, 'operator dry-run deleted users');

  const operatorDelete = await requestJson(input.fetch, input.baseUrl, '/api/ops/cleanup-test-users', {
    method: 'POST',
    token: operatorToken,
    body: { dryRun: false, confirm: 'DELETE_TEST_USERS' },
    allowStatuses: [403],
  });
  assert(operatorDelete.status === 403, 'operator delete was not rejected');

  const adminOverview = await requestJson<{ principal?: { role?: string }; permissions?: Record<string, unknown> }>(
    input.fetch,
    input.baseUrl,
    '/api/ops/overview',
    { token: adminToken },
  );
  assert(adminOverview.body.principal?.role === 'admin', 'admin token did not resolve as admin');
  assert(adminOverview.body.permissions?.['canDryRunCleanup'] === true, 'admin cannot dry-run cleanup');
  assert(adminOverview.body.permissions?.['canDeleteCleanup'] === true, 'admin cannot delete cleanup');

  const adminDryRun = await requestJson<{ result?: { dryRun?: boolean; deletedUserIds?: unknown[] } }>(
    input.fetch,
    input.baseUrl,
    '/api/ops/cleanup-test-users',
    { method: 'POST', token: adminToken, body: { dryRun: true } },
  );
  assert(adminDryRun.body.result?.dryRun === true, 'admin dry-run did not return dryRun true');
  assert(Array.isArray(adminDryRun.body.result.deletedUserIds), 'admin dry-run did not return deleted ids');
  assert(adminDryRun.body.result.deletedUserIds.length === 0, 'admin dry-run deleted users');

  if (input.includeDelete) {
    const adminDelete = await requestJson<{ result?: { dryRun?: boolean; receipts?: unknown[] } }>(
      input.fetch,
      input.baseUrl,
      '/api/ops/cleanup-test-users',
      { method: 'POST', token: adminToken, body: { dryRun: false, confirm: 'DELETE_TEST_USERS' } },
    );
    assert(adminDelete.body.result?.dryRun === false, 'admin delete did not run confirmed cleanup');
    assert(Array.isArray(adminDelete.body.result.receipts), 'admin delete did not return receipts');
  } else {
    const adminDeleteWithoutConfirm = await requestJson(input.fetch, input.baseUrl, '/api/ops/cleanup-test-users', {
      method: 'POST',
      token: adminToken,
      body: { dryRun: false },
      allowStatuses: [400],
    });
    assert(adminDeleteWithoutConfirm.status === 400, 'admin delete without confirmation was not rejected');
  }

  return {
    kind: 'ops-role-token-smoke',
    baseUrl: input.baseUrl,
    deleteMode: input.includeDelete ? 'confirmed' : 'skipped',
    sessionMode,
    tokenEnvs: input.tokenEnvs,
    checks: {
      missingTokenRejected: true,
      invalidTokenRejected: true,
      viewerCanRead: true,
      viewerCannotCleanup: true,
      operatorCanDryRun: true,
      operatorCannotDelete: true,
      adminCanDryRun: true,
      adminDeleteBoundary: true,
      auditQueryReadable: true,
    },
  };
}

function parseArgs(args: string[]): ParsedArgs {
  let baseUrl: string | undefined;
  let viewerTokenEnv = DEFAULT_VIEWER_TOKEN_ENV;
  let operatorTokenEnv = DEFAULT_OPERATOR_TOKEN_ENV;
  let adminTokenEnv = DEFAULT_ADMIN_TOKEN_ENV;
  let confirm: string | undefined;
  let envFile: string | undefined;
  let includeDelete = false;
  let deleteConfirm: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') {
      return { help: true, viewerTokenEnv, operatorTokenEnv, adminTokenEnv, includeDelete, ...(envFile ? { envFile } : {}) };
    }
    if (arg === '--include-delete') {
      includeDelete = true;
      continue;
    }
    if (
      arg === '--base-url'
      || arg === '--viewer-token-env'
      || arg === '--operator-token-env'
      || arg === '--admin-token-env'
      || arg === '--confirm'
      || arg === '--env-file'
      || arg === '--delete-confirm'
    ) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return { help: false, viewerTokenEnv, operatorTokenEnv, adminTokenEnv, includeDelete, error: `Missing value after ${arg}.` };
      }
      if (arg === '--base-url') baseUrl = value;
      if (arg === '--viewer-token-env') viewerTokenEnv = value;
      if (arg === '--operator-token-env') operatorTokenEnv = value;
      if (arg === '--admin-token-env') adminTokenEnv = value;
      if (arg === '--confirm') confirm = value;
      if (arg === '--env-file') envFile = value;
      if (arg === '--delete-confirm') deleteConfirm = value;
      index += 1;
      continue;
    }
    return { help: false, viewerTokenEnv, operatorTokenEnv, adminTokenEnv, includeDelete, error: `Unknown argument: ${arg}.` };
  }

  return {
    help: false,
    viewerTokenEnv,
    operatorTokenEnv,
    adminTokenEnv,
    includeDelete,
    ...(envFile ? { envFile } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(confirm ? { confirm } : {}),
    ...(deleteConfirm ? { deleteConfirm } : {}),
  };
}

function validateGuardrails(parsedArgs: ParsedArgs, env: Record<string, string | undefined>): string | undefined {
  if (!parsedArgs.baseUrl) {
    return 'Ops role smoke requires --base-url <https://service.example>.';
  }
  const baseUrlError = validateBaseUrl(parsedArgs.baseUrl);
  if (baseUrlError) return baseUrlError;
  if (parsedArgs.confirm !== SMOKE_CONFIRM) {
    return `Ops role smoke requires --confirm ${SMOKE_CONFIRM}.`;
  }
  if (parsedArgs.includeDelete && parsedArgs.deleteConfirm !== DELETE_CONFIRM) {
    return `Confirmed cleanup smoke requires --delete-confirm ${DELETE_CONFIRM}.`;
  }
  const missingEnv = [
    parsedArgs.viewerTokenEnv,
    parsedArgs.operatorTokenEnv,
    parsedArgs.adminTokenEnv,
  ].find((key) => !readRequiredEnv(env, key));
  if (missingEnv) {
    return `${missingEnv} is not set. Configure role-specific Soul Ops token envs before running this smoke.`;
  }
  return undefined;
}

function validateBaseUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return '--base-url must start with http:// or https://.';
    }
    if (!url.hostname) {
      return '--base-url must include a hostname.';
    }
    return undefined;
  } catch {
    return '--base-url must be a valid URL.';
  }
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function readRequiredEnv(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

async function resolveOpsAccessToken(
  fetchImpl: FetchLike,
  baseUrl: string,
  sourceToken: string,
): Promise<{ sessionToken?: string }> {
  const response = await requestJson<{ sessionToken?: unknown }>(
    fetchImpl,
    baseUrl,
    '/api/ops/session',
    {
      method: 'POST',
      token: sourceToken,
      allowStatuses: [200, 404],
    },
  );
  if (response.status === 404) return {};
  assert(typeof response.body.sessionToken === 'string' && response.body.sessionToken.length > 0, 'ops session response was invalid');
  return { sessionToken: response.body.sessionToken };
}

async function requireOpsSessionToken(
  fetchImpl: FetchLike,
  baseUrl: string,
  sourceToken: string,
): Promise<string> {
  const response = await resolveOpsAccessToken(fetchImpl, baseUrl, sourceToken);
  assert(response.sessionToken !== undefined, 'ops session was not created');
  return response.sessionToken;
}

async function requestJson<T = unknown>(
  fetchImpl: FetchLike,
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    allowStatuses?: number[];
  } = {},
): Promise<HttpResponse<T>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) headers['x-ops-token'] = options.token;
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const raw = await response.text();
  const body = raw ? JSON.parse(raw) as T : {} as T;
  const allowed = options.allowStatuses ?? [200];
  if (!allowed.includes(response.status)) {
    throw Object.assign(new Error('unexpected HTTP status'), { status: response.status });
  }
  return { status: response.status, body };
}

function formatSmokeSummary(result: OpsRoleSmokeResult): string {
  const lines = [
    'Soul Ops role token smoke',
    `baseUrl: ${result.baseUrl}`,
    `deleteMode: ${result.deleteMode}`,
    `sessionMode: ${result.sessionMode}`,
    '',
    'Token envs:',
    `- viewer: ${result.tokenEnvs.viewer}`,
    `- operator: ${result.tokenEnvs.operator}`,
    `- admin: ${result.tokenEnvs.admin}`,
    '',
    'Checks:',
    ...Object.entries(result.checks).map(([key, value]) => `- ${key}: ${value ? 'yes' : 'no'}`),
  ];
  return `${lines.join('\n')}\n`;
}

function formatSmokeError(error: unknown): string {
  const status = isRecord(error) && typeof error['status'] === 'number' ? ` httpStatus=${error['status']}` : '';
  const code = isRecord(error) && typeof error['code'] === 'string' ? ` errorCode=${error['code']}` : '';
  return `Soul Ops role token smoke failed.${status}${code}\nNo token value, response payload, user content, cleanup receipt, database URL, server log, or raw network details were printed.\n`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const currentFilePath = process.argv[1] ? resolve(process.argv[1]) : '';
if (currentFilePath && currentFilePath === fileURLToPath(import.meta.url)) {
  const result = await runOpsRoleSmokeCommand(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
