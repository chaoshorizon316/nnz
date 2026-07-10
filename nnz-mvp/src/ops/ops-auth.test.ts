import { describe, expect, it } from 'vitest';

import {
  buildOpsPermissions,
  buildOpsTokenEntries,
  isOpsClientIpAllowed,
  parseOpsIpAllowlist,
  parseOpsSessionTtlMinutes,
  resolveOpsClientIp,
  resolveOpsPrincipal,
  roleAllows,
} from './ops-auth';

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

  it('allows all client IPs when the Ops allowlist is empty', () => {
    expect(isOpsClientIpAllowed('203.0.113.10', parseOpsIpAllowlist(undefined))).toBe(true);
    expect(isOpsClientIpAllowed(null, parseOpsIpAllowlist(''))).toBe(true);
  });

  it('matches exact IP entries and IPv4 CIDR ranges', () => {
    const allowlist = parseOpsIpAllowlist('203.0.113.8, 198.51.100.0/24, ::1');

    expect(isOpsClientIpAllowed('203.0.113.8', allowlist)).toBe(true);
    expect(isOpsClientIpAllowed('198.51.100.77', allowlist)).toBe(true);
    expect(isOpsClientIpAllowed('198.51.101.77', allowlist)).toBe(false);
    expect(isOpsClientIpAllowed('::1', allowlist)).toBe(true);
  });

  it('resolves proxy and socket client IPs without trusting later forwarded hops', () => {
    expect(resolveOpsClientIp({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }, '127.0.0.1')).toBe('198.51.100.7');
    expect(resolveOpsClientIp({ 'x-real-ip': '203.0.113.9' }, '127.0.0.1')).toBe('203.0.113.9');
    expect(resolveOpsClientIp({}, '::ffff:127.0.0.1')).toBe('127.0.0.1');
  });

  it('rejects malformed allowlist entries at startup config time', () => {
    expect(() => parseOpsIpAllowlist('203.0.113.1/33')).toThrow('invalid IPv4 CIDR');
    expect(() => parseOpsIpAllowlist('not-an-ip')).toThrow('invalid IP address');
  });

  it('parses optional Ops session TTL minutes as a positive integer', () => {
    expect(parseOpsSessionTtlMinutes(undefined)).toBeUndefined();
    expect(parseOpsSessionTtlMinutes('')).toBeUndefined();
    expect(parseOpsSessionTtlMinutes('15')).toBe(15);
    expect(() => parseOpsSessionTtlMinutes('0')).toThrow('NNZ_OPS_SESSION_TTL_MINUTES');
    expect(() => parseOpsSessionTtlMinutes('1.5')).toThrow('NNZ_OPS_SESSION_TTL_MINUTES');
  });
});
