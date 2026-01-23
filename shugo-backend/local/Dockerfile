# SHUGO Local Server Dockerfile
# Optimized for Raspberry Pi (ARM64)

FROM node:20-alpine

# Install required system packages
RUN apk add --no-cache \
    sqlite \
    curl \
    tzdata \
    bash

# Set timezone
ENV TZ=Europe/Paris
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY src ./src
COPY scripts ./scripts

# Create necessary directories
RUN mkdir -p logs data temp && \
    chmod 755 scripts/*.js 2>/dev/null || true

# Create non-root user
RUN addgroup -g 1001 -S shugo && \
    adduser -S -u 1001 -G shugo shugo && \
    chown -R shugo:shugo /app

# Switch to non-root user
USER shugo

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (r) => {r.statusCode === 200 ? process.exit(0) : process.exit(1)})"

# Start the application
CMD ["node", "src/index.js"]
