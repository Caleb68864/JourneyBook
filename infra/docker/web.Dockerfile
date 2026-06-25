# Journey Book web app — Vite/React build served by nginx.
# Build context is the repository root (pnpm monorepo).

FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable

# Copy the whole monorepo source (heavy/irrelevant dirs are excluded via
# .dockerignore). The FULL workspace must be present so pnpm produces a complete
# install with typescript hoisted to the workspace root .bin — a partial copy
# (missing services/*) yields a degraded install where `tsc` isn't found when
# building the workspace dependency packages.
COPY . .

RUN pnpm install --frozen-lockfile
# Build apps/web AND its workspace dependencies (atlas-core, ui, …) first so
# their dist/*.d.ts exist before web's `tsc -b` resolves `@journeybook/*`.
RUN pnpm --filter @journeybook/web... build

FROM nginx:alpine AS runtime
COPY infra/docker/web-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
