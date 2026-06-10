import { randomUUID } from 'node:crypto';

import { CovenantStateError, NotFoundError, OwnershipError, ScopeValidationError } from './errors';
import type {
  ConversationMessage,
  MemoryCreatedBy,
  MemoryItem,
  MemorySensitivity,
  MemorySource,
  MemoryState,
  MemoryType,
  NodeEvent,
  Persona,
  PersonaType,
  RuntimeContext,
  RuntimeSession,
  RuntimeState,
  SoulMaturityLevel,
  SoulMaturityReport,
  SoulRecommendation,
  SoulRecommendationType,
  SoulSnapshot,
  SoulStatus,
  SoulUpdateProposal,
  SoulVersion,
  User,
  UserPersonaScope,
} from './types';
import type { CredentialRecord } from '../auth/auth';

type OptionalScope = Partial<UserPersonaScope> | undefined;

interface CreatePersonaInput {
  userId: string;
  displayName: string;
  relationship: string;
  type: PersonaType;
}

interface CreateSoulVersionInput extends UserPersonaScope {
  kernelJson: Record<string, unknown>;
  status?: SoulStatus;
}

interface AddMemoryInput extends UserPersonaScope {
  type: MemoryType;
  source?: MemorySource;
  content: string;
  confidence: number;
  enabledForSoul: boolean;
  sensitivity?: MemorySensitivity;
  enabledForRuntime?: boolean;
  enabledForSoulUpdate?: boolean;
  evidenceIds?: string[];
  createdBy?: MemoryCreatedBy;
  state?: MemoryState;
}

interface CreateSoulUpdateProposalInput extends UserPersonaScope {
  fieldPath: string;
  newValue: unknown;
  evidenceIds: string[];
}

interface CreateNodeInput extends UserPersonaScope {
  name: string;
  durationDays?: number;
}

interface AddConversationInput extends UserPersonaScope {
  nodeId?: string;
  role: ConversationMessage['role'];
  content: string;
}

export class InMemorySoulStore {
  private readonly users = new Map<string, User>();
  private readonly personas = new Map<string, Persona>();
  private readonly soulVersions = new Map<string, SoulVersion>();
  private readonly soulSnapshots = new Map<string, SoulSnapshot>();
  private readonly memoryItems = new Map<string, MemoryItem>();
  private readonly soulUpdateProposals = new Map<string, SoulUpdateProposal>();
  private readonly nodeEvents = new Map<string, NodeEvent>();
  private readonly conversationMessages = new Map<string, ConversationMessage>();
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly credentials = new Map<string, CredentialRecord>();

  createUser(displayName: string): User {
    const user: User = {
      id: this.id('user'),
      displayName,
      createdAt: new Date(),
    };
    this.users.set(user.id, user);
    return user;
  }

  createPersona(input: CreatePersonaInput): Persona {
    this.requireUser(input.userId);

    const persona: Persona = {
      id: this.id('persona'),
      userId: input.userId,
      displayName: input.displayName,
      relationship: input.relationship,
      type: input.type,
      createdAt: new Date(),
    };
    this.personas.set(persona.id, persona);
    return persona;
  }

  listPersonasForUser(userId: string): Persona[] {
    this.requireUser(userId);
    return [...this.personas.values()]
      .filter((persona) => persona.userId === userId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  getPersonaForUser(userId: string, personaId: string): Persona {
    return this.requirePersonaOwnership({ userId, personaId });
  }

  createSoulVersion(input: CreateSoulVersionInput): SoulVersion {
    const scope = this.requireScope(input);
    this.requirePersonaOwnership(scope);
    const status = input.status ?? 'ACTIVE';

    if (status === 'ACTIVE') {
      this.archiveActiveSoulVersions(scope);
    }

    const version: SoulVersion = {
      id: this.id('soul'),
      userId: scope.userId,
      personaId: scope.personaId,
      version: this.nextSoulVersionNumber(scope),
      kernelJson: cloneJson(input.kernelJson),
      status,
      createdAt: new Date(),
    };
    this.soulVersions.set(version.id, version);
    return version;
  }

  getLatestSoulVersion(scopeInput: OptionalScope): SoulVersion {
    const scope = this.requireScope(scopeInput);
    this.requirePersonaOwnership(scope);

    const versions = this.listSoulVersionsAll(scope).filter((version) => version.status === 'ACTIVE');
    const latest = versions.at(-1);
    if (!latest) {
      throw new NotFoundError(`No ACTIVE soul version found for user ${scope.userId} and persona ${scope.personaId}.`);
    }
    return latest;
  }

  listSoulVersions(scopeInput: OptionalScope): SoulVersion[] {
    const scope = this.requireScope(scopeInput);
    this.requirePersonaOwnership(scope);
    return this.listSoulVersionsAll(scope);
  }

  createSoulSnapshot(scopeInput: OptionalScope): SoulSnapshot {
    const scope = this.requireScope(scopeInput);
    this.requirePersonaOwnership(scope);

    const soulVersion = this.getLatestSoulVersion(scope);
    const memories = this.listMemory(scope);

    const snapshot: SoulSnapshot = {
      id: this.id('snapshot'),
      userId: scope.userId,
      personaId: scope.personaId,
      soulVersionId: soulVersion.id,
      kernelJson: cloneJson(soulVersion.kernelJson),
      memoryIds: memories.map((m) => m.id),
      sealedAt: new Date(),
    };
    this.soulSnapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  getSoulSnapshot(scopeInput: OptionalScope, snapshotId: string): SoulSnapshot {
    const scope = this.requireScope(scopeInput);
    this.requirePersonaOwnership(scope);

    const snapshot = this.soulSnapshots.get(snapshotId);
    if (!snapshot || snapshot.userId !== scope.userId || snapshot.personaId !== scope.personaId) {
      throw new NotFoundError(`Soul snapshot ${snapshotId} was not found in the requested user/persona scope.`);
    }
    return snapshot;
  }

  addMemory(input: AddMemoryInput): MemoryItem {
    const scope = this.requireScope(input);
    this.requirePersonaOwnership(scope);
    this.requireConfidence(input.confidence);

    const memory: MemoryItem = {
      id: this.id('memory'),
      userId: scope.userId,
      personaId: scope.personaId,
      type: input.type,
      source: input.source ?? defaultMemorySource(input.type),
      content: input.content,
      confidence: input.confidence,
      sensitivity: input.sensitivity ?? defaultMemorySensitivity(input.type),
      enabledForSoul: input.enabledForSoul,
      enabledForRuntime: input.enabledForRuntime ?? defaultEnabledForRuntime(input.type, input.enabledForSoul),
      enabledForSoulUpdate: input.enabledForSoulUpdate ?? defaultEnabledForSoulUpdate(input.type, input.enabledForSoul),
      evidenceIds: [...(input.evidenceIds ?? [])],
      createdBy: input.createdBy ?? defaultCreatedBy(input.type),
      state: input.state ?? 'ACTIVE',
      createdAt: new Date(),
    };
    this.memoryItems.set(memory.id, memory);
    return memory;
  }

  listMemory(scopeInput: OptionalScope): MemoryItem[] {
    const scope = this.requireScope(scopeInput);
    this.requirePersonaOwnership(scope);
    return [...this.memoryItems.values()]
      .filter((memory) => memory.userId === scope.userId && memory.personaId === scope.personaId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  listRuntimeMemory(scopeInput: OptionalScope): MemoryItem[] {
    return this.listMemory(scopeInput).filter(
      (memory) => memory.state === 'ACTIVE'
        && memory.enabledForRuntime
        && memory.type !== 'RISK'
        && memory.sensitivity !== 'RESTRICTED',
    );
  }

  listSoulUpdateMemory(scopeInput: OptionalScope): MemoryItem[] {
    return this.listMemory(scopeInput).filter(
      (memory) => memory.state === 'ACTIVE'
        && memory.enabledForSoulUpdate
        && memory.type !== 'NODE_MEMORY'
        && memory.type !== 'RISK'
        && memory.sensitivity !== 'RESTRICTED',
    );
  }

  createSoulUpdateProposal(input: CreateSoulUpdateProposalInput): SoulUpdateProposal {
    const scope = this.requireScope(input);
    this.requirePersonaOwnership(scope);
    this.requireAllowedSoulFieldPath(input.fieldPath);
    this.requireSoulUpdateEvidence(scope, input.evidenceIds);
    const latest = this.getLatestSoulVersion(scope);

    const proposal: SoulUpdateProposal = {
      id: this.id('proposal'),
      userId: scope.userId,
      personaId: scope.personaId,
      fieldPath: input.fieldPath,
      oldValue: getByPath(latest.kernelJson, input.fieldPath),
      newValue: cloneValue(input.newValue),
      evidenceIds: [...input.evidenceIds],
      status: 'PENDING',
      createdAt: new Date(),
    };
    this.soulUpdateProposals.set(proposal.id, proposal);
    return proposal;
  }

  listSoulUpdateProposals(
    scopeInput: OptionalScope,
    status?: SoulUpdateProposal['status'],
  ): SoulUpdateProposal[] {
    const scope = this.requireScope(scopeInput);
    this.requirePersonaOwnership(scope);
    return [...this.soulUpdateProposals.values()]
      .filter((proposal) => proposal.userId === scope.userId && proposal.personaId === scope.personaId)
      .filter((proposal) => !status || proposal.status === status)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  listSoulUpdateProposalEvidence(scopeInput: OptionalScope, proposalId: string): MemoryItem[] {
    const scope = this.requireScope(scopeInput);
    const proposal = this.requireSoulUpdateProposal(scope, proposalId);
    return proposal.evidenceIds.map((evidenceId) => {
      const memory = this.memoryItems.get(evidenceId);
      if (!memory || memory.userId !== scope.userId || memory.personaId !== scope.personaId) {
        throw new NotFoundError(`Memory ${evidenceId} was not found in the requested user/persona scope.`);
      }
      return memory;
    });
  }

  acceptSoulUpdateProposal(scopeInput: OptionalScope, proposalId: string): SoulVersion {
    const scope = this.requireScope(scopeInput);
    const proposal = this.requireSoulUpdateProposal(scope, proposalId);
    if (proposal.status !== 'PENDING') {
      throw new Error(`Soul update proposal ${proposalId} is already ${proposal.status}.`);
    }

    const latest = this.getLatestSoulVersion(scope);
    const nextKernel = cloneJson(latest.kernelJson);
    setByPath(nextKernel, proposal.fieldPath, cloneValue(proposal.newValue));
    proposal.status = 'ACCEPTED';

    return this.createSoulVersion({
      ...scope,
      kernelJson: nextKernel,
      status: 'ACTIVE',
    });
  }

  rejectSoulUpdateProposal(scopeInput: OptionalScope, proposalId: string): SoulUpdateProposal {
    const scope = this.requireScope(scopeInput);
    const proposal = this.requireSoulUpdateProposal(scope, proposalId);
    if (proposal.status !== 'PENDING') {
      throw new Error(`Soul update proposal ${proposalId} is already ${proposal.status}.`);
    }
    proposal.status = 'REJECTED';
    return proposal;
  }

  createNode(input: CreateNodeInput): NodeEvent {
    const scope = this.requireScope(input);
    this.requirePersonaOwnership(scope);
    const startAt = new Date();
    const endAt = new Date(startAt);
    endAt.setDate(endAt.getDate() + (input.durationDays ?? 3));

    const node: NodeEvent = {
      id: this.id('node'),
      userId: scope.userId,
      personaId: scope.personaId,
      name: input.name,
      status: 'ACTIVE',
      startAt,
      endAt,
    };
    this.nodeEvents.set(node.id, node);
    return node;
  }

  listNodes(scopeInput: OptionalScope): NodeEvent[] {
    const scope = this.requireScope(scopeInput);
    this.requirePersonaOwnership(scope);
    return [...this.nodeEvents.values()]
      .filter((node) => node.userId === scope.userId && node.personaId === scope.personaId)
      .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
  }

  addConversation(input: AddConversationInput): ConversationMessage {
    const scope = this.requireScope(input);
    this.requirePersonaOwnership(scope);
    if (input.nodeId) {
      this.requireNodeOwnership(scope, input.nodeId);
    }

    const message: ConversationMessage = {
      id: this.id('message'),
      userId: scope.userId,
      personaId: scope.personaId,
      role: input.role,
      content: input.content,
      createdAt: new Date(),
    };
    if (input.nodeId) {
      message.nodeId = input.nodeId;
    }
    this.conversationMessages.set(message.id, message);
    return message;
  }

  listConversations(scopeInput: OptionalScope): ConversationMessage[] {
    const scope = this.requireScope(scopeInput);
    this.requirePersonaOwnership(scope);
    return [...this.conversationMessages.values()]
      .filter((message) => message.userId === scope.userId && message.personaId === scope.personaId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  buildSoulMaturityReport(scopeInput: OptionalScope): SoulMaturityReport {
    const scope = this.requireScope(scopeInput);
    this.requirePersonaOwnership(scope);

    const createdAt = new Date();
    const latestSoul = this.tryGetLatestSoulVersion(scope);
    const memories = this.listMemory(scope);
    const runtimeMemories = this.listRuntimeMemory(scope);
    const soulUpdateMemories = this.listSoulUpdateMemory(scope);
    const proposals = this.listSoulUpdateProposals(scope);
    const snapshots = this.listSoulSnapshots(scope);
    const nodes = this.listNodes(scope);
    const conversations = this.listConversations(scope);
    const session = this.getRuntimeSession(scope);
    const riskMemories = memories.filter((memory) => memory.type === 'RISK' || memory.sensitivity === 'RESTRICTED');

    const evidenceCoverage = calculateEvidenceCoverage(memories, soulUpdateMemories, conversations);
    const identityClarity = latestSoul ? calculateIdentityClarity(latestSoul.kernelJson) : 0;
    const voiceConsistency = latestSoul ? calculateVoiceConsistency(latestSoul.kernelJson, proposals) : 0;
    const memoryReliability = calculateMemoryReliability(memories, proposals);
    const runtimeStability = calculateRuntimeStability(session.state, conversations, proposals);
    const safetyReadiness = calculateSafetyReadiness(session.state, riskMemories, conversations);
    const score = clampScore(
      evidenceCoverage * 0.25
      + identityClarity * 0.15
      + voiceConsistency * 0.15
      + memoryReliability * 0.15
      + runtimeStability * 0.15
      + safetyReadiness * 0.15,
    );
    const pendingProposalCount = proposals.filter((proposal) => proposal.status === 'PENDING').length;
    const acceptedProposalCount = proposals.filter((proposal) => proposal.status === 'ACCEPTED').length;
    const rejectedProposalCount = proposals.filter((proposal) => proposal.status === 'REJECTED').length;

    const report: SoulMaturityReport = {
      id: `maturity_${scope.userId}_${scope.personaId}`,
      userId: scope.userId,
      personaId: scope.personaId,
      score,
      level: maturityLevel(score),
      evidenceCoverage,
      identityClarity,
      voiceConsistency,
      memoryReliability,
      runtimeStability,
      safetyReadiness,
      memoryCount: memories.length,
      runtimeMemoryCount: runtimeMemories.length,
      soulUpdateMemoryCount: soulUpdateMemories.length,
      proposalCount: proposals.length,
      pendingProposalCount,
      acceptedProposalCount,
      rejectedProposalCount,
      snapshotCount: snapshots.length,
      nodeCount: nodes.length,
      runtimeState: session.state,
      recommendations: buildRecommendations({
        scope,
        createdAt,
        score,
        sessionState: session.state,
        memories,
        soulUpdateMemories,
        proposals,
        snapshots,
        conversations,
        riskMemories,
      }),
      createdAt,
    };
    if (latestSoul) {
      report.soulVersionId = latestSoul.id;
    }
    return report;
  }

  deleteUserScopedData(userId: string): void {
    this.requireUser(userId);

    for (const collection of [
      this.personas,
      this.soulVersions,
      this.soulSnapshots,
      this.memoryItems,
      this.soulUpdateProposals,
      this.nodeEvents,
      this.conversationMessages,
    ]) {
      for (const [id, record] of collection) {
        if (record.userId === userId) {
          collection.delete(id);
        }
      }
    }
    for (const [credentialUserId] of this.credentials) {
      if (credentialUserId === userId) this.credentials.delete(credentialUserId);
    }
    for (const [key, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.delete(key);
      }
    }
    this.users.delete(userId);
  }



  // ── Credentials ──

  storeCredential(userId: string, email: string, passwordHash: string): void {
    this.requireUser(userId);
    this.credentials.set(userId, { userId, email, passwordHash, createdAt: new Date().toISOString() });
  }

  getCredentialByEmail(email: string): CredentialRecord | undefined {
    for (const c of this.credentials.values()) {
      if (c.email === email) return c;
    }
    return undefined;
  }

  // ── Persistence helpers ──

  serialize(): {
    users: User[];
    personas: Persona[];
    soulVersions: SoulVersion[];
    soulSnapshots: SoulSnapshot[];
    memoryItems: MemoryItem[];
    soulUpdateProposals: SoulUpdateProposal[];
    nodeEvents: NodeEvent[];
    conversationMessages: ConversationMessage[];
    sessions: Array<{
      scopeKey: string;
      userId: string;
      personaId: string;
      state: string;
      soulSnapshotId?: string;
      nodeId?: string;
      nodeName?: string;
      dailyMessageCount?: number;
      lastMessageDate?: string;
    }>;
    credentials: CredentialRecord[];
  } {
    return {
      users: [...this.users.values()],
      personas: [...this.personas.values()],
      soulVersions: [...this.soulVersions.values()],
      soulSnapshots: [...this.soulSnapshots.values()],
      memoryItems: [...this.memoryItems.values()],
      soulUpdateProposals: [...this.soulUpdateProposals.values()],
      nodeEvents: [...this.nodeEvents.values()],
      conversationMessages: [...this.conversationMessages.values()],
      sessions: [...this.sessions.entries()].map(([scopeKey, session]) => ({
        scopeKey,
        ...session,
      })),
      credentials: [...this.credentials.values()],
    };
  }

  deserialize(data: {
    users: User[];
    personas: Persona[];
    soulVersions: SoulVersion[];
    soulSnapshots: SoulSnapshot[];
    memoryItems: MemoryItem[];
    soulUpdateProposals: SoulUpdateProposal[];
    nodeEvents: NodeEvent[];
    conversationMessages: ConversationMessage[];
    sessions: Array<{
      scopeKey: string;
      userId: string;
      personaId: string;
      state: string;
      soulSnapshotId?: string;
      nodeId?: string;
      nodeName?: string;
      dailyMessageCount?: number;
      lastMessageDate?: string;
    }>;
    credentials: CredentialRecord[];
  }): void {
    this.users.clear();
    this.personas.clear();
    this.soulVersions.clear();
    this.soulSnapshots.clear();
    this.memoryItems.clear();
    this.soulUpdateProposals.clear();
    this.nodeEvents.clear();
    this.conversationMessages.clear();
    this.sessions.clear();
    this.credentials.clear();

    for (const u of data.users) this.users.set(u.id, u);
    for (const p of data.personas) this.personas.set(p.id, p);
    for (const sv of data.soulVersions) this.soulVersions.set(sv.id, sv);
    for (const ss of data.soulSnapshots) this.soulSnapshots.set(ss.id, ss);
    for (const m of data.memoryItems) this.memoryItems.set(m.id, m);
    for (const sp of data.soulUpdateProposals) this.soulUpdateProposals.set(sp.id, sp);
    for (const n of data.nodeEvents) this.nodeEvents.set(n.id, n);
    for (const c of data.conversationMessages) this.conversationMessages.set(c.id, c);
    for (const s of data.sessions) {
      const session: RuntimeSession = {
        userId: s.userId,
        personaId: s.personaId,
        state: s.state as RuntimeState,
      };
      if (s.soulSnapshotId) session.soulSnapshotId = s.soulSnapshotId;
      if (s.nodeId && s.nodeName) {
        session.nodeContext = { nodeId: s.nodeId, nodeName: s.nodeName };
      }
      if (s.dailyMessageCount !== undefined) session.dailyMessageCount = s.dailyMessageCount;
      if (s.lastMessageDate !== undefined) session.lastMessageDate = s.lastMessageDate;
      this.sessions.set(s.scopeKey, session);
    }
    for (const c of data.credentials) {
      this.credentials.set(c.userId, c);
    }
  }

  // ── Covenant lifecycle ──

  sealSoul(scopeInput: OptionalScope): { snapshot: SoulSnapshot; session: RuntimeSession } {
    const scope = this.requireScope(scopeInput);
    this.requirePersonaOwnership(scope);

    const current = this.getRuntimeSession(scope);
    if (current.state !== 'ACTIVE') {
      throw new CovenantStateError(current.state);
    }

    const snapshot = this.createSoulSnapshot(scope);

    // Find the soul version referenced by the snapshot and archive it
    const soulVersion = this.soulVersions.get(snapshot.soulVersionId);
    if (soulVersion) {
      soulVersion.status = 'ARCHIVED';
    }

    const session: RuntimeSession = {
      userId: scope.userId,
      personaId: scope.personaId,
      state: 'SEALED',
      soulSnapshotId: snapshot.id,
      dailyMessageCount: current.dailyMessageCount ?? 0,
      lastMessageDate: current.lastMessageDate ?? todayString(),
    };
    this.setSession(scope, session);

    return { snapshot, session };
  }

  activateNode(scopeInput: OptionalScope, nodeName: string, durationDays?: number): { node: NodeEvent; session: RuntimeSession } {
    const scope = this.requireScope(scopeInput);
    this.requirePersonaOwnership(scope);

    const current = this.getRuntimeSession(scope);
    if (current.state !== 'SEALED') {
      throw new CovenantStateError(current.state);
    }

    const node = this.findReusableNode(scope, nodeName) ?? this.createNode({
      ...scope,
      name: nodeName,
      ...(durationDays === undefined ? {} : { durationDays }),
    });
    this.addNodeMemoryIfMissing(scope, nodeName);

    const session: RuntimeSession = {
      userId: scope.userId,
      personaId: scope.personaId,
      state: 'NODE',
      soulSnapshotId: current.soulSnapshotId!,
      nodeContext: {
        nodeId: node.id,
        nodeName,
      },
      dailyMessageCount: current.dailyMessageCount ?? 0,
      lastMessageDate: current.lastMessageDate ?? todayString(),
    };
    this.setSession(scope, session);

    return { node, session };
  }

  completeNode(scopeInput: OptionalScope): RuntimeSession {
    const scope = this.requireScope(scopeInput);
    this.requirePersonaOwnership(scope);

    const current = this.getRuntimeSession(scope);
    if (current.state !== 'NODE') {
      throw new CovenantStateError(current.state);
    }
    if (!current.nodeContext) {
      throw new Error('NODE session is missing nodeContext.');
    }

    const node = this.nodeEvents.get(current.nodeContext.nodeId);
    if (node) {
      node.status = 'COMPLETED';
    }

    const session: RuntimeSession = {
      userId: scope.userId,
      personaId: scope.personaId,
      state: 'SEALED',
      soulSnapshotId: current.soulSnapshotId!,
      dailyMessageCount: current.dailyMessageCount ?? 0,
      lastMessageDate: current.lastMessageDate ?? todayString(),
    };
    this.setSession(scope, session);

    return session;
  }

  graduateSoul(scopeInput: OptionalScope): RuntimeSession {
    const scope = this.requireScope(scopeInput);
    this.requirePersonaOwnership(scope);

    const current = this.getRuntimeSession(scope);
    if (current.state === 'GRADUATED') {
      throw new CovenantStateError(current.state);
    }

    // Archive all soul versions for this scope
    for (const [, soulVersion] of this.soulVersions) {
      if (soulVersion.userId === scope.userId && soulVersion.personaId === scope.personaId) {
        soulVersion.status = 'GRADUATED';
      }
    }

    const session: RuntimeSession = {
      userId: scope.userId,
      personaId: scope.personaId,
      state: 'GRADUATED',
      dailyMessageCount: current.dailyMessageCount ?? 0,
      lastMessageDate: current.lastMessageDate ?? todayString(),
    };
    this.setSession(scope, session);

    return session;
  }

  getRuntimeSession(scopeInput: OptionalScope): RuntimeSession {
    const scope = this.requireScope(scopeInput);
    this.requirePersonaOwnership(scope);

    const key = this.sessionKey(scope);
    const existing = this.sessions.get(key);
    if (existing) {
      return existing;
    }

    const fresh: RuntimeSession = {
      userId: scope.userId,
      personaId: scope.personaId,
      state: 'ACTIVE',
      dailyMessageCount: 0,
      lastMessageDate: todayString(),
    };
    this.sessions.set(key, fresh);
    return fresh;
  }

  getRuntimeContext(scopeInput: OptionalScope): RuntimeContext {
    const scope = this.requireScope(scopeInput);
    const session = this.getRuntimeSession(scope);

    if (session.state === 'SEALED') {
      throw new CovenantStateError('SEALED');
    }
    if (session.state === 'GRADUATED') {
      throw new CovenantStateError('GRADUATED');
    }

    if (session.state === 'NODE') {
      if (!session.soulSnapshotId) {
        throw new Error('NODE session is missing soulSnapshotId.');
      }
      const snapshot = this.getSoulSnapshot(scope, session.soulSnapshotId);
      const snapshotMemories: MemoryItem[] = [];
      for (const memoryId of snapshot.memoryIds) {
        const mem = this.memoryItems.get(memoryId);
        if (mem && mem.userId === scope.userId && mem.personaId === scope.personaId) {
          snapshotMemories.push(mem);
        }
      }
      const nodeMemories = this.listMemory(scope).filter(
        (m) => m.state === 'ACTIVE' && m.enabledForRuntime && m.type === 'NODE_MEMORY',
      );
      const allMemories = [...snapshotMemories, ...nodeMemories];

      const soul: SoulVersion = {
        id: snapshot.id,
        userId: scope.userId,
        personaId: scope.personaId,
        version: -1,
        kernelJson: cloneJson(snapshot.kernelJson),
        status: 'ARCHIVED',
        createdAt: snapshot.sealedAt,
      };

      const ctx: RuntimeContext = {
        state: 'NODE',
        soul,
        memories: allMemories,
      };
      if (session.nodeContext?.nodeName) {
        ctx.nodeName = session.nodeContext.nodeName;
      }
      return ctx;
    }

    // ACTIVE
    const soul = this.getLatestSoulVersion(scope);
    const memories = this.listRuntimeMemory(scope);
    return {
      state: 'ACTIVE',
      soul,
      memories,
    };
  }

  // ── Private helpers ──

  private listSoulVersionsAll(scope: UserPersonaScope): SoulVersion[] {
    return [...this.soulVersions.values()]
      .filter((version) => version.userId === scope.userId && version.personaId === scope.personaId)
      .sort((left, right) => left.version - right.version);
  }

  private listSoulSnapshots(scope: UserPersonaScope): SoulSnapshot[] {
    return [...this.soulSnapshots.values()]
      .filter((snapshot) => snapshot.userId === scope.userId && snapshot.personaId === scope.personaId)
      .sort((left, right) => left.sealedAt.getTime() - right.sealedAt.getTime());
  }

  private tryGetLatestSoulVersion(scope: UserPersonaScope): SoulVersion | undefined {
    try {
      return this.getLatestSoulVersion(scope);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return this.listSoulVersionsAll(scope).at(-1);
      }
      throw error;
    }
  }

  private archiveActiveSoulVersions(scope: UserPersonaScope): void {
    for (const soulVersion of this.soulVersions.values()) {
      if (
        soulVersion.userId === scope.userId
        && soulVersion.personaId === scope.personaId
        && soulVersion.status === 'ACTIVE'
      ) {
        soulVersion.status = 'ARCHIVED';
      }
    }
  }

  private findReusableNode(scope: UserPersonaScope, nodeName: string): NodeEvent | undefined {
    return this.listNodes(scope).find((node) => node.name === nodeName && node.status === 'ACTIVE');
  }

  private addNodeMemoryIfMissing(scope: UserPersonaScope, nodeName: string): void {
    const content = `节点「${nodeName}」已激活。`;
    const exists = this.listMemory(scope).some((memory) => memory.type === 'NODE_MEMORY' && memory.content === content);
    if (exists) {
      return;
    }
    this.addMemory({
      ...scope,
      type: 'NODE_MEMORY',
      content,
      confidence: 1,
      enabledForSoul: false,
    });
  }

  private setSession(scope: UserPersonaScope, session: RuntimeSession): void {
    this.sessions.set(this.sessionKey(scope), session);
  }

  private sessionKey(scope: UserPersonaScope): string {
    return `${scope.userId}:${scope.personaId}`;
  }

  private requireScope(scopeInput: OptionalScope): UserPersonaScope {
    if (!scopeInput?.userId || !scopeInput.personaId) {
      throw new ScopeValidationError('Soul, memory, snapshot, node, and conversation access requires both userId and personaId.');
    }
    return {
      userId: scopeInput.userId,
      personaId: scopeInput.personaId,
    };
  }

  private requireUser(userId: string): User {
    const user = this.users.get(userId);
    if (!user) {
      throw new NotFoundError(`User ${userId} was not found.`);
    }
    return user;
  }

  private requirePersonaOwnership(scope: UserPersonaScope): Persona {
    this.requireUser(scope.userId);
    const persona = this.personas.get(scope.personaId);
    if (!persona) {
      throw new NotFoundError(`Persona ${scope.personaId} was not found.`);
    }
    if (persona.userId !== scope.userId) {
      throw new OwnershipError(`Persona ${scope.personaId} does not belong to user ${scope.userId}.`);
    }
    return persona;
  }

  private requireNodeOwnership(scope: UserPersonaScope, nodeId: string): NodeEvent {
    const node = this.nodeEvents.get(nodeId);
    if (!node || node.userId !== scope.userId || node.personaId !== scope.personaId) {
      throw new OwnershipError(`Node ${nodeId} does not belong to the requested user/persona scope.`);
    }
    return node;
  }

  private requireSoulUpdateEvidence(scope: UserPersonaScope, evidenceIds: string[]): void {
    const allowedIds = new Set(this.listSoulUpdateMemory(scope).map((memory) => memory.id));
    for (const evidenceId of evidenceIds) {
      if (!allowedIds.has(evidenceId)) {
        throw new OwnershipError(`Memory ${evidenceId} is not allowed as Soul update evidence in this scope.`);
      }
    }
  }

  private requireSoulUpdateProposal(scope: UserPersonaScope, proposalId: string): SoulUpdateProposal {
    this.requirePersonaOwnership(scope);
    const proposal = this.soulUpdateProposals.get(proposalId);
    if (!proposal || proposal.userId !== scope.userId || proposal.personaId !== scope.personaId) {
      throw new NotFoundError(`Soul update proposal ${proposalId} was not found in the requested user/persona scope.`);
    }
    return proposal;
  }

  private requireAllowedSoulFieldPath(fieldPath: string): void {
    const allowed = new Set([
      'affectModel.humorLevel',
      'languageModel.petPhrases',
      'identityCore.relationship',
    ]);
    if (!allowed.has(fieldPath)) {
      throw new Error(`Soul update fieldPath "${fieldPath}" is not allowed.`);
    }
  }

  private requireConfidence(confidence: number): void {
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new RangeError('Memory confidence must be a number between 0 and 1.');
    }
  }

  private nextSoulVersionNumber(scope: UserPersonaScope): number {
    const versions = [...this.soulVersions.values()].filter(
      (version) => version.userId === scope.userId && version.personaId === scope.personaId,
    );
    return versions.length + 1;
  }

  private id(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }
}

function todayString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function cloneJson(source: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getByPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value && typeof value === 'object' && key in value) {
      return (value as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  const leaf = parts.pop();
  if (!leaf) {
    throw new Error('fieldPath must not be empty.');
  }

  let cursor: Record<string, unknown> = target;
  for (const part of parts) {
    const next = cursor[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[leaf] = value;
}

function calculateEvidenceCoverage(
  memories: MemoryItem[],
  soulUpdateMemories: MemoryItem[],
  conversations: ConversationMessage[],
): number {
  const activeMemories = memories.filter((memory) => memory.state === 'ACTIVE');
  const typeCount = new Set(activeMemories.map((memory) => memory.type)).size;
  const sourceCount = new Set(activeMemories.map((memory) => memory.source)).size;
  return clampScore(
    Math.min(activeMemories.length, 6) * 8
    + Math.min(soulUpdateMemories.length, 4) * 8
    + Math.min(conversations.length, 6) * 4
    + typeCount * 7
    + sourceCount * 5,
  );
}

function calculateIdentityClarity(kernelJson: Record<string, unknown>): number {
  const displayName = readStringByPath(kernelJson, 'identityCore.displayName');
  const relationship = readStringByPath(kernelJson, 'identityCore.relationship');
  const humorLevel = readStringByPath(kernelJson, 'affectModel.humorLevel');
  const petPhrases = readStringArrayByPath(kernelJson, 'languageModel.petPhrases');

  return clampScore(
    (displayName ? 30 : 0)
    + (relationship ? 30 : 0)
    + (humorLevel ? 20 : 0)
    + (petPhrases.length ? 20 : 0),
  );
}

function calculateVoiceConsistency(
  kernelJson: Record<string, unknown>,
  proposals: SoulUpdateProposal[],
): number {
  const petPhrases = readStringArrayByPath(kernelJson, 'languageModel.petPhrases');
  const humorLevel = readStringByPath(kernelJson, 'affectModel.humorLevel');
  const acceptedVoiceUpdates = proposals.filter(
    (proposal) => proposal.status === 'ACCEPTED'
      && (proposal.fieldPath === 'languageModel.petPhrases' || proposal.fieldPath === 'affectModel.humorLevel'),
  ).length;
  const pendingVoiceUpdates = proposals.filter(
    (proposal) => proposal.status === 'PENDING'
      && (proposal.fieldPath === 'languageModel.petPhrases' || proposal.fieldPath === 'affectModel.humorLevel'),
  ).length;

  return clampScore(
    (petPhrases.length ? 35 : 0)
    + (humorLevel ? 30 : 0)
    + Math.min(acceptedVoiceUpdates, 2) * 12
    - pendingVoiceUpdates * 8
    + 15,
  );
}

function calculateMemoryReliability(memories: MemoryItem[], proposals: SoulUpdateProposal[]): number {
  const activeMemories = memories.filter((memory) => memory.state === 'ACTIVE');
  if (!activeMemories.length) {
    return 35;
  }

  const averageConfidence = activeMemories.reduce((sum, memory) => sum + memory.confidence, 0) / activeMemories.length;
  const restrictedCount = activeMemories.filter((memory) => memory.sensitivity === 'RESTRICTED').length;
  const rejectedProposalCount = proposals.filter((proposal) => proposal.status === 'REJECTED').length;
  const pendingProposalCount = proposals.filter((proposal) => proposal.status === 'PENDING').length;

  return clampScore(
    averageConfidence * 70
    + Math.min(activeMemories.length, 4) * 6
    - restrictedCount * 20
    - rejectedProposalCount * 6
    - pendingProposalCount * 4,
  );
}

function calculateRuntimeStability(
  state: RuntimeState,
  conversations: ConversationMessage[],
  proposals: SoulUpdateProposal[],
): number {
  const assistantReplies = conversations.filter((message) => message.role === 'ASSISTANT').length;
  const pendingProposalCount = proposals.filter((proposal) => proposal.status === 'PENDING').length;
  const stateScore: Record<RuntimeState, number> = {
    ACTIVE: 55,
    SEALED: 70,
    NODE: 65,
    GRADUATED: 85,
  };

  return clampScore(
    stateScore[state]
    + Math.min(assistantReplies, 4) * 8
    - pendingProposalCount * 8,
  );
}

function calculateSafetyReadiness(
  state: RuntimeState,
  riskMemories: MemoryItem[],
  conversations: ConversationMessage[],
): number {
  const conversationLoadPenalty = Math.max(0, conversations.length - 10) * 2;
  const stateBonus: Record<RuntimeState, number> = {
    ACTIVE: 0,
    SEALED: 12,
    NODE: 4,
    GRADUATED: 20,
  };

  return clampScore(82 + stateBonus[state] - riskMemories.length * 35 - conversationLoadPenalty);
}

function maturityLevel(score: number): SoulMaturityLevel {
  if (score <= 20) return 'L0_SEED';
  if (score <= 40) return 'L1_SKETCH';
  if (score <= 60) return 'L2_USABLE';
  if (score <= 80) return 'L3_STABLE';
  if (score <= 90) return 'L4_SEALED_READY';
  return 'L5_LEGACY_READY';
}

interface RecommendationInput {
  scope: UserPersonaScope;
  createdAt: Date;
  score: number;
  sessionState: RuntimeState;
  memories: MemoryItem[];
  soulUpdateMemories: MemoryItem[];
  proposals: SoulUpdateProposal[];
  snapshots: SoulSnapshot[];
  conversations: ConversationMessage[];
  riskMemories: MemoryItem[];
}

function buildRecommendations(input: RecommendationInput): SoulRecommendation[] {
  const recommendations: SoulRecommendation[] = [];
  const add = (type: SoulRecommendationType, priority: SoulRecommendation['priority'], reason: string): void => {
    recommendations.push({
      id: `recommendation_${input.scope.userId}_${input.scope.personaId}_${type}_${recommendations.length + 1}`,
      userId: input.scope.userId,
      personaId: input.scope.personaId,
      type,
      priority,
      reason,
      status: 'OPEN',
      createdAt: input.createdAt,
    });
  };

  if (input.riskMemories.length) {
    add('REVIEW_RISK', 'HIGH', '存在风险或受限记忆，需要后台安全复核。');
  }
  if (input.soulUpdateMemories.length < 2) {
    add('ASK_MORE_MEMORY', 'HIGH', '可用于 Soul 更新的证据较少，建议继续引导用户补充资料。');
  }
  if (!input.memories.some((memory) => memory.type === 'CHAT_EXCERPT')) {
    add('REQUEST_CHAT_UPLOAD', 'MEDIUM', '缺少聊天摘录类证据，语言风格稳定性仍有限。');
  }
  if (input.proposals.some((proposal) => proposal.status === 'PENDING')) {
    add('REVIEW_PROPOSAL', 'HIGH', '存在待审核 Soul 更新提案，需要决定是否写入 Soul。');
  }
  if (input.proposals.filter((proposal) => proposal.status === 'REJECTED').length >= 2) {
    add('REVIEW_CONFLICT', 'MEDIUM', '多条提案被拒绝，可能存在证据冲突或字段更新过度。');
  }
  if (input.score >= 70 && input.sessionState === 'ACTIVE' && !input.snapshots.length) {
    add('SUGGEST_SEAL', 'MEDIUM', 'Soul 已较稳定，可考虑引导首次封存并创建快照。');
  }
  if (input.sessionState === 'SEALED' && input.snapshots.length) {
    add('READY_FOR_NODE', 'LOW', '当前已有封存快照，可在明确人生节点中短暂重启。');
  }
  if (input.sessionState === 'GRADUATED') {
    add('READY_FOR_GRADUATION', 'LOW', '该 Soul 已进入毕业状态，应优先支持导出与纪念物。');
  }
  if (input.conversations.length > 12 && input.sessionState === 'ACTIVE') {
    add('LIMIT_RUNTIME', 'MEDIUM', '当前对话强度偏高，建议观察依赖风险并评估封存节奏。');
  }

  return recommendations;
}

function readStringByPath(source: Record<string, unknown>, path: string): string | undefined {
  const value = getByPath(source, path);
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readStringArrayByPath(source: Record<string, unknown>, path: string): string[] {
  const value = getByPath(source, path);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function defaultMemorySource(type: MemoryType): MemorySource {
  if (type === 'CORRECTION') return 'CORRECTION';
  if (type === 'CHAT_EXCERPT') return 'CONVERSATION';
  if (type === 'NODE_MEMORY') return 'NODE';
  if (type === 'RISK') return 'SYSTEM';
  return 'USER_INPUT';
}

function defaultMemorySensitivity(type: MemoryType): MemorySensitivity {
  if (type === 'RISK') return 'RESTRICTED';
  if (type === 'USER_CHRONICLE') return 'MEDIUM';
  return 'LOW';
}

function defaultEnabledForRuntime(type: MemoryType, enabledForSoul: boolean): boolean {
  if (type === 'RISK') return false;
  if (type === 'NODE_MEMORY') return true;
  return enabledForSoul;
}

function defaultEnabledForSoulUpdate(type: MemoryType, enabledForSoul: boolean): boolean {
  if (type === 'CORRECTION') return enabledForSoul;
  if (type === 'DESCRIPTION' || type === 'CHAT_EXCERPT' || type === 'USER_CHRONICLE') return enabledForSoul;
  return false;
}

function defaultCreatedBy(type: MemoryType): MemoryCreatedBy {
  if (type === 'RISK') return 'SYSTEM';
  return 'USER';
}
