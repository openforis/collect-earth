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
EXPOSE 8080

# tsx runs the TypeScript entrypoint directly; no separate build step needed.
CMD ["npx", "tsx", "src/index.ts"]
