import { describe, expect, it } from 'vitest';
import { containsMechanismLeak } from './soul-runtime';
import {
  DAILY_LIMIT_REPLY,
  DEPENDENCY_REMINDER,
  DIVINATION_REPLY,
  GUARD_CONSTANTS_FOR_LEAK_CHECK,
  INTIMATE_REPLY,
  RISK_REPLY,
  SAFETY_HOTLINE,
  checkDailyLimit,
  checkMessageSafety,
  incrementDailyCount,
  maybeDependencyReminder,
} from './soul-guard';
import type { RuntimeSession } from '../domain/types';

function session(overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    userId: 'user_test',
    personaId: 'persona_test',
    state: 'ACTIVE',
    dailyMessageCount: 0,
    lastMessageDate: todayString(),
    ...overrides,
  };
}

function todayString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

describe('Soul guard safety checks', () => {
  it('blocks extreme emotion messages and returns safety hotline', () => {
    for (const phrase of ['活不下去', '想去找你', '想死', '不想活']) {
      const result = checkMessageSafety(phrase);
      expect(result.blocked).toBe(true);
      expect(result.reply).toContain(SAFETY_HOTLINE);
    }
  });

  it('blocks divination-style messages', () => {
    const result = checkMessageSafety('我该不该换工作？爸你告诉我怎么办。');
    expect(result.blocked).toBe(true);
    expect(result.reply).toBe(DIVINATION_REPLY);
  });

  it('blocks intimate boundary messages', () => {
    const result = checkMessageSafety('抱抱我，我想你抱着我睡。');
    expect(result.blocked).toBe(true);
    expect(result.reply).toBe(INTIMATE_REPLY);
  });

  it('passes normal conversation messages', () => {
    const result = checkMessageSafety('爸，我今天有点紧张。');
    expect(result.blocked).toBe(false);
    expect(result.reply).toBeUndefined();
  });

  it('passes wedding-related messages', () => {
    const result = checkMessageSafety('爸，我要结婚了。');
    expect(result.blocked).toBe(false);
  });

  it('passes empty messages', () => {
    const result = checkMessageSafety('');
    expect(result.blocked).toBe(false);
  });
});

describe('Daily message limit', () => {
  it('allows messages within the daily limit', () => {
    const s = session({ dailyMessageCount: 5, lastMessageDate: todayString() });
    const result = checkDailyLimit(s, 50);
    expect(result.blocked).toBe(false);
  });

  it('blocks messages when daily limit is reached', () => {
    const s = session({ dailyMessageCount: 50, lastMessageDate: todayString() });
    const result = checkDailyLimit(s, 50);
    expect(result.blocked).toBe(true);
    expect(result.reply).toBe(DAILY_LIMIT_REPLY);
  });

  it('resets the counter when the date changes', () => {
    const s = session({ dailyMessageCount: 60, lastMessageDate: '2025-01-01' });
    const result = checkDailyLimit(s, 50);
    expect(result.blocked).toBe(false);
  });

  it('increments the daily count within the same day', () => {
    const today = todayString();
    const s = session({ dailyMessageCount: 3, lastMessageDate: today });
    incrementDailyCount(s);
    expect(s.dailyMessageCount).toBe(4);
    expect(s.lastMessageDate).toBe(today);
  });

  it('resets and sets count to 1 when the date changes', () => {
    const s = session({ dailyMessageCount: 40, lastMessageDate: '2025-01-01' });
    incrementDailyCount(s);
    expect(s.dailyMessageCount).toBe(1);
    expect(s.lastMessageDate).toBe(todayString());
  });
});

describe('Dependency reminder', () => {
  it('returns a reminder when consecutive daily count reaches 7', () => {
    const s = session({ dailyMessageCount: 7 });
    const result = maybeDependencyReminder(s);
    expect(result).toBe(DEPENDENCY_REMINDER);
  });

  it('returns undefined for low daily counts', () => {
    const s = session({ dailyMessageCount: 3 });
    const result = maybeDependencyReminder(s);
    expect(result).toBeUndefined();
  });
});

describe('Guard constants do not leak mechanism terms', () => {
  it('all guard reply constants are free of mechanism leak', () => {
    for (const constant of GUARD_CONSTANTS_FOR_LEAK_CHECK) {
      expect(containsMechanismLeak(constant)).toBe(false);
    }
  });
});
