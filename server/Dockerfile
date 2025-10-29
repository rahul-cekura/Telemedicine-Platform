# Server Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev dependencies)
RUN npm install

# Verify knex is installed
RUN ls -la node_modules/.bin/ || echo "node_modules not found"

# Copy application files
COPY . .

# Expose port
EXPOSE 5000

# Run migrations and start server using full path
CMD ["sh", "-c", "./node_modules/.bin/knex migrate:latest && node index.js"]
