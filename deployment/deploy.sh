#!/bin/bash
# Deployment script for Discord bot
# Usage: ./deploy.sh [environment]
# Example: ./deploy.sh prod
# Example: ./deploy.sh test

set -e  # Exit on error

ENVIRONMENT="${1:-prod}"
APP_DIR="/opt/discord-bot"
REPO_URL="https://github.com/zackyxd/cr-clan-management.git"
BRANCH="main"

# Set branch based on environment
if [ "$ENVIRONMENT" = "test" ]; then
    BRANCH="dev"
fi

echo "🚀 Starting deployment for $ENVIRONMENT environment..."
echo "📂 Application directory: $APP_DIR"
echo "🌿 Git branch: $BRANCH"

# Navigate to app directory
cd "$APP_DIR"

# Store current commit for rollback
if [ -d ".git" ]; then
    PREVIOUS_COMMIT=$(git rev-parse HEAD)
    echo "📝 Current commit: $PREVIOUS_COMMIT"
    echo "$PREVIOUS_COMMIT" > .previous_commit
fi

# Pull latest code
echo "⬇️  Pulling latest code from $BRANCH..."
if [ ! -d ".git" ]; then
    echo "📦 Cloning repository..."
    git clone -b "$BRANCH" "$REPO_URL" .
else
    git fetch origin
    git checkout "$BRANCH"
    git pull origin "$BRANCH"
fi

NEW_COMMIT=$(git rev-parse HEAD)
echo "✅ Updated to commit: $NEW_COMMIT"

# Build Docker image
echo "🐋 Building Docker image..."
docker build -t discord-bot:latest .
docker tag discord-bot:latest discord-bot:"$NEW_COMMIT"

# Stop existing container
echo "🛑 Stopping existing container..."
docker-compose -f docker-compose.prod.yml down || true

# Run database migrations
echo "🗄️  Running database migrations..."
# Create a temporary container to run migrations
docker run --rm \
    --env-file .env.$ENVIRONMENT \
    -v "$APP_DIR/migrations:/app/migrations" \
    discord-bot:latest \
    npx -y node-pg-migrate up || {
        echo "❌ Migration failed! Rolling back..."
        git checkout "$PREVIOUS_COMMIT"
        docker-compose -f docker-compose.prod.yml up -d
        exit 1
    }

# Start new container
echo "✨ Starting new container..."
docker-compose -f docker-compose.prod.yml up -d

# Wait for health check
echo "🏥 Waiting for health check..."
sleep 10

HEALTH_CHECK_ATTEMPTS=0
MAX_ATTEMPTS=12

while [ $HEALTH_CHECK_ATTEMPTS -lt $MAX_ATTEMPTS ]; do
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        echo "✅ Health check passed!"
        break
    fi
    HEALTH_CHECK_ATTEMPTS=$((HEALTH_CHECK_ATTEMPTS + 1))
    echo "⏳ Health check attempt $HEALTH_CHECK_ATTEMPTS/$MAX_ATTEMPTS..."
    sleep 5
done

if [ $HEALTH_CHECK_ATTEMPTS -eq $MAX_ATTEMPTS ]; then
    echo "❌ Health check failed after $MAX_ATTEMPTS attempts!"
    echo "📋 Recent logs:"
    docker logs discord-bot-prod --tail 50
    echo ""
    echo "🔄 Rolling back to previous version..."
    ./rollback.sh
    exit 1
fi

# Clean up old images (keep last 5)
echo "🧹 Cleaning up old Docker images..."
docker images discord-bot --format "{{.Tag}}" | grep -v latest | tail -n +6 | xargs -r docker rmi discord-bot: || true

echo ""
echo "✅ Deployment completed successfully!"
echo "📊 Container status:"
docker ps | grep discord-bot

echo ""
echo "📝 To view logs, run:"
echo "   docker logs -f discord-bot-prod"
