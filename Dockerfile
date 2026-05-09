# ─────────────────────────────────────────────────────────────────────────────
# KidzRstarz — Railway Dockerfile
# Installs ffmpeg system-wide so video composition works in production.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-slim AS base

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    xz-utils \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# ── Install dependencies ──────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── Build ─────────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
# Build frontend (Vite) → dist/public
RUN pnpm vite build
# Compile server TypeScript → dist/
RUN pnpm tsc -p tsconfig.server.json --outDir dist --noEmit false

# ── Production image ──────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

# Copy only what's needed at runtime
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Railway injects PORT automatically; default to 3000 for local testing
ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/server/_core/index.js"]
