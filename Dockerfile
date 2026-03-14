# Multi-stage build for Discord bot
# Stage 1: Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for building)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript to JavaScript
RUN npm run build

# Stage 2: Production stage
FROM node:20-alpine

# Add dumb-init to handle signals properly
RUN apk add --no-cache dumb-init

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Copy migrations (needed for startup)
COPY --from=builder --chown=nodejs:nodejs /app/migrations ./migrations

# Switch to non-root user
USER nodejs

# Expose health check port
EXPOSE 3000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the bot
CMD ["node", "dist/bot.js"]
