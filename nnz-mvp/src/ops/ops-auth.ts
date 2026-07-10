import { isIP } from 'node:net';

export type OpsRole = 'viewer' | 'operator' | 'admin';

export interface OpsTokenConfig {
  legacyAdminToken?: string | undefined;
  viewerToken?: string | undefined;
  operatorToken?: string | undefined;
  adminToken?: string | undefined;
}

export interface OpsPrincipal {
  role: OpsRole;
  actor: string;
}

export interface OpsTokenEntry extends OpsPrincipal {
  token: string;
}

export interface OpsPermissions {
  canReadOverview: boolean;
  canDryRunCleanup: boolean;
  canDeleteCleanup: boolean;
}

export type OpsIpAllowlistEntry =
  | {
    kind: 'exact';
    value: string;
    version: 4 | 6;
  }
  | {
    kind: 'ipv4-cidr';
    value: string;
    baseAddress: string;
    maskBits: number;
    network: number;
    mask: number;
  };

const ROLE_RANK: Record<OpsRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

export function buildOpsTokenEntries(config: OpsTokenConfig): OpsTokenEntry[] {
  const entries: OpsTokenEntry[] = [];
  addToken(entries, config.legacyAdminToken, 'admin', 'ops:legacy-admin');
  addToken(entries, config.viewerToken, 'viewer', 'ops:viewer');
  addToken(entries, config.operatorToken, 'operator', 'ops:operator');
  addToken(entries, config.adminToken, 'admin', 'ops:admin');
  return entries;
}

export function resolveOpsPrincipal(
  token: string,
  entries: OpsTokenEntry[],
  equals: (left: string, right: string) => boolean = (left, right) => left === right,
): OpsPrincipal | null {
  for (const entry of entries) {
    if (equals(token, entry.token)) {
      return {
        role: entry.role,
        actor: entry.actor,
      };
    }
  }
  return null;
}

export function roleAllows(actual: OpsRole, required: OpsRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function buildOpsPermissions(role: OpsRole): OpsPermissions {
  return {
    canReadOverview: roleAllows(role, 'viewer'),
    canDryRunCleanup: roleAllows(role, 'operator'),
    canDeleteCleanup: roleAllows(role, 'admin'),
  };
}

export function parseOpsIpAllowlist(input: string | undefined): OpsIpAllowlistEntry[] {
  if (!input?.trim()) return [];
  return input
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parseOpsIpAllowlistEntry);
}

export function resolveOpsClientIp(
  headers: Record<string, string | string[] | undefined>,
  remoteAddress: string | null | undefined,
): string | null {
  return normalizeIpAddress(
    readFirstForwardedIp(headers['x-forwarded-for'])
      ?? readFirstHeader(headers['x-real-ip'])
      ?? remoteAddress
      ?? null,
  );
}

export function isOpsClientIpAllowed(
  clientIp: string | null,
  allowlist: OpsIpAllowlistEntry[],
): boolean {
  if (allowlist.length === 0) return true;
  const normalized = normalizeIpAddress(clientIp);
  if (!normalized) return false;
  const version = isIP(normalized);
  if (version === 0) return false;

  return allowlist.some((entry) => {
    if (entry.kind === 'exact') {
      return entry.version === version && entry.value === normalized;
    }
    if (version !== 4) return false;
    return ((ipv4ToInt(normalized) & entry.mask) >>> 0) === entry.network;
  });
}

function addToken(entries: OpsTokenEntry[], token: string | undefined, role: OpsRole, actor: string): void {
  if (!token?.trim()) return;
  entries.push({ token: token.trim(), role, actor });
}

function parseOpsIpAllowlistEntry(value: string): OpsIpAllowlistEntry {
  const cidrSeparator = value.indexOf('/');
  if (cidrSeparator >= 0) {
    const baseAddress = normalizeIpAddress(value.slice(0, cidrSeparator));
    const maskText = value.slice(cidrSeparator + 1).trim();
    const maskBits = Number(maskText);
    if (!baseAddress || isIP(baseAddress) !== 4 || !Number.isInteger(maskBits) || maskBits < 0 || maskBits > 32) {
      throw new Error('NNZ_OPS_ALLOWED_IPS contains an invalid IPv4 CIDR entry.');
    }
    const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
    return {
      kind: 'ipv4-cidr',
      value,
      baseAddress,
      maskBits,
      mask,
      network: (ipv4ToInt(baseAddress) & mask) >>> 0,
    };
  }

  const exact = normalizeIpAddress(value);
  if (!exact) {
    throw new Error('NNZ_OPS_ALLOWED_IPS contains an invalid IP address.');
  }
  const version = isIP(exact);
  if (version !== 4 && version !== 6) {
    throw new Error('NNZ_OPS_ALLOWED_IPS contains an invalid IP address.');
  }
  return { kind: 'exact', value: exact, version };
}

function readFirstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

function readFirstForwardedIp(value: string | string[] | undefined): string | null {
  const header = readFirstHeader(value);
  return header?.split(',')[0]?.trim() || null;
}

function normalizeIpAddress(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  if (normalized.startsWith('::ffff:')) return normalized.slice('::ffff:'.length);
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(normalized)) {
    return normalized.slice(0, normalized.lastIndexOf(':'));
  }
  return normalized;
}

function ipv4ToInt(value: string): number {
  return value
    .split('.')
    .reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
}
