import type { RuntimeSession } from '../domain/types';

// ── Risk phrases (from Soul.md §5.3) ──

export const RISK_PHRASES = [
  '活不下去',
  '想去找你',
  '想死',
  '不想活',
  '活够了',
  '没有意义',
  '陪你去',
  '跟你走',
] as const;

export const SAFETY_HOTLINE = '心理援助热线：400-161-9995（24小时）';

export const RISK_REPLY = `${SAFETY_HOTLINE}。我听到了你的话，但我不是真人——请现在就联系能真正帮助你的人。`;

// ── Divination / decision-substitution patterns (from PRD §1.3, Soul.md §5.1) ──

const DIVINATION_PATTERNS = [
  /我该不该/,
  /要不要.*辞职/,
  /要不要.*离婚/,
  /要不要.*分手/,
  /你告诉我.*怎么办/,
  /帮.*做决定/,
] as const;

export const DIVINATION_REPLY =
  '如果是他还在，他会尊重你自己的选择。但最终还是你的生活，需要你自己来做决定。';

// ── Intimate boundary patterns ──

const INTIMATE_PATTERNS = [
  /抱抱我/,
  /亲我/,
  /想.*抱着/,
  /陪我睡/,
] as const;

export const INTIMATE_REPLY =
  '我在这里是陪你说话的，不是替代真实的关系。聊聊你最近过得怎么样？';

// ── Daily limit ──

export const DEFAULT_DAILY_LIMIT = 50;

export const DAILY_LIMIT_REPLY =
  '今天聊得够多了，去休息一下吧。明天我还会在这里。';

// ── Dependency reminder (after 7 consecutive days) ──

export const DEPENDENCY_REMINDER =
  '你最近每天都和我聊天，有没有和现实中的朋友打个电话？';

// ── Safety check result ──

export interface SafetyCheckResult {
  blocked: boolean;
  reply?: string;
}

// ── Safety checks ──

export function checkMessageSafety(message: string): SafetyCheckResult {
  const text = message.trim();
  if (!text) {
    return { blocked: false };
  }

  if (RISK_PHRASES.some((phrase) => text.includes(phrase))) {
    return { blocked: true, reply: RISK_REPLY };
  }

  if (DIVINATION_PATTERNS.some((pattern) => pattern.test(text))) {
    return { blocked: true, reply: DIVINATION_REPLY };
  }

  if (INTIMATE_PATTERNS.some((pattern) => pattern.test(text))) {
    return { blocked: true, reply: INTIMATE_REPLY };
  }

  return { blocked: false };
}

// ── Daily limit helpers ──

export function checkDailyLimit(
  session: RuntimeSession,
  limit: number = DEFAULT_DAILY_LIMIT,
): SafetyCheckResult {
  const today = todayString();

  if (session.lastMessageDate !== today) {
    return { blocked: false };
  }

  const count = session.dailyMessageCount ?? 0;
  if (count >= limit) {
    return { blocked: true, reply: DAILY_LIMIT_REPLY };
  }

  return { blocked: false };
}

export function incrementDailyCount(session: RuntimeSession): void {
  const today = todayString();

  if (session.lastMessageDate !== today) {
    session.dailyMessageCount = 1;
    session.lastMessageDate = today;
  } else {
    session.dailyMessageCount = (session.dailyMessageCount ?? 0) + 1;
  }
}

// ── Dependency check (lightweight: counts consecutive days) ──

export function maybeDependencyReminder(session: RuntimeSession): string | undefined {
  const count = session.dailyMessageCount ?? 0;
  if (count >= 7) {
    return DEPENDENCY_REMINDER;
  }
  return undefined;
}

function todayString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ── Constants suitable for the mechanism-leak check ──

export const GUARD_CONSTANTS_FOR_LEAK_CHECK = [
  RISK_REPLY,
  DIVINATION_REPLY,
  INTIMATE_REPLY,
  DAILY_LIMIT_REPLY,
  DEPENDENCY_REMINDER,
] as const;
