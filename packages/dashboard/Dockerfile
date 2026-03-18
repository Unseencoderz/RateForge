FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable pnpm

# Copy root configurations and workspaces
COPY . .

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build the workspace (dashboard builds to packages/dashboard/dist)
RUN pnpm run -r build

# Stage 2: Serve
FROM nginx:alpine AS runner

# Copy the built React app to the NGINX html serving directory
COPY --from=builder /app/packages/dashboard/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
