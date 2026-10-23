# syntax=docker/dockerfile:1
# NEXT_PUBLIC_* values are compiled into the browser bundle, so pass them as build args:
#   docker build -f infra/web.Dockerfile --build-arg NEXT_PUBLIC_BASE_DOMAIN=schoolsync.example.com .
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @school-sync/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG NEXT_PUBLIC_BASE_DOMAIN=localhost:3000
ARG NEXT_PUBLIC_DEFAULT_SITE=
ENV BUILD_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_BASE_DOMAIN=$NEXT_PUBLIC_BASE_DOMAIN NEXT_PUBLIC_DEFAULT_SITE=$NEXT_PUBLIC_DEFAULT_SITE
RUN pnpm --filter @school-sync/web build

FROM node:24-slim
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# monorepo-aware standalone output: the server lands at apps/web/server.js
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
