# syntax=docker/dockerfile:1
#
# Base images are Debian ("-bookworm-slim"), not Alpine. better-sqlite3 ships
# prebuilt binaries for glibc far more reliably than for musl (Alpine's libc),
# so this avoids compiling its native addon from source in the common case.
# python3/build-essential are still installed as a fallback in case a
# matching prebuild isn't available for a given Node/arch combination -- see
# .github/workflows/docker-build.yml for why that fallback is now safe to hit
# on arm64 too (native runners, no QEMU).

# ---- deps: full node_modules for the build step (includes devDependencies) ----
FROM node:20-bookworm-slim AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 build-essential \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile TypeScript -> dist ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- prod-deps: production-only node_modules (native module rebuilt here too) ----
FROM node:20-bookworm-slim AS prod-deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 build-essential \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:20-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu tzdata passwd \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Default app user -- entrypoint.sh remaps this to PUID/PGID at container start.
# No fixed uid/gid here: node:20-bookworm-slim already ships a "node"
# user/group at 1000/1000, so let groupadd/useradd pick whatever's free.
RUN groupadd appgroup \
  && useradd -m -g appgroup appuser

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
COPY package.json ./
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && mkdir -p /app/data

ENV NODE_ENV=production
EXPOSE 3000

# Hits the app's own /health route (added in Phase 0). Uses `node -e`
# instead of curl/wget so the runtime image doesn't need an extra apt
# package just for this. Reads PORT the same way the app does (defaults to
# 3000, but docker-compose.yml sets it to DASHBOARD_PORT) -- with
# network_mode: host, localhost:$PORT from inside the container reaches
# the app directly, same as how scheduler.ts already reaches FlareSolverr
# via localhost.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Runs as root initially so entrypoint.sh can fix ownership, then drops to appuser via gosu
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/index.js"]
