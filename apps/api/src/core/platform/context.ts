import type { PlatformActor } from './audit';

declare module 'fastify' {
  interface FastifyRequest {
    /** set by the platform access guard: the operator or automation key behind this request */
    platformActor: PlatformActor;
    /** operator session id (operator requests only) */
    platformSessionId: string;
  }
}
export {};
