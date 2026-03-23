FROM node:22.14-alpine AS builder

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# 1. Copy ONLY the lockfile and workspace config to fetch dependencies
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

# 2. Copy the REST of the monorepo (respects .dockerignore)
COPY . .

# 3. Install offline (uses the fetched store, guarantees full workspace integrity)
ENV CI=true
RUN pnpm install --offline --frozen-lockfile --ignore-scripts

# 4. Build only the rate-limiter and its dependencies
RUN pnpm --filter @rateforge/rate-limiter... build

# 5. Deploy the isolated package for production
RUN pnpm deploy --filter @rateforge/rate-limiter --prod /prod/rate-limiter

FROM node:22.14-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /prod/rate-limiter/dist ./dist
COPY --from=builder /prod/rate-limiter/node_modules ./node_modules
COPY --from=builder /prod/rate-limiter/package.json ./package.json

USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]