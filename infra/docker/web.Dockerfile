# Journey Book web app — Vite/React build served by nginx.
# Build context is the repository root (pnpm monorepo).

FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable

# Workspace manifests first for cached installs.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY apps/web/ apps/web/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @journeybook/web build

FROM nginx:alpine AS runtime
COPY infra/docker/web-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
