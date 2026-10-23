# syntax=docker/dockerfile:1
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @school-sync/api... 
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @school-sync/api build \
 && pnpm --filter @school-sync/api --prod deploy /out

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
RUN useradd --system --uid 10001 app && mkdir -p /data/storage && chown -R app /data
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
USER app
EXPOSE 4000
CMD ["node", "dist/main.js"]
