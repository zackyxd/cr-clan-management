# Use Node.js LTS version
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code and configuration
COPY . .

# Create logs directory if it doesn't exist
RUN mkdir -p logs

# The command will be specified in docker-compose files
# This allows us to use tsx for development
CMD ["npm", "run", "."]
