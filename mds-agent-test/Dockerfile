# Dockerfile for mds-agent-test Next.js app

# 1. Builder stage: Install dependencies and build the application
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package definitions
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install

# Copy the rest of the application source code
COPY . .

# Build the Next.js application
RUN npm run build

# 2. Production stage: Create a lean production image
FROM node:20-alpine

WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# Copy built assets from the builder stage
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/node_modules ./node_modules

# Expose port 3000
EXPOSE 3000

# Command to run the app
CMD ["npm", "start"]
