FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable pnpm

# Copy root configurations and workspaces
COPY . .

# Install dependencies (respects pnpm-workspace.yaml and frozen lockfile)
RUN pnpm install --frozen-lockfile

# Build the workspace
RUN pnpm run -r build

# Deploy the api-gateway package with only its production dependencies
RUN pnpm deploy --filter @rateforge/api-gateway --prod /prod/api-gateway

# Stage 2: Runner
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Copy only dist, node_modules, and package.json to drastically reduce image size
COPY --from=builder /prod/api-gateway/dist ./dist
COPY --from=builder /prod/api-gateway/node_modules ./node_modules
COPY --from=builder /prod/api-gateway/package.json ./package.json

USER node
EXPOSE 3000

CMD ["node", "dist/server.js"]
