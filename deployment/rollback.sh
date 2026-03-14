#!/bin/bash
# Rollback script for Discord bot
# Usage: ./rollback.sh

set -e

APP_DIR="/opt/discord-bot"
PREVIOUS_COMMIT_FILE="$APP_DIR/.previous_commit"

echo "🔄 Starting rollback..."

cd "$APP_DIR"

# Check if previous commit file exists
if [ ! -f "$PREVIOUS_COMMIT_FILE" ]; then
    echo "❌ No previous commit found. Cannot rollback."
    echo "Available tagged images:"
    docker images discord-bot --format "{{.Tag}}" | grep -v latest | head -5
    exit 1
fi

PREVIOUS_COMMIT=$(cat "$PREVIOUS_COMMIT_FILE")
echo "📝 Rolling back to commit: $PREVIOUS_COMMIT"

# Stop current container
echo "🛑 Stopping current container..."
docker-compose -f docker-compose.prod.yml down

# Checkout previous commit
echo "⏮️  Checking out previous commit..."
git checkout "$PREVIOUS_COMMIT"

# Check if image exists for this commit
if docker images discord-bot:"$PREVIOUS_COMMIT" --format "{{.Tag}}" | grep -q "$PREVIOUS_COMMIT"; then
    echo "✅ Found existing image for commit $PREVIOUS_COMMIT"
    docker tag discord-bot:"$PREVIOUS_COMMIT" discord-bot:latest
else
    echo "🐋 Building image for previous commit..."
    docker build -t discord-bot:latest .
    docker tag discord-bot:latest discord-bot:"$PREVIOUS_COMMIT"
fi

# Start container with previous version
echo "✨ Starting previous version..."
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
    echo "❌ Rollback health check failed!"
    echo "📋 Recent logs:"
    docker logs discord-bot-prod --tail 50
    exit 1
fi

echo ""
echo "✅ Rollback completed successfully!"
echo "📊 Container status:"
docker ps | grep discord-bot

echo ""
echo "📝 To view logs, run:"
echo "   docker logs -f discord-bot-prod"
