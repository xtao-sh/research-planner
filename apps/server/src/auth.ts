import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import cookie from '@fastify/cookie';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

export const sessionTTL = 30 * 24 * 60 * 60 * 1000; // 30 days in ms
export const sessionTTLSeconds = Math.floor(sessionTTL / 1000);
export const sessionCookieName = 'rp_sid';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; email: string };
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

function generateSessionId(): string {
  // 32 random bytes = 256 bits, base64url-encoded
  return randomBytes(32).toString('base64url');
}

export async function createSession(
  prisma: PrismaClient,
  userId: string
): Promise<{ id: string; expiresAt: Date }> {
  const id = generateSessionId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionTTL);
  await prisma.session.create({
    data: { id, userId, createdAt: now, expiresAt },
  });
  return { id, expiresAt };
}

export async function lookupSession(
  prisma: PrismaClient,
  sid: string
): Promise<{ userId: string } | null> {
  const row = await prisma.session.findUnique({ where: { id: sid } });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    // Expired — best-effort cleanup, but don't block the caller.
    prisma.session.delete({ where: { id: sid } }).catch(() => { /* ignore */ });
    return null;
  }
  return { userId: row.userId };
}

export async function deleteSession(prisma: PrismaClient, sid: string): Promise<void> {
  await prisma.session.delete({ where: { id: sid } }).catch(() => { /* ignore missing */ });
}

export function buildSessionCookieOptions(isProd: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: sessionTTLSeconds,
    secure: isProd,
  };
}

export function buildClearCookieOptions(isProd: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: isProd,
  };
}

// Endpoints that skip the auth preHandler entirely. Register/login are only
// reachable when MULTI_USER=1 (otherwise they 410 in the handler), so we add
// them dynamically below to avoid leaking them in single-user mode.
const BASE_PUBLIC_PATHS = new Set<string>([
  '/api/health',
  '/api/ready',
  '/api/invites/accept',
]);

// Prefixes for public endpoints that include dynamic segments, e.g.
// `/api/invites/token/:token`. Checked after exact-match PUBLIC_PATHS.
const PUBLIC_PREFIXES = [
  '/api/invites/token/',
];

export async function registerAuthPlugin(
  app: FastifyInstance,
  prisma: PrismaClient
): Promise<void> {
  await app.register(cookie);

  const isProd = process.env.NODE_ENV === 'production';
  const isMultiUser = process.env.MULTI_USER === '1';
  const PUBLIC_PATHS = new Set(BASE_PUBLIC_PATHS);
  if (isMultiUser) {
    PUBLIC_PATHS.add('/api/auth/register');
    PUBLIC_PATHS.add('/api/auth/login');
  }

  // Single-user local mode: every request is auto-resolved to the seeded
  // demo user. Multi-user mode falls back to the cookie session lookup.
  let cachedDemoUser: { id: string; email: string } | null = null;

  app.addHook('preHandler', async (req: FastifyRequest, rep: FastifyReply) => {
    if (req.method === 'OPTIONS') return;
    const url = req.routerPath || req.url.split('?')[0];
    if (PUBLIC_PATHS.has(url)) return;
    for (const prefix of PUBLIC_PREFIXES) {
      if (url.startsWith(prefix)) return;
    }
    if (!url.startsWith('/api/')) return;

    if (isMultiUser) {
      // Cookie/session-based: read rp_sid, look up the session, resolve user.
      const sid = req.cookies?.[sessionCookieName];
      if (!sid) {
        rep.code(401).send({ message: 'Unauthorized' });
        return rep;
      }
      const sess = await lookupSession(prisma, sid);
      if (!sess) {
        rep.code(401).send({ message: 'Unauthorized' });
        return rep;
      }
      const u = await prisma.user.findUnique({
        where: { id: sess.userId },
        select: { id: true, email: true },
      });
      if (!u) {
        rep.code(401).send({ message: 'Unauthorized' });
        return rep;
      }
      req.user = u;
      return;
    }

    // Single-user mode: resolve to demo user.
    if (!cachedDemoUser) {
      const u = await prisma.user.findUnique({
        where: { email: 'demo@local' },
        select: { id: true, email: true },
      });
      if (u) cachedDemoUser = u;
    }
    if (cachedDemoUser) {
      req.user = cachedDemoUser;
    }
  });
}
