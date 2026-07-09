# Collect Earth Cloud — container image for Cloud Run.
FROM node:20-slim

WORKDIR /app

# Install production deps from the lockfile for reproducible builds. tsx is a
# production dependency (the CMD runs the TypeScript entrypoint through it).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# tsx runs the TypeScript entrypoint directly; no separate build step needed.
CMD ["npx", "tsx", "src/index.ts"]
