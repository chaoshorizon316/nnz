import { describe, expect, it } from 'vitest';

import { buildOpsPermissions, buildOpsTokenEntries, resolveOpsPrincipal, roleAllows } from './ops-auth';

describe('Soul Ops auth helpers', () => {
  it('keeps the legacy ops token as admin for backward compatibility', () => {
    const entries = buildOpsTokenEntries({ legacyAdminToken: 'legacy-token' });

    expect(entries).toHaveLength(1);
    expect(resolveOpsPrincipal('legacy-token', entries)).toEqual({
      role: 'admin',
      actor: 'ops:legacy-admin',
    });
  });

  it('resolves optional viewer, operator, and admin tokens', () => {
    const entries = buildOpsTokenEntries({
      viewerToken: 'viewer-token',
      operatorToken: 'operator-token',
      adminToken: 'admin-token',
    });

    expect(resolveOpsPrincipal('viewer-token', entries)?.role).toBe('viewer');
    expect(resolveOpsPrincipal('operator-token', entries)?.role).toBe('operator');
    expect(resolveOpsPrincipal('admin-token', entries)?.role).toBe('admin');
    expect(resolveOpsPrincipal('unknown-token', entries)).toBeNull();
  });

  it('enforces role hierarchy for cleanup permissions', () => {
    expect(roleAllows('viewer', 'viewer')).toBe(true);
    expect(roleAllows('viewer', 'operator')).toBe(false);
    expect(roleAllows('operator', 'viewer')).toBe(true);
    expect(roleAllows('operator', 'operator')).toBe(true);
    expect(roleAllows('operator', 'admin')).toBe(false);
    expect(roleAllows('admin', 'admin')).toBe(true);

    expect(buildOpsPermissions('viewer')).toEqual({
      canReadOverview: true,
      canDryRunCleanup: false,
      canDeleteCleanup: false,
    });
    expect(buildOpsPermissions('operator')).toEqual({
      canReadOverview: true,
      canDryRunCleanup: true,
      canDeleteCleanup: false,
    });
    expect(buildOpsPermissions('admin')).toEqual({
      canReadOverview: true,
      canDryRunCleanup: true,
      canDeleteCleanup: true,
    });
  });
});
