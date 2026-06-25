# Journey Book render-worker — Fastify service wrapping renderAtlas.
# Build context is the repository root (pnpm monorepo).

FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable

# Workspace manifests first for cached installs.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY services/render-worker/ services/render-worker/

RUN pnpm install --frozen-lockfile
# Build the worker and its workspace dependencies (render-cli -> atlas-core,
# map-sources, pdf-client) via pnpm's "...dependencies" selector.
RUN pnpm --filter @journeybook/render-worker... build

FROM node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production

# Copy the fully-installed, built workspace (pnpm symlinks + .pnpm store stay
# intact because the whole tree is copied from the build stage).
COPY --from=build /repo ./

WORKDIR /repo/services/render-worker

ENV PORT=8090
ENV GENERATED_DIR=/app/data/generated
EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:8090/health || exit 1

CMD ["node", "dist/server.js"]
