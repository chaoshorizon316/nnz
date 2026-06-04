import type { MemoryItem, SoulUpdateProposal } from '../domain/types';
import type { ExtractionField, MergedField } from './types';
import { SOUL_FIELD_MAP } from './types';

const SOURCE_WEIGHT_USER_INPUT = 0.8;
const SOURCE_WEIGHT_CONVERSATION = 0.5;
const EVIDENCE_BONUS = 0.2;
const CONSISTENCY_BONUS = 0.1;
const CONFLICT_PENALTY = 0.1;
const PROPOSAL_THRESHOLD = 0.7;

export function mergeWithExisting(
  key: string,
  extracted: ExtractionField,
  existingMemories: MemoryItem[],
  existingProposals: SoulUpdateProposal[],
): MergedField {
  const fieldPath = SOUL_FIELD_MAP[key];
  if (!fieldPath) {
    return { key, fieldPath: key, value: extracted.value, confidence: 0, shouldPropose: false, evidence: extracted.evidence };
  }

  // If extracted value is null (insufficient info), skip
  if (extracted.value === null) {
    return { key, fieldPath, value: null, confidence: 0, shouldPropose: false, evidence: [] };
  }

  // Check for existing PENDING proposal on same fieldPath
  const pendingConflict = existingProposals.some(
    (p) => p.fieldPath === fieldPath && p.status === 'PENDING',
  );
  if (pendingConflict) {
    return { key, fieldPath, value: extracted.value, confidence: extracted.confidence, shouldPropose: false, evidence: extracted.evidence };
  }

  // Base confidence = LLM's own assessment (already accounts for source quality)
  let confidence = clamp(extracted.confidence);

  // Evidence count bonus: ≥3 distinct evidence snippets → +0.2
  if (extracted.evidence.length >= 3) {
    confidence = clamp(confidence + EVIDENCE_BONUS);
  }

  // Find related existing memories
  const related = existingMemories.filter(
    (m) =>
      m.state === 'ACTIVE' &&
      m.enabledForSoulUpdate &&
      (m.type === 'DESCRIPTION' || m.type === 'CHAT_EXCERPT' || m.type === 'CORRECTION'),
  );

  // Consistency: existing high-confidence (>0.7) description matching → bonus
  const highConfMatch = related.some(
    (m) => m.confidence > 0.7 && contentRelates(m.content, extracted.evidence),
  );
  if (highConfMatch) {
    confidence = clamp(confidence + CONSISTENCY_BONUS);
  }

  // If user explicitly described this trait (DESCRIPTION type), boost
  const userDescribed = related.some(
    (m) => m.source === 'USER_INPUT' && contentRelates(m.content, extracted.evidence),
  );
  if (userDescribed) {
    confidence = clamp(confidence + (SOURCE_WEIGHT_USER_INPUT - SOURCE_WEIGHT_CONVERSATION));
  }

  const shouldPropose = confidence >= PROPOSAL_THRESHOLD;

  return {
    key,
    fieldPath,
    value: extracted.value,
    confidence,
    shouldPropose,
    evidence: extracted.evidence,
  };
}

function contentRelates(content: string, evidence: string[]): boolean {
  return evidence.some((e) => content.includes(e) || e.includes(content.slice(0, 20)));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}
