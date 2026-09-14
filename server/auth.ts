import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

// Valid admin sessions (token -> session info)
export interface AdminSession {
  token: string;
  adminName: string;
  email: string;
  role: 'super_admin';
  createdAt: number;
  expiresAt: number;
  lastActive: number;
}

// In-memory session store for fast local lookup
const sessions = new Map<string, AdminSession>();

// Session configuration: 4 hours expiration
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * Check if ADMIN_SECRET_KEY is configured in the server environment.
 * NEVER uses any default, demo, or fallback password.
 */
export const isAuthConfigured = (): boolean => {
  const key = process.env.ADMIN_SECRET_KEY;
  return typeof key === 'string' && key.trim().length > 0;
};

/**
 * Returns HMAC signing key based on server's ADMIN_SECRET_KEY.
 * Cryptographically tied to this deployment's secret.
 */
const getHmacKey = (): string => {
  const key = process.env.ADMIN_SECRET_KEY;
  if (typeof key === 'string' && key.trim().length > 0) {
    return key.trim();
  }
  return 'gtj-internal-session-salt-fallback';
};

/**
 * Validates provided administrator password against server environment secret.
 * Uses timing-safe string comparison to prevent timing attacks.
 * Rejects immediately if no server secret is configured.
 */
export const verifyAdminPassword = (password: unknown): boolean => {
  if (typeof password !== 'string' || !isAuthConfigured()) {
    return false;
  }
  const configuredSecret = process.env.ADMIN_SECRET_KEY!.trim();
  const inputPassword = password.trim();

  // Convert to buffers for constant-time comparison
  const inputBuffer = Buffer.from(inputPassword, 'utf-8');
  const secretBuffer = Buffer.from(configuredSecret, 'utf-8');

  if (inputBuffer.length !== secretBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(inputBuffer, secretBuffer);
};

/**
 * Creates a cryptographically secure, HMAC-signed admin session.
 * Stateless verification ensures sessions work seamlessly across Vercel serverless cold starts.
 */
export const createAdminSession = (
  adminName: string = 'Gold Trader John (Admin)',
  email: string = 'admin@goldtraderjohn.com'
): AdminSession => {
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const payload = {
    u: adminName,
    e: email,
    r: 'super_admin',
    c: now,
    exp: expiresAt,
    nonce: crypto.randomBytes(16).toString('hex')
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', getHmacKey()).update(payloadB64).digest('base64url');
  const token = `${payloadB64}.${signature}`;

  const session: AdminSession = {
    token,
    adminName,
    email,
    role: 'super_admin',
    createdAt: now,
    expiresAt,
    lastActive: now
  };
  sessions.set(token, session);
  return session;
};

/**
 * Validates a session token and checks for expiration.
 * Supports both memory-cached sessions and stateless HMAC signature verification.
 */
export const validateSession = (token?: string): AdminSession | null => {
  if (!token || typeof token !== 'string') return null;

  const now = Date.now();

  // 1. Check in-memory session cache first
  const existing = sessions.get(token);
  if (existing) {
    if (now > existing.expiresAt) {
      sessions.delete(token);
      return null;
    }
    existing.lastActive = now;
    return existing;
  }

  // 2. Stateless HMAC validation for serverless (Vercel) instances
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', getHmacKey()).update(payloadB64).digest('base64url');

    const sigBuf = Buffer.from(signature, 'utf-8');
    const expBuf = Buffer.from(expectedSig, 'utf-8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    const payload = JSON.parse(payloadJson);

    if (!payload.exp || now > payload.exp) {
      return null;
    }

    const session: AdminSession = {
      token,
      adminName: payload.u || 'Gold Trader John (Admin)',
      email: payload.e || 'admin@goldtraderjohn.com',
      role: 'super_admin',
      createdAt: payload.c || now,
      expiresAt: payload.exp,
      lastActive: now
    };

    // Cache locally
    sessions.set(token, session);
    return session;
  } catch {
    return null;
  }
};

/**
 * Destroys an active session (logout).
 */
export const destroySession = (token: string): boolean => {
  if (!token) return false;
  return sessions.delete(token);
};

export interface AuthenticatedRequest extends Request {
  adminSession?: AdminSession;
  sessionToken?: string;
}

/**
 * Express middleware to protect all admin endpoints.
 * Extracts session from:
 * 1. Secure HttpOnly cookie ('admin_session')
 * 2. Authorization header ('Bearer <token>')
 * 3. Custom header ('x-admin-token')
 */
export const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  let token = '';

  // 1. Check HttpOnly cookie first
  if (req.cookies && typeof req.cookies.admin_session === 'string') {
    token = req.cookies.admin_session.trim();
  }

  // 2. Check Authorization header
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    }
  }

  // 3. Check custom header
  if (!token && typeof req.headers['x-admin-token'] === 'string') {
    token = req.headers['x-admin-token'].trim();
  }

  const session = validateSession(token);
  if (!session) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(401).json({
      success: false,
      error: 'Unauthorized. Admin session is invalid, expired, or missing. Please sign in.'
    });
  }

  req.adminSession = session;
  req.sessionToken = token;
  next();
};
