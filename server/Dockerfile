# Server Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev dependencies like knex CLI)
RUN npm ci

# Copy application files
COPY . .

# Expose port
EXPOSE 5000

# Run migrations and start server
CMD ["sh", "-c", "npx knex migrate:latest && node index.js"]
