# Deployment Guide

This guide covers the complete deployment process for the Discord bot, from initial setup to continuous deployment with GitHub Actions.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Initial Setup](#initial-setup)
- [Deployment Workflow](#deployment-workflow)
- [Maintenance](#maintenance)
- [Troubleshooting](#troubleshooting)

## Overview

The bot uses a modern, professional deployment setup:

- **Docker** for containerization and consistency across environments
- **GitHub Actions** for automated CI/CD
- **Branch-based deployments**: 
  - `dev` branch → Test server (automatic)
  - `main` branch → Production servers (manual approval required)
- **Health checks** for monitoring and automated rollback
- **Database migrations** automatically applied during deployment

## Architecture

### Environments

| Environment | Branch | Auto-Deploy | Server | Purpose |
|-------------|--------|-------------|--------|---------|
| Development | any | No | Local | Development and testing |
| Test | `dev` | Yes | Test VPS | Pre-production testing |
| Production | `main` | Manual approval | Prod VPS | Live bot serving real servers |

### Components

- **Bot Container**: Main Discord bot process
- **PostgreSQL**: Database (runs on VPS, not in container)
- **Redis**: Cache and queue backend (runs on VPS)
- **Health Check Endpoint**: HTTP server on port 3000 for monitoring

## Initial Setup

### 1. Server Setup

Follow the detailed instructions in [deployment/SERVER_SETUP.md](deployment/SERVER_SETUP.md) to:

1. Install Docker, PostgreSQL, and Redis on your Hetzner VPS
2. Set up application directory at `/opt/discord-bot`
3. Configure `.env.prod` or `.env.test` files
4. Run initial deployment

**Do this for both test and production servers.**

### 2. GitHub Configuration

#### A. Create GitHub Environments

1. Go to your repository → Settings → Environments
2. Create two environments:

**Test Environment:**
- Name: `test`
- No protection rules needed (auto-deploy)

**Production Environment:**
- Name: `production`
- Enable "Required reviewers" → Add yourself
- Enable "Deployment branches" → Select "Selected branches" → Add rule for `main`

#### B. Add GitHub Secrets

Go to Settings → Secrets and variables → Actions → New repository secret

**For Test Server:**
```
TEST_SERVER_SSH_KEY     = <contents of private SSH key>
TEST_SERVER_HOST        = <test server IP or hostname>
TEST_SERVER_USER        = <SSH username>
```

**For Production Server:**
```
PROD_SERVER_SSH_KEY     = <contents of private SSH key>
PROD_SERVER_HOST        = <production server IP or hostname>
PROD_SERVER_USER        = <SSH username>
```

**Generating SSH Keys:**
```bash
# On your local machine
ssh-keygen -t ed25519 -C "github-actions-prod" -f ~/.ssh/github_actions_prod
ssh-keygen -t ed25519 -C "github-actions-test" -f ~/.ssh/github_actions_test

# Copy public keys to servers
ssh-copy-id -i ~/.ssh/github_actions_prod.pub user@prod-server-ip
ssh-copy-id -i ~/.ssh/github_actions_test.pub user@test-server-ip

# Use the PRIVATE keys (without .pub) for GitHub secrets
cat ~/.ssh/github_actions_prod  # Copy this to PROD_SERVER_SSH_KEY
cat ~/.ssh/github_actions_test  # Copy this to TEST_SERVER_SSH_KEY
```

### 3. Create Dev Branch

If you don't have a `dev` branch yet:

```bash
git checkout -b dev
git push -u origin dev
```

## Deployment Workflow

### Test Deployment (Automatic)

```bash
# Create a feature branch
git checkout -b feature/my-new-feature

# Make your changes
# ... edit files ...

# Commit and push
git add .
git commit -m "Add new feature"
git push origin feature/my-new-feature

# Merge to dev branch (or create PR and merge on GitHub)
git checkout dev
git merge feature/my-new-feature
git push origin dev
```

**What happens:**
1. GitHub Actions detects push to `dev` branch
2. Runs tests with PostgreSQL and Redis in CI
3. If tests pass, automatically deploys to test server
4. Health check verifies deployment success
5. You receive notification of deployment status

### Production Deployment (Manual Approval)

```bash
# After testing on dev, merge to main
git checkout main
git merge dev
git push origin main
```

**What happens:**
1. GitHub Actions detects push to `main` branch
2. Runs full test suite
3. **Waits for manual approval** (you get notification)
4. You review and approve the deployment on GitHub
5. Deploys to production server
6. Health check verifies deployment
7. Creates a timestamped git tag for the deployment

**To approve deployment:**
1. Go to GitHub → Actions tab
2. Click on the workflow run
3. Click "Review deployments"
4. Select "production"
5. Click "Approve and deploy"

### Local Development

```bash
# Development with hot reload
npm run .

# Or use Docker Compose for full local environment
docker-compose up

# Run tests
npm test

# Run migrations
npm run migrate:dev:up
```

## Maintenance

### View Logs

**On server:**
```bash
# Follow real-time logs
docker logs -f discord-bot-prod

# Last 100 lines
docker logs discord-bot-prod --tail 100

# With timestamps
docker logs -f discord-bot-prod --timestamps
```

**From GitHub Actions:**
- Go to Actions tab → Click on workflow run → View logs

### Check Bot Status

```bash
# Container status
docker ps | grep discord-bot

# Health check
curl http://localhost:3000/health

# Resource usage
docker stats discord-bot-prod
```

### Manual Deployment

If you need to deploy without using GitHub Actions:

```bash
# SSH to server
ssh user@your-server-ip

# Navigate to app directory
cd /opt/discord-bot

# Run deployment script
./deployment/deploy.sh prod  # or 'test'
```

### Rollback

If a deployment causes issues:

```bash
# SSH to server
ssh user@your-server-ip

# Navigate to app directory
cd /opt/discord-bot

# Run rollback script
./deployment/rollback.sh
```

This will:
1. Stop the current container
2. Checkout the previous git commit
3. Use the previous Docker image (if available)
4. Start the container
5. Verify with health check

### Database Operations

**Run migrations manually:**
```bash
cd /opt/discord-bot
docker run --rm \
    --env-file .env.prod \
    -v $(pwd)/migrations:/app/migrations \
    discord-bot:latest \
    npx node-pg-migrate up
```

**Backup database:**
```bash
sudo -u postgres pg_dump discord_bot_prod > backup_$(date +%Y%m%d_%H%M%S).sql
```

**Restore database:**
```bash
sudo -u postgres psql discord_bot_prod < backup_file.sql
```

## Troubleshooting

### Deployment Failed

1. **Check GitHub Actions logs:**
   - Go to Actions tab → Click failed workflow → Check error messages

2. **Check server logs:**
   ```bash
   ssh user@server-ip
   cd /opt/discord-bot
   docker logs discord-bot-prod --tail 100
   ```

3. **Common issues:**
   - **Tests failing**: Fix tests locally first, then push
   - **SSH connection failed**: Verify SSH keys and server access
   - **Health check failed**: Check database connection, environment variables
   - **Migration failed**: Check migration scripts, database state

### Bot Not Responding

1. **Check if container is running:**
   ```bash
   docker ps | grep discord-bot
   ```

2. **Check health endpoint:**
   ```bash
   curl http://localhost:3000/health
   ```

3. **Check container logs:**
   ```bash
   docker logs discord-bot-prod --tail 100
   ```

4. **Restart container:**
   ```bash
   cd /opt/discord-bot
   docker-compose -f docker-compose.prod.yml restart
   ```

### Database Connection Issues

1. **Verify PostgreSQL is running:**
   ```bash
   sudo systemctl status postgresql
   ```

2. **Test connection:**
   ```bash
   psql -h localhost -U discord_bot -d discord_bot_prod
   ```

3. **Check environment variables:**
   ```bash
   cat /opt/discord-bot/.env.prod | grep PG
   ```

### Health Check Failing

1. **Test manually:**
   ```bash
   curl -v http://localhost:3000/health
   ```

2. **Check if port is accessible:**
   ```bash
   sudo netstat -tlnp | grep 3000
   ```

3. **Verify firewall rules:**
   ```bash
   sudo ufw status
   ```

### Out of Disk Space

```bash
# Clean up Docker
docker system prune -a -f

# Remove old images
docker images | grep discord-bot | tail -n +6 | awk '{print $3}' | xargs docker rmi

# Clean up logs
cd /opt/discord-bot/logs
rm -f *.log.*
```

## Best Practices

### Development Workflow

1. **Always create feature branches** from `dev`
2. **Test locally** before pushing
3. **Merge to dev first** for testing on test server
4. **Only merge to main** after testing on dev
5. **Create descriptive commit messages**

### Deployment

1. **Never skip the test environment** - always test on dev first
2. **Monitor the deployment** - watch GitHub Actions and health checks
3. **Verify functionality** after deployment
4. **Have a rollback plan** ready for production deployments
5. **Keep environment variables in sync** between servers

### Security

1. **Never commit .env files** to git
2. **Use strong passwords** for production database
3. **Regularly update dependencies**: `npm audit` and `npm update`
4. **Keep server packages updated**: `sudo apt update && sudo apt upgrade`
5. **Limit SSH access** - use key authentication only
6. **Review GitHub Actions logs** - don't expose secrets

### Monitoring

Consider setting up:
- **Uptime monitoring**: UptimeRobot, Pingdom (monitor the `/health` endpoint)
- **Discord webhook notifications** for deployment success/failure
- **Log aggregation**: Ship logs to external service for analysis
- **Database backups**: Set up automated daily backups

## Quick Reference

### Common Commands

```bash
# Deploy to test
git checkout dev
git merge feature-branch
git push

# Deploy to production
git checkout main
git merge dev
git push
# Then approve on GitHub

# View logs
docker logs -f discord-bot-prod

# Check status
curl http://localhost:3000/health

# Rollback
./deployment/rollback.sh

# Backup database
sudo -u postgres pg_dump discord_bot_prod > backup.sql
```

### File Locations

- Bot code: `/opt/discord-bot/`
- Environment config: `/opt/discord-bot/.env.prod`
- Logs: `/opt/discord-bot/logs/`
- Deploy script: `/opt/discord-bot/deployment/deploy.sh`
- Rollback script: `/opt/discord-bot/deployment/rollback.sh`

### Important URLs

- Health check: `http://server-ip:3000/health`
- GitHub Actions: `https://github.com/zackyxd/cr-clan-management/actions`
- GitHub Environments: `https://github.com/zackyxd/cr-clan-management/settings/environments`

## Getting Help

If you run into issues:

1. Check the logs (Docker, GitHub Actions)
2. Review this documentation
3. Check [deployment/SERVER_SETUP.md](deployment/SERVER_SETUP.md)
4. Verify environment variables
5. Test the health endpoint

Remember: You can always rollback if something goes wrong!
