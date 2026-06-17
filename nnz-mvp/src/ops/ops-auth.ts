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

function addToken(entries: OpsTokenEntry[], token: string | undefined, role: OpsRole, actor: string): void {
  if (!token?.trim()) return;
  entries.push({ token: token.trim(), role, actor });
}
