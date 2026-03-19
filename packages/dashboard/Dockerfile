FROM node:22.14-alpine AS builder

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

COPY . .
RUN pnpm install --frozen-lockfile

# This builds the static files into /app/packages/dashboard/dist
RUN pnpm --filter @rateforge/dashboard build

FROM nginx:alpine AS runner
# Ensure path matches the build output exactly
COPY --from=builder /app/packages/dashboard/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]