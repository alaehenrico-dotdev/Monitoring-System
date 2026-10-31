# Build context is the repo root (npm workspaces share one lockfile):
#   docker build -f server/Dockerfile .
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
# Prisma schema must exist before server's postinstall (`prisma generate`).
COPY server/prisma server/prisma
RUN npm ci --workspace server --include-workspace-root=false
COPY server/tsconfig.json server/tsconfig.build.json server/
COPY server/src server/src
RUN npm run build --workspace server
# (builds from tsconfig.build.json: tests are left out of dist)

# Production-only packages, installed on their own. The build stage above needs the
# dev tooling (TypeScript, tsx, vitest) to compile, but none of it should ship: the
# runtime image used to be a copy of that whole install, which put known-vulnerable
# test/dev tooling (vitest, vite, esbuild) inside the container that faces the network.
# `prisma` is a regular dependency on purpose - the container runs `prisma migrate
# deploy` at start (docker/start.sh), and its postinstall generates the client here.
FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
COPY server/prisma server/prisma
RUN npm ci --omit=dev --workspace server --include-workspace-root=false \
    && npm cache clean --force

FROM node:20-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000
WORKDIR /app/server
# openssl: Prisma engine. mysql client: Settings > Backup & Restore shells out
# to mysqldump/mysql.
RUN apt-get update && apt-get install -y --no-install-recommends openssl default-mysql-client \
    && rm -rf /var/lib/apt/lists/*
COPY --from=prod-deps --chown=node:node /app/node_modules /app/node_modules
# Only what runs: the compiled app, the Prisma schema + migrations (`migrate deploy` at start)
# and package.json. No TypeScript sources, tests or tsconfig in the image.
COPY --from=build --chown=node:node /app/server/dist /app/server/dist
COPY --from=build --chown=node:node /app/server/prisma /app/server/prisma
COPY --from=build --chown=node:node /app/server/package.json /app/server/package.json
COPY --chown=node:node server/docker/start.sh /app/server/docker/start.sh
# Pre-migration snapshots (see docker/start.sh) land here; compose mounts a volume on it.
RUN mkdir -p /backups && chown node:node /backups
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Snapshot the database if migrations are pending, apply them, then start the API.
CMD ["bash", "/app/server/docker/start.sh"]
