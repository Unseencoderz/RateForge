import { JWT_SECRET } from '@rateforge/config';
import jwt from 'jsonwebtoken';

import type { ClientIdentity } from '@rateforge/types';
import type { Request, Response, NextFunction } from 'express';

export interface AuthTokenPayload {
  userId: string;
  tier?: string;
  role?: string;
  roles?: string[];
  scopes?: string[];
  permissions?: string[];
  isAdmin?: boolean;
}

function hasAdminAccess(payload: AuthTokenPayload): boolean {
  const roles = payload.roles ?? [];
  const scopes = payload.scopes ?? [];
  const permissions = payload.permissions ?? [];

  return (
    payload.isAdmin === true ||
    payload.role === 'admin' ||
    roles.includes('admin') ||
    scopes.includes('admin') ||
    scopes.includes('admin:rules') ||
    permissions.includes('admin') ||
    permissions.includes('admin:rules')
  );
}

// eslint-disable-next-line @typescript-eslint/no-namespace
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      clientIdentity?: ClientIdentity;
      authToken?: AuthTokenPayload;
    }
  }
}

/**
 * P2-M2-T1 · JWT auth middleware.
 *
 * Reads the `Authorization: Bearer <token>` header, verifies the JWT using
 * JWT_SECRET, and attaches `req.clientIdentity` for downstream middleware.
 *
 * Returns 401 when:
 * - The header is absent or not in `Bearer <token>` form
 * - The token is expired, revoked, or otherwise invalid
 */
export async function verifyToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or malformed Authorization header.',
      },
    });
    return;
  }

  const token = authHeader.slice(7); // strip "Bearer "

  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthTokenPayload;

    req.clientIdentity = {
      userId: payload.userId,
      ip: req.ip ?? req.socket.remoteAddress ?? '0.0.0.0',
      tier: payload.tier ?? 'free',
    };
    req.authToken = payload;

    next();
  } catch {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired token.',
      },
    });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const payload = req.authToken;

  if (!payload || !hasAdminAccess(payload)) {
    res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Admin privileges are required for this endpoint.',
      },
    });
    return;
  }

  next();
}
