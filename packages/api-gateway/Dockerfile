# Use Node 22.14 to satisfy Vite/Rolldown requirements
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

# Partial install for build
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm run -r build

# Deploy with pnpm 10 (Requires the .npmrc inject-workspace-packages = true)
RUN pnpm deploy --filter @rateforge/api-gateway --prod /prod/api-gateway

FROM node:22.14-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /prod/api-gateway/dist ./dist
COPY --from=builder /prod/api-gateway/node_modules ./node_modules
COPY --from=builder /prod/api-gateway/package.json ./package.json

USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]