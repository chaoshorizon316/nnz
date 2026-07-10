export type PersonaType = 'DECEASED' | 'PRESTORE';
export type SoulStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'GRADUATED';
export type MemoryType =
  | 'DESCRIPTION'
  | 'CHAT_EXCERPT'
  | 'CORRECTION'
  | 'NODE_MEMORY'
  | 'USER_CHRONICLE'
  | 'RISK';
export type MemorySource =
  | 'USER_INPUT'
  | 'UPLOAD'
  | 'CONVERSATION'
  | 'CORRECTION'
  | 'NODE'
  | 'SYSTEM';
export type MemorySensitivity = 'LOW' | 'MEDIUM' | 'HIGH' | 'RESTRICTED';
export type MemoryCreatedBy = 'USER' | 'ASSISTANT' | 'SYSTEM';
export type MemoryState = 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
export type ProposalStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';
export type RuntimeState = 'ACTIVE' | 'SEALED' | 'NODE' | 'GRADUATED';
export type NodeStatus = 'ACTIVE' | 'COMPLETED';
export type MessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM';
export type OpsAuditAction =
  | 'ACCESS_DENIED'
  | 'SESSION_CREATE'
  | 'OVERVIEW_READ'
  | 'CLEANUP_DRY_RUN'
  | 'CLEANUP_DELETE'
  | 'AUDIT_QUERY';
export type OpsAuditOutcome = 'SUCCESS' | 'DENIED' | 'FAILED';
export type SoulMaturityLevel =
  | 'L0_SEED'
  | 'L1_SKETCH'
  | 'L2_USABLE'
  | 'L3_STABLE'
  | 'L4_SEALED_READY'
  | 'L5_LEGACY_READY';
export type SoulRecommendationType =
  | 'ASK_MORE_MEMORY'
  | 'REQUEST_CHAT_UPLOAD'
  | 'REVIEW_PROPOSAL'
  | 'REVIEW_CONFLICT'
  | 'SUGGEST_SEAL'
  | 'LIMIT_RUNTIME'
  | 'REVIEW_RISK'
  | 'READY_FOR_NODE'
  | 'READY_FOR_GRADUATION';
export type SoulRecommendationPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type SoulRecommendationStatus = 'OPEN' | 'ACKED' | 'DONE' | 'DISMISSED';

export interface User {
  id: string;
  displayName: string;
  createdAt: Date;
}

export interface Persona {
  id: string;
  userId: string;
  displayName: string;
  relationship: string;
  type: PersonaType;
  createdAt: Date;
}

export interface SoulVersion {
  id: string;
  userId: string;
  personaId: string;
  version: number;
  kernelJson: Record<string, unknown>;
  status: SoulStatus;
  knowledgeCutoff?: Date;
  createdAt: Date;
}

export interface SoulSnapshot {
  id: string;
  userId: string;
  personaId: string;
  soulVersionId: string;
  kernelJson: Record<string, unknown>;
  memoryIds: string[];
  sealedAt: Date;
}

export interface MemoryItem {
  id: string;
  userId: string;
  personaId: string;
  type: MemoryType;
  source: MemorySource;
  content: string;
  confidence: number;
  sensitivity: MemorySensitivity;
  enabledForSoul: boolean;
  enabledForRuntime: boolean;
  enabledForSoulUpdate: boolean;
  evidenceIds: string[];
  createdBy: MemoryCreatedBy;
  state: MemoryState;
  createdAt: Date;
}

export interface SoulUpdateProposal {
  id: string;
  userId: string;
  personaId: string;
  fieldPath: string;
  oldValue: unknown;
  newValue: unknown;
  evidenceIds: string[];
  status: ProposalStatus;
  createdAt: Date;
}

export interface NodeEvent {
  id: string;
  userId: string;
  personaId: string;
  name: string;
  status: NodeStatus;
  startAt: Date;
  endAt: Date;
}

export interface ConversationMessage {
  id: string;
  userId: string;
  personaId: string;
  nodeId?: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
}

export interface RuntimeSession {
  userId: string;
  personaId: string;
  state: RuntimeState;
  soulSnapshotId?: string;
  nodeContext?: {
    nodeId: string;
    nodeName: string;
  };
  dailyMessageCount?: number;
  lastMessageDate?: string;
}

export interface OpsAuditEvent {
  id: string;
  action: OpsAuditAction;
  outcome: OpsAuditOutcome;
  actor: string;
  targetUserIds: string[];
  metadata: Record<string, string | number | boolean | null>;
  createdAt: Date;
}

export interface RuntimeContext {
  state: RuntimeState;
  soul: SoulVersion;
  memories: MemoryItem[];
  nodeName?: string;
}

export interface UserPersonaScope {
  userId: string;
  personaId: string;
}

export interface SoulRecommendation {
  id: string;
  userId: string;
  personaId: string;
  type: SoulRecommendationType;
  priority: SoulRecommendationPriority;
  reason: string;
  status: SoulRecommendationStatus;
  createdAt: Date;
}

export interface SoulMaturityReport {
  id: string;
  userId: string;
  personaId: string;
  soulVersionId?: string;
  score: number;
  level: SoulMaturityLevel;
  evidenceCoverage: number;
  identityClarity: number;
  voiceConsistency: number;
  memoryReliability: number;
  runtimeStability: number;
  safetyReadiness: number;
  memoryCount: number;
  runtimeMemoryCount: number;
  soulUpdateMemoryCount: number;
  proposalCount: number;
  pendingProposalCount: number;
  acceptedProposalCount: number;
  rejectedProposalCount: number;
  snapshotCount: number;
  nodeCount: number;
  runtimeState: RuntimeState;
  recommendations: SoulRecommendation[];
  createdAt: Date;
}
