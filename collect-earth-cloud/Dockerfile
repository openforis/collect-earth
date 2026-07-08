# Collect Earth Cloud — container image for Cloud Run.
FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# tsx runs the TypeScript entrypoint directly; no separate build step needed.
CMD ["npx", "tsx", "src/index.ts"]
