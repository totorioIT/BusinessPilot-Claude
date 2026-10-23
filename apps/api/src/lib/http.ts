import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { badRequest, forbidden, HttpError } from './errors.js';

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw badRequest(`Ungültige Eingabe bei „${issue.path.join('.') || 'Anfrage'}“: ${issue.message}`, 'validation');
  }
  return result.data;
}

export type AuthContext = {
  userId: string;
  tenantId: string;
  role: 'owner' | 'admin' | 'staff';
  userName: string;
  isPlatformAdmin: boolean;
  /** A platform admin looking at a tenant they don't belong to (support access). */
  support: boolean;
};

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export function auth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw new HttpError(401, 'unauthorized', 'Bitte melden Sie sich an.');
  return req.auth;
}

export function requireRole(req: FastifyRequest, roles: AuthContext['role'][]) {
  const a = auth(req);
  if (!roles.includes(a.role)) throw forbidden();
  return a;
}

export const userActor = (a: AuthContext) => ({ type: 'user' as const, id: a.userId, name: a.userName });

export const optionalString = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT erwartet');

export type Reply = FastifyReply;
