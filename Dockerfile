# Multi-stage lightweight Node.js container
FROM node:20-alpine AS base

WORKDIR /app

# Install build tools for native SQLite modules
RUN apk add --no-cache python3 make g++

# Install dependencies first for efficient caching
COPY package*.json ./
RUN npm ci --only=production

# Copy application source code
COPY . .

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/tables || exit 1

# Start the application
CMD ["npm", "start"]
