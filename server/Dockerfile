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
COPY server/tsconfig.json server/
COPY server/src server/src
RUN npm run build --workspace server

FROM node:20-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000
WORKDIR /app/server
# openssl: Prisma engine. mysql client: Settings > Backup & Restore shells out
# to mysqldump/mysql.
RUN apt-get update && apt-get install -y --no-install-recommends openssl default-mysql-client \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/node_modules /app/node_modules
COPY --from=build --chown=node:node /app/server /app/server
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply pending migrations, then start the API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
