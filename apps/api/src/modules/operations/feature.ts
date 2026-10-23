import type { FastifyReply, FastifyRequest } from 'fastify';
import { forbidden } from '../../core/errors';

/** Route guard: the school must have the feature switched on (tenant.features), else 403 FEATURE_DISABLED. Put it after requirePerm. */
export const requireFeature =
  (feature: 'transport' | 'library') =>
  async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!req.tenant.features[feature]) throw forbidden(`The ${feature} module is not enabled for this school`, 'FEATURE_DISABLED');
  };
