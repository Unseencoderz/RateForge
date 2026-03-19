FROM node:22.14-alpine AS builder

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/rate-limiter/package.json ./packages/rate-limiter/
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json ./packages/types/

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

# FIX: Build ONLY the rate-limiter and its dependencies
RUN pnpm --filter @rateforge/rate-limiter... build

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