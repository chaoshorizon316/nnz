import { randomUUID } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env['NNZ_JWT_SECRET'] ?? 'nnz-dev-secret-do-not-use-in-production';
const JWT_EXPIRES = '7d';

export interface AuthUser {
  userId: string;
  email: string;
}

export interface CredentialRecord {
  userId: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

// ── Password ──

export async function hashPassword(password: string): Promise<string> {
  return hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return compare(password, hash);
}

// ── JWT ──

export function signToken(user: AuthUser): string {
  return jwt.sign({ userId: user.userId, email: user.email }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES,
  });
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string; email: string };
    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

// ── Extract token from Authorization header ──

export function extractToken(authHeader?: string): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  return parts[1] ?? null;
}

// ── Helpers ──

export function generateUserId(): string {
  return `user_${randomUUID()}`;
}
