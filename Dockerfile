# ---- build stage: full toolchain, dev dependencies, TypeScript compiler
FROM node:20-alpine AS build
WORKDIR /app
# Copy manifests first so a source-only change reuses the cached install layer.
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY evals ./evals
RUN npm run build && npm prune --omit=dev

# ---- runtime stage: no compiler, no dev dependencies, non-root
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY data ./data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1
# Exec form, so node is PID 1 and receives SIGTERM for graceful shutdown.
CMD ["node", "dist/src/server.js"]
