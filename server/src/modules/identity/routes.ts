import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../../db/pool.ts';
import { auditContext } from '../../http/gate.ts';
import {
  endSessions,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
  signIn,
  workspace,
  type SessionPolicy,
} from './sessions.ts';

const SignIn = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(1024),
  organizationId: z.uuid().optional(),
  terminalId: z.uuid().optional(),
});

export async function identityRoutes(app: FastifyInstance, options: { pool: pg.Pool; session: SessionPolicy }): Promise<void> {
  const { pool, session } = options;

  // Signing in is the one public route (AC-01): it is how a request gets a principal.
  app.post('/session', { config: { access: { kind: 'public' } } }, async (request, reply) => {
    const body = SignIn.parse(request.body);
    const result = await signIn(pool, session, {
      username: body.username,
      password: body.password,
      organizationId: body.organizationId ?? null,
      terminalId: body.terminalId ?? null,
      replacesToken: readCookie(request.headers.cookie, SESSION_COOKIE),
      correlationId: request.id,
      ipAddress: request.ip,
    });
    if (!result.ok) {
      return reply.status(result.status).send({ error: { code: result.code, message: result.message } });
    }
    void reply.header('set-cookie', sessionCookie(result.token, result.maxAgeSeconds));
    return reply.status(201).send(await workspace(pool, result.principal));
  });

  app.get('/session', { config: { access: { kind: 'session' } } }, async (request) => workspace(pool, request.principal!));

  app.delete('/session', { config: { access: { kind: 'session' } } }, async (request, reply) => {
    await withTransaction(pool, auditContext(request), (c) =>
      endSessions(c, { sessionId: request.principal!.sessionId! }, 'Logout'),
    );
    void reply.header('set-cookie', sessionCookie('', 0));
    return reply.status(204).send();
  });
}
