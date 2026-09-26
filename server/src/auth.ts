import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from './config.ts';
import { HttpError, forbidden } from './errors.ts';

export const PERMISSIONS = [
  'read:capacity',
  'write:capacity',
  'create:hold',
  'confirm:hold',
  'create:alert',
  'respond:alert',
  'execute:code_frost',
  'read:audit',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type Role = 'outreach' | 'responder' | 'shelter_admin' | 'city_ops';

// Mirrors the Auth0 roles. In Auth0 mode permissions come from the token, not from here.
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  outreach: ['read:capacity', 'create:hold', 'create:alert'],
  responder: ['read:capacity', 'respond:alert', 'create:alert'],
  shelter_admin: ['read:capacity', 'write:capacity', 'confirm:hold'],
  city_ops: ['read:capacity', 'write:capacity', 'execute:code_frost', 'read:audit'],
};

export type User = {
  sub: string;
  name: string;
  permissions: Permission[];
  shelterId: string | null;
};

const CLAIM_SHELTER = 'https://coldgrid/shelter_id';
const CLAIM_NAME = 'https://coldgrid/name';

const jwks = config.auth0 ? createRemoteJWKSet(new URL(`https://${config.auth0.domain}/.well-known/jwks.json`)) : null;

// Dev tokens look like "dev.<base64url JSON>". They are only accepted when Auth0 is not configured,
// and config.ts refuses to start in production without Auth0.
export function devToken(role: Role, sub: string, name: string, shelterId: string | null = null): string {
  return 'dev.' + Buffer.from(JSON.stringify({ role, sub, name, shelterId })).toString('base64url');
}

export async function verifyToken(token: string): Promise<User> {
  if (config.auth0 && jwks) {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `https://${config.auth0.domain}/`,
      audience: config.auth0.audience,
    });
    const perms = Array.isArray(payload.permissions) ? (payload.permissions as string[]) : [];
    return {
      sub: String(payload.sub),
      name: typeof payload[CLAIM_NAME] === 'string' ? (payload[CLAIM_NAME] as string) : 'User',
      permissions: perms.filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p)),
      shelterId: typeof payload[CLAIM_SHELTER] === 'string' ? (payload[CLAIM_SHELTER] as string) : null,
    };
  }
  if (!token.startsWith('dev.')) throw new HttpError(401, 'Invalid token');
  let parsed: { role?: string; sub?: string; name?: string; shelterId?: string | null };
  try {
    parsed = JSON.parse(Buffer.from(token.slice(4), 'base64url').toString('utf8'));
  } catch {
    throw new HttpError(401, 'Invalid token');
  }
  const role = parsed.role as Role;
  if (!ROLE_PERMISSIONS[role] || !parsed.sub) throw new HttpError(401, 'Invalid token');
  return {
    sub: parsed.sub,
    name: parsed.name || parsed.sub,
    permissions: ROLE_PERMISSIONS[role],
    shelterId: parsed.shelterId ?? null,
  };
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return next(new HttpError(401, 'Missing bearer token'));
  try {
    req.user = await verifyToken(token);
    next();
  } catch (err) {
    next(err instanceof HttpError ? err : new HttpError(401, 'Invalid token'));
  }
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user?.permissions.includes(permission)) return next(forbidden(`Requires ${permission}`));
    next();
  };
}

export function currentUser(req: Request): User {
  if (!req.user) throw new HttpError(401, 'Not authenticated');
  return req.user;
}

// A user bound to a shelter manages only that shelter. City Ops (no shelter) manages all.
export function canManageShelter(user: User, shelterId: string): boolean {
  if (user.shelterId) return user.shelterId === shelterId;
  return user.permissions.includes('execute:code_frost');
}
