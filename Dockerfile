# Multi-stage build for production
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY frontend/package*.json ./frontend/

# Build tools for native modules (better-sqlite3, sharp)
RUN apk add --no-cache python3 make g++

# Install backend dependencies
RUN npm ci --only=production

# Install frontend dependencies and build
WORKDIR /app/frontend
RUN npm ci

# Build frontend
FROM base AS frontend-builder
WORKDIR /app/frontend
COPY --from=deps /app/frontend/node_modules ./node_modules
COPY frontend/ .
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

# Use the built-in 'node' user (UID 1000, GID 1000) for host volume compatibility
# node:20-alpine already provides user 'node' with UID/GID 1000

# Copy backend
COPY --from=deps /app/node_modules ./node_modules
COPY backend/ ./backend/
COPY branding/ ./branding/
COPY package*.json ./

# Copy frontend build
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Create directories for data persistence
RUN mkdir -p /app/uploads /app/tmp /app/backend/logs /app/data /app/branding && \
    chown -R node:node /app

# Switch to non-root user
USER node

# Environment variables (override in docker-compose or runtime)
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/health/ready || exit 1

EXPOSE 3000

# Start the application
CMD ["node", "backend/server.js"]
