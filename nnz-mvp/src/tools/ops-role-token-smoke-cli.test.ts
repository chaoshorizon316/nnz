import { describe, expect, it } from 'vitest';

import {
  runOpsRoleSmokeCommand,
  type OpsRoleSmokeCliDeps,
} from './ops-role-token-smoke-cli';

type FetchLike = OpsRoleSmokeCliDeps['fetch'];
type Role = 'viewer' | 'operator' | 'admin';

interface RequestRecord {
  url: string;
  method: string;
  token?: string;
  body?: unknown;
}

const DEFAULT_ENV = {
  NNZ_OPS_VIEWER_TOKEN: 'viewer-token-secret',
  NNZ_OPS_OPERATOR_TOKEN: 'operator-token-secret',
  NNZ_OPS_ADMIN_TOKEN: 'admin-token-secret',
};

describe('Soul Ops role token smoke CLI', () => {
  it('requires explicit smoke confirmation before running requests', async () => {
    const records: RequestRecord[] = [];

    const result = await runOpsRoleSmokeCommand(
      ['--base-url', 'https://nnz.example.test'],
      deps({ env: DEFAULT_ENV, records }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('RUN_OPS_ROLE_TOKEN_SMOKE');
    expect(result.stderr).not.toContain('viewer-token-secret');
    expect(records).toEqual([]);
  });

  it('validates base URL before reading tokens', async () => {
    const records: RequestRecord[] = [];

    const result = await runOpsRoleSmokeCommand(
      ['--base-url', 'not-a-url', '--confirm', 'RUN_OPS_ROLE_TOKEN_SMOKE'],
      deps({ env: DEFAULT_ENV, records }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--base-url must be a valid URL');
    expect(result.stderr).not.toContain('viewer-token-secret');
    expect(records).toEqual([]);
  });

  it('requires all role-specific token envs to be set', async () => {
    const records: RequestRecord[] = [];

    const result = await runOpsRoleSmokeCommand(
      ['--base-url', 'https://nnz.example.test', '--confirm', 'RUN_OPS_ROLE_TOKEN_SMOKE'],
      deps({ env: {}, records }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('NNZ_OPS_VIEWER_TOKEN is not set');
    expect(records).toEqual([]);
  });

  it('requires a second confirmation before the destructive cleanup check', async () => {
    const records: RequestRecord[] = [];

    const result = await runOpsRoleSmokeCommand(
      [
        '--base-url',
        'https://nnz.example.test',
        '--confirm',
        'RUN_OPS_ROLE_TOKEN_SMOKE',
        '--include-delete',
      ],
      deps({ env: DEFAULT_ENV, records }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('RUN_OPS_ROLE_TOKEN_DELETE_SMOKE');
    expect(result.stderr).not.toContain('admin-token-secret');
    expect(records).toEqual([]);
  });

  it('runs the default non-destructive role boundary smoke without printing token values', async () => {
    const records: RequestRecord[] = [];

    const result = await runOpsRoleSmokeCommand(
      ['--base-url', 'https://nnz.example.test/', '--confirm', 'RUN_OPS_ROLE_TOKEN_SMOKE'],
      deps({ env: DEFAULT_ENV, records }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Soul Ops role token smoke');
    expect(result.stdout).toContain('baseUrl: https://nnz.example.test');
    expect(result.stdout).toContain('deleteMode: skipped');
    expect(result.stdout).toContain('sessionMode: direct-token');
    expect(result.stdout).toContain('viewer: NNZ_OPS_VIEWER_TOKEN');
    expect(result.stdout).toContain('operatorCannotDelete: yes');
    expect(result.stdout).toContain('adminDeleteBoundary: yes');
    expect(result.stdout).not.toContain('viewer-token-secret');
    expect(result.stdout).not.toContain('operator-token-secret');
    expect(result.stdout).not.toContain('admin-token-secret');
    expect(records).toHaveLength(12);
    expect(records[0]).toMatchObject({ method: 'GET', url: 'https://nnz.example.test/api/ops/overview' });
    expect(records[0]?.token).toBeUndefined();
    expect(records[1]).toMatchObject({ method: 'GET', url: 'https://nnz.example.test/api/ops/overview' });
    expect(records[2]).toMatchObject({
      method: 'POST',
      token: 'viewer-token-secret',
      url: 'https://nnz.example.test/api/ops/session',
    });
    expect(records[3]).toMatchObject({
      method: 'GET',
      token: 'viewer-token-secret',
      url: 'https://nnz.example.test/api/ops/overview',
    });
    expect(records[4]).toMatchObject({
      method: 'GET',
      token: 'viewer-token-secret',
      url: 'https://nnz.example.test/api/ops/audit-events?limit=1',
    });
    expect(records[5]).toMatchObject({
      method: 'POST',
      token: 'viewer-token-secret',
      body: { dryRun: true },
    });
    expect(records[7]).toMatchObject({
      method: 'POST',
      token: 'operator-token-secret',
      body: { dryRun: true },
    });
    expect(records[8]).toMatchObject({
      method: 'POST',
      token: 'operator-token-secret',
      body: { dryRun: false, confirm: 'DELETE_TEST_USERS' },
    });
    expect(records[11]).toMatchObject({
      method: 'POST',
      token: 'admin-token-secret',
      body: { dryRun: false },
    });
  });

  it('can load role token envs from an explicit env file', async () => {
    const records: RequestRecord[] = [];

    const result = await runOpsRoleSmokeCommand(
      [
        '--env-file',
        '.env.release',
        '--base-url',
        'https://nnz.example.test',
        '--confirm',
        'RUN_OPS_ROLE_TOKEN_SMOKE',
      ],
      deps({
        env: {},
        fetchEnv: DEFAULT_ENV,
        records,
        files: {
          '/repo/.env.release': [
            'NNZ_OPS_VIEWER_TOKEN=viewer-token-secret',
            'NNZ_OPS_OPERATOR_TOKEN=operator-token-secret',
            'NNZ_OPS_ADMIN_TOKEN=admin-token-secret',
          ].join('\n'),
        },
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Soul Ops role token smoke');
    expect(result.stdout).toContain('viewer: NNZ_OPS_VIEWER_TOKEN');
    expect(result.stdout).not.toContain('.env.release');
    expect(result.stdout).not.toContain('viewer-token-secret');
    expect(records).toHaveLength(12);
  });

  it('exchanges role tokens for short-lived sessions when the server requires them', async () => {
    const records: RequestRecord[] = [];

    const result = await runOpsRoleSmokeCommand(
      ['--base-url', 'https://nnz.example.test/', '--confirm', 'RUN_OPS_ROLE_TOKEN_SMOKE'],
      deps({ env: DEFAULT_ENV, records, sessionEnabled: true }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('sessionMode: short-lived-session');
    expect(result.stdout).not.toContain('viewer-token-secret');
    expect(records.filter((record) => record.url === 'https://nnz.example.test/api/ops/session')).toHaveLength(3);
    expect(records[3]).toMatchObject({ method: 'POST', token: 'operator-token-secret' });
    expect(records[4]).toMatchObject({ method: 'POST', token: 'admin-token-secret' });
    expect(records[5]).toMatchObject({
      method: 'GET',
      token: 'session-viewer',
      url: 'https://nnz.example.test/api/ops/overview',
    });
  });

  it('runs confirmed admin cleanup only with the destructive confirmation flag', async () => {
    const records: RequestRecord[] = [];

    const result = await runOpsRoleSmokeCommand(
      [
        '--base-url',
        'https://nnz.example.test',
        '--confirm',
        'RUN_OPS_ROLE_TOKEN_SMOKE',
        '--include-delete',
        '--delete-confirm',
        'RUN_OPS_ROLE_TOKEN_DELETE_SMOKE',
      ],
      deps({ env: DEFAULT_ENV, records }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('deleteMode: confirmed');
    expect(result.stdout).not.toContain('admin-token-secret');
    expect(records[11]).toMatchObject({
      method: 'POST',
      token: 'admin-token-secret',
      body: { dryRun: false, confirm: 'DELETE_TEST_USERS' },
    });
  });

  it('keeps smoke failures sanitized', async () => {
    const records: RequestRecord[] = [];

    const result = await runOpsRoleSmokeCommand(
      ['--base-url', 'https://nnz.example.test', '--confirm', 'RUN_OPS_ROLE_TOKEN_SMOKE'],
      deps({ env: DEFAULT_ENV, records, corruptViewerRole: true }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Soul Ops role token smoke failed');
    expect(result.stderr).not.toContain('viewer token did not resolve');
    expect(result.stderr).not.toContain('private-response-body');
    expect(result.stderr).not.toContain('viewer-token-secret');
  });
});

function deps(options: {
  env: Record<string, string | undefined>;
  fetchEnv?: Record<string, string | undefined>;
  records?: RequestRecord[];
  corruptViewerRole?: boolean;
  sessionEnabled?: boolean;
  files?: Record<string, string>;
}): OpsRoleSmokeCliDeps {
  return {
    env: options.env,
    fetch: createRoleFetch(options),
    cwd: '/repo',
    readTextFile: (path) => {
      const text = options.files?.[path];
      if (text === undefined) throw new Error('missing test file');
      return text;
    },
  };
}

function createRoleFetch(options: {
  env: Record<string, string | undefined>;
  fetchEnv?: Record<string, string | undefined>;
  records?: RequestRecord[];
  corruptViewerRole?: boolean;
  sessionEnabled?: boolean;
}): FetchLike {
  const env = options.fetchEnv ?? options.env;
  const tokenRoles = new Map<string, Role>([
    [env.NNZ_OPS_VIEWER_TOKEN ?? '', 'viewer'],
    [env.NNZ_OPS_OPERATOR_TOKEN ?? '', 'operator'],
    [env.NNZ_OPS_ADMIN_TOKEN ?? '', 'admin'],
  ]);
  const accessRoles = new Map<string, Role>(tokenRoles);
  if (options.sessionEnabled) {
    accessRoles.set('session-viewer', 'viewer');
    accessRoles.set('session-operator', 'operator');
    accessRoles.set('session-admin', 'admin');
  }

  return async (url, init) => {
    const token = init?.headers?.['x-ops-token'];
    const body = init?.body ? JSON.parse(init.body) as unknown : undefined;
    options.records?.push({
      url,
      method: init?.method ?? 'GET',
      ...(token ? { token } : {}),
      ...(body === undefined ? {} : { body }),
    });

    if (!token) {
      return jsonResponse(401, { error: 'missing token', raw: 'private-response-body' });
    }
    const parsedUrl = new URL(url);
    if (parsedUrl.pathname === '/api/ops/session') {
      const sourceRole = tokenRoles.get(token);
      if (!sourceRole) return jsonResponse(403, { error: 'invalid token', raw: 'private-response-body' });
      if (!options.sessionEnabled) return jsonResponse(404, { error: 'session disabled', raw: 'private-response-body' });
      return jsonResponse(200, {
        sessionToken: `session-${sourceRole}`,
        principal: { role: sourceRole },
        raw: 'private-response-body',
      });
    }

    const role = accessRoles.get(token);
    if (!role) {
      return jsonResponse(403, { error: 'invalid token', raw: 'private-response-body' });
    }

    if (parsedUrl.pathname === '/api/ops/overview') {
      return jsonResponse(200, {
        principal: { role: options.corruptViewerRole && role === 'viewer' ? 'admin' : role },
        permissions: permissionsForRole(role),
        raw: 'private-response-body',
      });
    }
    if (parsedUrl.pathname === '/api/ops/audit-events') {
      return jsonResponse(200, {
        principal: { role },
        permissions: permissionsForRole(role),
        events: [],
        raw: 'private-response-body',
      });
    }
    if (parsedUrl.pathname === '/api/ops/cleanup-test-users') {
      return cleanupResponse(role, body);
    }
    return jsonResponse(404, { error: 'not found', raw: 'private-response-body' });
  };
}

function cleanupResponse(role: Role, body: unknown) {
  if (!isRecord(body)) return jsonResponse(400, { error: 'invalid body', raw: 'private-response-body' });
  if (role === 'viewer') return jsonResponse(403, { error: 'viewer cleanup rejected', raw: 'private-response-body' });
  if (role === 'operator' && body['dryRun'] === false) {
    return jsonResponse(403, { error: 'operator delete rejected', raw: 'private-response-body' });
  }
  if (role === 'admin' && body['dryRun'] === false && body['confirm'] !== 'DELETE_TEST_USERS') {
    return jsonResponse(400, { error: 'confirmation required', raw: 'private-response-body' });
  }
  if (body['dryRun'] === false) {
    return jsonResponse(200, {
      result: { dryRun: false, receipts: [{ userId: 'private-user-id', deleted: true }] },
      raw: 'private-response-body',
    });
  }
  return jsonResponse(200, {
    result: { dryRun: true, deletedUserIds: [] },
    raw: 'private-response-body',
  });
}

function permissionsForRole(role: Role) {
  return {
    canReadOverview: true,
    canDryRunCleanup: role === 'operator' || role === 'admin',
    canDeleteCleanup: role === 'admin',
  };
}

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    text: async () => JSON.stringify(body),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
