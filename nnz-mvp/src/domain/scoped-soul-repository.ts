import { ScopeValidationError } from './errors';
import type {
  AddConversationInput,
  AddMemoryInput,
  CreateNodeInput,
  CreateSoulUpdateProposalInput,
  CreateSoulVersionInput,
  InMemorySoulStore,
} from './soul-store';
import type {
  ConversationMessage,
  MemoryItem,
  NodeEvent,
  Persona,
  RuntimeContext,
  RuntimeSession,
  SoulMaturityReport,
  SoulSnapshot,
  SoulUpdateProposal,
  SoulVersion,
  UserPersonaScope,
} from './types';

type OptionalScope = Partial<UserPersonaScope> | undefined;

export type ScopedCreateSoulVersionInput = Omit<CreateSoulVersionInput, 'userId' | 'personaId'>;
export type ScopedAddMemoryInput = Omit<AddMemoryInput, 'userId' | 'personaId'>;
export type ScopedCreateSoulUpdateProposalInput = Omit<
  CreateSoulUpdateProposalInput,
  'userId' | 'personaId'
>;
export type ScopedCreateNodeInput = Omit<CreateNodeInput, 'userId' | 'personaId'>;
export type ScopedAddConversationInput = Omit<AddConversationInput, 'userId' | 'personaId'>;

export class ScopedSoulRepository {
  private readonly scopeValue: UserPersonaScope;

  constructor(
    private readonly store: InMemorySoulStore,
    scopeInput: OptionalScope,
  ) {
    this.scopeValue = requireBoundScope(scopeInput);
    this.store.getPersonaForUser(this.scopeValue.userId, this.scopeValue.personaId);
  }

  get scope(): UserPersonaScope {
    return { ...this.scopeValue };
  }

  getPersona(): Persona {
    return this.store.getPersonaForUser(this.scopeValue.userId, this.scopeValue.personaId);
  }

  createSoulVersion(input: ScopedCreateSoulVersionInput): SoulVersion {
    return this.store.createSoulVersion({ ...input, ...this.scopeValue });
  }

  getLatestSoulVersion(): SoulVersion {
    return this.store.getLatestSoulVersion(this.scopeValue);
  }

  listSoulVersions(): SoulVersion[] {
    return this.store.listSoulVersions(this.scopeValue);
  }

  createSoulSnapshot(): SoulSnapshot {
    return this.store.createSoulSnapshot(this.scopeValue);
  }

  getSoulSnapshot(snapshotId: string): SoulSnapshot {
    return this.store.getSoulSnapshot(this.scopeValue, snapshotId);
  }

  addMemory(input: ScopedAddMemoryInput): MemoryItem {
    return this.store.addMemory({ ...input, ...this.scopeValue });
  }

  listMemory(): MemoryItem[] {
    return this.store.listMemory(this.scopeValue);
  }

  listRuntimeMemory(): MemoryItem[] {
    return this.store.listRuntimeMemory(this.scopeValue);
  }

  listSoulUpdateMemory(): MemoryItem[] {
    return this.store.listSoulUpdateMemory(this.scopeValue);
  }

  createSoulUpdateProposal(input: ScopedCreateSoulUpdateProposalInput): SoulUpdateProposal {
    return this.store.createSoulUpdateProposal({ ...input, ...this.scopeValue });
  }

  listSoulUpdateProposals(status?: SoulUpdateProposal['status']): SoulUpdateProposal[] {
    return this.store.listSoulUpdateProposals(this.scopeValue, status);
  }

  listSoulUpdateProposalEvidence(proposalId: string): MemoryItem[] {
    return this.store.listSoulUpdateProposalEvidence(this.scopeValue, proposalId);
  }

  acceptSoulUpdateProposal(proposalId: string): SoulVersion {
    return this.store.acceptSoulUpdateProposal(this.scopeValue, proposalId);
  }

  rejectSoulUpdateProposal(proposalId: string): SoulUpdateProposal {
    return this.store.rejectSoulUpdateProposal(this.scopeValue, proposalId);
  }

  createNode(input: ScopedCreateNodeInput): NodeEvent {
    return this.store.createNode({ ...input, ...this.scopeValue });
  }

  listNodes(): NodeEvent[] {
    return this.store.listNodes(this.scopeValue);
  }

  addConversation(input: ScopedAddConversationInput): ConversationMessage {
    return this.store.addConversation({ ...input, ...this.scopeValue });
  }

  listConversations(): ConversationMessage[] {
    return this.store.listConversations(this.scopeValue);
  }

  buildSoulMaturityReport(): SoulMaturityReport {
    return this.store.buildSoulMaturityReport(this.scopeValue);
  }

  sealSoul(): { snapshot: SoulSnapshot; session: RuntimeSession } {
    return this.store.sealSoul(this.scopeValue);
  }

  activateNode(nodeName: string, durationDays?: number): { node: NodeEvent; session: RuntimeSession } {
    return this.store.activateNode(this.scopeValue, nodeName, durationDays);
  }

  completeNode(): RuntimeSession {
    return this.store.completeNode(this.scopeValue);
  }

  graduateSoul(): RuntimeSession {
    return this.store.graduateSoul(this.scopeValue);
  }

  getRuntimeSession(): RuntimeSession {
    return this.store.getRuntimeSession(this.scopeValue);
  }

  getRuntimeContext(): RuntimeContext {
    return this.store.getRuntimeContext(this.scopeValue);
  }
}

export function bindSoulRepository(
  store: InMemorySoulStore,
  scopeInput: OptionalScope,
): ScopedSoulRepository {
  return new ScopedSoulRepository(store, scopeInput);
}

function requireBoundScope(scopeInput: OptionalScope): UserPersonaScope {
  if (!scopeInput?.userId || !scopeInput.personaId) {
    throw new ScopeValidationError('ScopedSoulRepository requires both userId and personaId.');
  }
  return {
    userId: scopeInput.userId,
    personaId: scopeInput.personaId,
  };
}
