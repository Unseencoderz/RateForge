FROM node:22.14-alpine AS builder

WORKDIR /app

# Enable Corepack for pnpm 10 support
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# Copy only config files first for better caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/api-gateway/package.json ./packages/api-gateway/
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json ./packages/types/


# Install dependencies (ignoring scripts to avoid husky errors in Docker)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source code
COPY . .

# FIX: Build ONLY the gateway and its dependencies (config/types)
RUN pnpm --filter @rateforge/api-gateway... build

# Deploy with pnpm 10
RUN pnpm deploy --filter @rateforge/api-gateway --prod /prod/api-gateway

FROM node:22.14-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /prod/api-gateway/dist ./dist
COPY --from=builder /prod/api-gateway/node_modules ./node_modules
COPY --from=builder /prod/api-gateway/package.json ./package.json
COPY --from=builder /app/packages/api-gateway/rules.json ./rules.json

RUN chown -R node:node /app

USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]