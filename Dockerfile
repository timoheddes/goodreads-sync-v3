# syntax=docker/dockerfile:1

# ---- deps: full node_modules for the build step (includes devDependencies) ----
FROM node:20-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile TypeScript -> dist ----
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- prod-deps: production-only node_modules (native module rebuilt here too) ----
FROM node:20-alpine AS prod-deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:20-alpine AS runtime
RUN apk add --no-cache su-exec shadow tzdata
WORKDIR /app

# Default app user -- entrypoint.sh remaps this to PUID/PGID at container start
RUN addgroup -g 1000 appgroup \
  && adduser -D -u 1000 -G appgroup appuser

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
COPY package.json ./
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && mkdir -p /app/data

ENV NODE_ENV=production
EXPOSE 3000

# Runs as root initially so entrypoint.sh can fix ownership, then drops to appuser
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/index.js"]
