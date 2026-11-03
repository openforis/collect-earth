# Collect Earth Cloud — container image (Cloud Run, Render, any Docker host).

# Stage 1: build the web dashboard (web/ has its own package.json and lockfile).
FROM node:20-slim AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web ./web
RUN cd web && npm run build

# Stage 2: the API server, serving the built dashboard from web/dist.
FROM node:20-slim

WORKDIR /app

# Install production deps from the lockfile for reproducible builds. tsx is a
# production dependency (the CMD runs the TypeScript entrypoint through it).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
COPY --from=build /app/web/dist ./web/dist

ENV NODE_ENV=production
ENV PORT=8080
# The server's heap in MB (V8's --max-old-space-size): 224 suits the 512 MiB deploy.sh gives an
# instance (the quality worker's QUALITY_WORKER_MAX_MB and Node's own memory come on top). With
# --memory=1Gi set NODE_HEAP_MB=448 and QUALITY_WORKER_MAX_MB=320 (DEPLOY.md, "Memory").
ENV NODE_HEAP_MB=224
EXPOSE 8080

# Node runs the TypeScript entrypoint with tsx as its loader (no separate build step, and no npx:
# node itself is the container's process, so it gets Cloud Run's SIGTERM). NODE_OPTIONS given at
# deploy time still applies, after the heap set here.
CMD ["sh", "-c", "export NODE_OPTIONS=\"--max-old-space-size=${NODE_HEAP_MB} ${NODE_OPTIONS:-}\"; exec node --import tsx src/index.ts"]
