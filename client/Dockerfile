# Build context is the repo root:  docker build -f client/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --workspace client --include-workspace-root=false --ignore-scripts
COPY client client
# Relative /api so the browser calls the same origin that Caddy proxies.
ENV VITE_API_URL=/api
RUN npm run build --workspace client

FROM caddy:2-alpine
# One Caddyfile for HTTP and HTTPS: SITE_ADDRESS (docker-compose.yml) decides.
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/client/dist /usr/share/caddy
EXPOSE 80 443
