# Build context is the repo root:  docker build -f client/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --workspace client --include-workspace-root=false --ignore-scripts
COPY client client
# Relative /api so the browser calls the same origin that nginx proxies.
ENV VITE_API_URL=/api
RUN npm run build --workspace client

FROM nginx:1.27-alpine
# docker.conf = HTTP; docker-tls.conf = HTTPS (set by docker-compose.tls.yml).
ARG NGINX_CONF=deploy/nginx/docker.conf
COPY ${NGINX_CONF} /etc/nginx/conf.d/default.conf
COPY deploy/nginx/snippets/ /etc/nginx/snippets/
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80 443
