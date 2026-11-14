# ==============================================================================
# Multi-Stage Dockerfile for Auto Post WordPress AI
# Optimized for GitHub Actions build, GHCR publishing, and Railway deployment
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Builder (Vite frontend compilation & asset bundling)
# ------------------------------------------------------------------------------
FROM node:22-slim AS builder

WORKDIR /app

# Copy dependency manifests and npm configuration
COPY package.json package-lock.json* .npmrc ./

# Install all dependencies (including devDependencies required for Vite build)
RUN npm install --legacy-peer-deps

# Copy application sources needed for compilation
COPY index.html tsconfig.json vite.config.ts ./
COPY src/ ./src/
COPY server.ts ./
COPY wordpress-plugin/ ./wordpress-plugin/

# Compile frontend SPA bundle into /app/dist
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Production Runner (Lean, secure runtime container)
# ------------------------------------------------------------------------------
FROM node:22-slim AS runner

WORKDIR /app

# Set production environment defaults
ENV NODE_ENV=production \
    PORT=3000

# Copy dependency manifests and npm configuration
COPY package.json package-lock.json* .npmrc ./

# Install production-only dependencies to keep image size small
RUN npm install --omit=dev --legacy-peer-deps && npm cache clean --force

# Copy compiled frontend from builder
COPY --from=builder /app/dist ./dist

# Copy server entrypoint, TypeScript source, config and assets
COPY server.ts tsconfig.json ./
COPY src/ ./src/
COPY wordpress-plugin/ ./wordpress-plugin/

# Create persistent data directory and set node user ownership
RUN mkdir -p .data && chown -R node:node /app

# Run as non-root user
USER node

# Expose internal HTTP port
EXPOSE 3000

# Container healthcheck targeting the public /api/health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })" || exit 1

# Start the application
CMD ["npm", "start"]
