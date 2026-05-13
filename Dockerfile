# ── Stage 1: beroenden ──────────────────────────────────────────────────────
FROM node:24.15.0-alpine AS deps
WORKDIR /app

RUN npm install -g npm@11.14.1
COPY package.json ./
RUN npm install --legacy-peer-deps

# ── Stage 2: bygg ──────────────────────────────────────────────
FROM node:24.15.0-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ── Stage 3: produktion ───────────────────────────────────────────────
FROM node:24.15.0-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static     ./.next/static
COPY --from=builder /app/public           ./public

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
