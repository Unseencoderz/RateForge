FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable pnpm

# Copy root configurations and workspaces
COPY . .

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build the workspace
RUN pnpm run -r build

# Deploy the rate-limiter package with only its production dependencies
RUN pnpm deploy --filter @rateforge/rate-limiter --prod /prod/rate-limiter

# Stage 2: Runner
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Copy only dist, node_modules, and package.json to drastically reduce image size
COPY --from=builder /prod/rate-limiter/dist ./dist
COPY --from=builder /prod/rate-limiter/node_modules ./node_modules
COPY --from=builder /prod/rate-limiter/package.json ./package.json

USER node
EXPOSE 3001

CMD ["node", "dist/index.js"]
