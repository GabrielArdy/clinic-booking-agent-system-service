# syntax=docker/dockerfile:1

# ---- Builder: compile native deps (better-sqlite3) + TypeScript ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Toolchain for better-sqlite3 native build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

# tsc emits JS to dist/. The .sql migrations are not compiled — copy them so
# runMigrations() finds them next to dist/src/db/migrate.js at runtime.
RUN npm run build \
  && cp -r src/db/migrations dist/src/db/migrations

# Drop dev deps (tsx, typescript, vitest); keep compiled better-sqlite3 binary.
RUN npm prune --omit=dev

# ---- Runtime: slim image, non-root ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/app/data/clinic.db
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Writable data dir for the SQLite file; own it as the non-root node user.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations run automatically on boot (src/index.ts).
CMD ["node", "dist/src/index.js"]
