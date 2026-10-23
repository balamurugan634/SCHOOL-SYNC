import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import academics from './academics/routes';
import attendance from './attendance/routes';
import auth from './auth/routes';
import communication from './communication/routes';
import exams from './exams/routes';
import fees from './fees/routes';
import files from './files/routes';
import learning from './learning/routes';
import license from './license/routes';
import operations from './operations/routes';
import people from './people/routes';
import platform from './platform/routes';
import reports from './reports/routes';
import settings from './settings/routes';
import site from './site/routes';

/**
 * Every feature module is a Fastify plugin registered under /api/v1.
 * Each module owns its folder: routes.ts (HTTP) + service.ts (logic) [+ more files as needed].
 */
export const modules: { name: string; plugin: FastifyPluginAsyncZod }[] = [
  { name: 'site', plugin: site },
  { name: 'auth', plugin: auth },
  { name: 'license', plugin: license },
  { name: 'academics', plugin: academics },
  { name: 'people', plugin: people },
  { name: 'attendance', plugin: attendance },
  { name: 'learning', plugin: learning },
  { name: 'exams', plugin: exams },
  { name: 'fees', plugin: fees },
  { name: 'communication', plugin: communication },
  { name: 'operations', plugin: operations },
  { name: 'reports', plugin: reports },
  { name: 'settings', plugin: settings },
  { name: 'files', plugin: files },
  { name: 'platform', plugin: platform },
];
