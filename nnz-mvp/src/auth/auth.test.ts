import { describe, expect, it } from 'vitest';
import { extractToken, hashPassword, signToken, verifyPassword, verifyToken } from './auth';

describe('Auth', () => {
  it('hashes and verifies passwords', async () => {
    const h = await hashPassword('test123');
    expect(await verifyPassword('test123', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });

  it('signs and verifies tokens', () => {
    const token = signToken({ userId: 'u1', email: 'a@b.com' });
    const user = verifyToken(token);
    expect(user).not.toBeNull();
    expect(user!.userId).toBe('u1');
    expect(user!.email).toBe('a@b.com');
  });

  it('rejects invalid tokens', () => {
    expect(verifyToken('bad')).toBeNull();
    expect(verifyToken('')).toBeNull();
  });

  it('extracts Bearer token from header', () => {
    expect(extractToken('Bearer abc')).toBe('abc');
    expect(extractToken('bearer abc')).toBeNull();
    expect(extractToken(undefined)).toBeNull();
    expect(extractToken('')).toBeNull();
  });
});
