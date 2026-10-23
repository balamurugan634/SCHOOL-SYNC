import type { FastifyRequest } from 'fastify';
import { actorOf } from '../../core/audit';
import type { PeopleCtx } from './util';

/** Request → the context every people service function takes (tenant, audit actor, caller). Call after a guard ran. */
export const ctxOf = (req: FastifyRequest): PeopleCtx => ({ tenant: req.tenant, actor: actorOf(req), principal: req.auth });

export const metaOf = (q: { page: number; pageSize: number }, total: number) => ({ page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) });
