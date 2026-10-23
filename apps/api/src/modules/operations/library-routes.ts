import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  idParam,
  libraryBook,
  libraryBookCreateBody,
  libraryBookListQuery,
  libraryBookUpdateBody,
  libraryCategories,
  libraryIssue,
  libraryIssueCreateBody,
  libraryIssueListQuery,
  libraryMyBooks,
  libraryMyBooksQuery,
  libraryOverdueResponse,
  libraryPolicy,
  libraryPolicyUpdateBody,
  libraryReturnBody,
  okSchema,
  pageQuery,
  paged,
} from '@school-sync/shared';
import type { PermissionKey } from '@school-sync/shared';
import { actorOf } from '../../core/audit';
import { paged as pagedResult } from '../../core/http';
import { requirePerm } from '../../plugins/guards';
import { requireFeature } from './feature';
import * as svc from './library';
import { emptyBodyOk } from '../communication/common';

const tag = ['Library'];
const anyone = (perm: PermissionKey) => [requirePerm(perm), requireFeature('library')];
const staffOnly = (perm: PermissionKey) => [requirePerm(perm, 'school'), requireFeature('library')];

const routes: FastifyPluginAsyncZod = async (app) => {
  // ── catalogue (everyone who may use the library can browse) ──
  app.get(
    '/library/books',
    { preHandler: anyone('library:view'), schema: { tags: tag, summary: 'Search the catalogue (title, author, ISBN, category, accession no.) with availability', querystring: libraryBookListQuery, response: { 200: paged(libraryBook) } } },
    async (req) => {
      const { items, total } = await svc.listBooks(req.db, { ...req.query, includeArchived: req.auth.can('library:edit', 'school') ? req.query.includeArchived : false });
      return pagedResult(items, total, req.query);
    },
  );
  app.get('/library/categories', { preHandler: anyone('library:view'), schema: { tags: tag, summary: 'Catalogue categories (for filters)', response: { 200: libraryCategories } } }, async (req) => ({ data: await svc.categories(req.db) }));
  app.get('/library/books/:id', { preHandler: anyone('library:view'), schema: { tags: tag, summary: 'One book', params: idParam, response: { 200: libraryBook } } }, async (req) => svc.getBook(req.db, req.params.id, req.auth.can('library:edit', 'school')));
  app.post('/library/books', { preHandler: staffOnly('library:create'), schema: { tags: tag, summary: 'Add a book to the catalogue', body: libraryBookCreateBody, response: { 201: libraryBook } } }, async (req, reply) =>
    reply.status(201).send(await svc.createBook(req.db, actorOf(req), req.body)),
  );
  app.patch('/library/books/:id', { preHandler: staffOnly('library:edit'), schema: { tags: tag, summary: 'Edit a book; changing `totalCopies` moves the available stock with it (409 COPIES_ON_LOAN below the copies out)', params: idParam, body: libraryBookUpdateBody, response: { 200: libraryBook } } }, async (req) =>
    svc.updateBook(req.db, actorOf(req), req.params.id, req.body),
  );
  app.delete('/library/books/:id', { preHandler: staffOnly('library:delete'), schema: { tags: tag, summary: 'Archive a book (409 BOOK_ON_LOAN while a copy is out)', params: idParam, response: { 200: okSchema } } }, async (req) => {
    await svc.archiveBook(req.db, actorOf(req), req.params.id);
    return { ok: true as const };
  });

  // ── circulation ──
  app.post(
    '/library/issues',
    {
      preHandler: staffOnly('library:create'),
      schema: {
        tags: tag,
        summary: 'Issue a book to a student or a staff member',
        description: 'Exactly one of `studentId` / `staffId`. The due date defaults to today + the school’s loan period. Stock is decremented atomically: 409 NO_COPIES_AVAILABLE when none is on the shelf, LOAN_LIMIT_REACHED, ALREADY_BORROWED.',
        body: libraryIssueCreateBody,
        response: { 201: libraryIssue },
      },
    },
    async (req, reply) => reply.status(201).send(await svc.issueBook(req.db, req.tenant, req.auth, actorOf(req), req.body)),
  );
  app.post(
    '/library/issues/:id/return',
    {
      preHandler: staffOnly('library:edit'),
      // body optional: omit it (or send {}) to charge the normal late fine
      preValidation: [emptyBodyOk],
      schema: { tags: tag, summary: 'Return a book: stock goes back up and the late fine (days late × fine per day) is recorded; `waiveFine` clears it', params: idParam, body: libraryReturnBody, response: { 200: libraryIssue } },
    },
    async (req) => svc.returnBook(req.db, req.tenant, actorOf(req), req.params.id, req.body.waiveFine),
  );
  app.get('/library/issues', { preHandler: staffOnly('library:view'), schema: { tags: tag, summary: 'Loans (default: books currently out), filterable by status, book, borrower', querystring: libraryIssueListQuery, response: { 200: paged(libraryIssue) } } }, async (req) => {
    const { items, total } = await svc.listIssues(req.db, req.tenant, req.query);
    return pagedResult(items, total, req.query);
  });
  app.get('/library/overdue', { preHandler: staffOnly('library:view'), schema: { tags: tag, summary: 'Overdue loans with accrued fines, plus totals over all overdue loans', querystring: pageQuery, response: { 200: libraryOverdueResponse } } }, async (req) => {
    const { items, total, totals } = await svc.overdue(req.db, req.tenant, req.query);
    return { ...pagedResult(items, total, req.query), totals };
  });
  app.get(
    '/library/my-books',
    {
      preHandler: anyone('library:view'),
      schema: { tags: tag, summary: 'Books borrowed by me (students), by my children (parents; narrow with `studentId`) or by me as staff', querystring: libraryMyBooksQuery, response: { 200: libraryMyBooks } },
    },
    async (req) => ({ data: await svc.myBooks(req.db, req.tenant, req.auth, req.query) }),
  );

  // ── policy ──
  app.get('/library/policy', { preHandler: anyone('library:view'), schema: { tags: tag, summary: 'Loan period, fine per day and loan limits', response: { 200: libraryPolicy } } }, async (req) => svc.getPolicy(req.db));
  app.put('/library/policy', { preHandler: staffOnly('library:edit'), schema: { tags: tag, summary: 'Change the library policy (also stored as the `library` school setting)', body: libraryPolicyUpdateBody, response: { 200: libraryPolicy } } }, async (req) =>
    svc.updatePolicy(req.db, actorOf(req), req.auth.userId, req.body),
  );
};

export default routes;
