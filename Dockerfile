# HEEC EMP API — multi-stage build. Portable to any container host
# (Cloudflare Containers, Fly, Render, Railway, a VPS) with Neon/managed
# PostgreSQL and S3-compatible storage configured via environment.
# syntax=docker/dockerfile:1

# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Install workspace manifests first for better layer caching.
COPY package.json package-lock.json ./
COPY packages/scheduler/package.json packages/scheduler/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build:api
# Drop dev dependencies for a lean runtime node_modules (keeps workspace links).
RUN npm prune --omit=dev

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
# clamdscan client for fail-closed virus scanning (talks to the clamav service).
RUN apt-get update \
 && apt-get install -y --no-install-recommends clamav \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/scheduler/package.json ./packages/scheduler/package.json
COPY --from=build /app/packages/scheduler/dist ./packages/scheduler/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY deploy/clamd-client.conf /etc/clamav/clamd.conf
EXPOSE 3000
USER node
# Liveness: the dedicated probe never touches the database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]
