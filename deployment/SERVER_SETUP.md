# Server Setup Instructions

This guide explains how to set up your production and test servers for automated deployments.

## Prerequisites

- Ubuntu/Debian Linux server (Hetzner VPS)
- Root or sudo access
- Git installed
- Domain/IP address for the server

## Initial Server Setup

### 1. Install Docker and Docker Compose

```bash
# Update package list
sudo apt-get update

# Install dependencies
sudo apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# Add Docker's official GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Set up Docker repository
echo \
  "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Add your user to docker group (optional, allows running docker without sudo)
sudo usermod -aG docker $USER
```

### 2. Install PostgreSQL

```bash
# Install PostgreSQL
sudo apt-get install -y postgresql postgresql-contrib

# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql << EOF
CREATE DATABASE discord_bot_prod;
CREATE USER discord_bot WITH PASSWORD 'your_secure_password_here';
GRANT ALL PRIVILEGES ON DATABASE discord_bot_prod TO discord_bot;
\q
EOF
```

### 3. Install Redis

```bash
# Install Redis
sudo apt-get install -y redis-server

# Configure Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Test Redis
redis-cli ping  # Should return PONG
```

### 4. Create Application Directory

```bash
# Create directory
sudo mkdir -p /opt/discord-bot
sudo chown $USER:$USER /opt/discord-bot

# Clone repository
cd /opt/discord-bot
git clone -b main https://github.com/zackyxd/cr-clan-management.git .

# Make deployment scripts executable
chmod +x deployment/deploy.sh
chmod +x deployment/rollback.sh
```

### 5. Configure Environment Variables

Create `.env.prod` file in `/opt/discord-bot/`:

```bash
cd /opt/discord-bot
nano .env.prod
```

Add the following (replace with your actual values):

```bash
NODE_ENV=prod

# Discord
TOKEN=your_discord_bot_token_here
CLIENT_ID=your_discord_client_id_here

# PostgreSQL
PGHOST=localhost
PGPORT=5432
PGDATABASE=discord_bot_prod
PGUSER=discord_bot
PGPASSWORD=your_secure_password_here

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Clash Royale API
CR_KEY=your_clash_royale_api_key_here

# Logging
LOG_LEVEL=info
```

**For test server**, create `.env.test` instead with test database credentials and test bot token.

### 6. Run Initial Deployment

```bash
cd /opt/discord-bot

# For production (uses main branch)
./deployment/deploy.sh prod

# For test server (uses dev branch)
./deployment/deploy.sh test
```

## GitHub Actions Setup

### 1. Generate SSH Keys for Deployment

On your **local machine**, generate SSH keys for GitHub Actions:

```bash
# For production server
ssh-keygen -t ed25519 -C "github-actions-prod" -f ~/.ssh/github_actions_prod

# For test server
ssh-keygen -t ed25519 -C "github-actions-test" -f ~/.ssh/github_actions_test
```

### 2. Add Public Keys to Servers

Copy the public keys to your servers:

```bash
# For production server
ssh-copy-id -i ~/.ssh/github_actions_prod.pub user@your-prod-server-ip

# For test server
ssh-copy-id -i ~/.ssh/github_actions_test.pub user@your-test-server-ip
```

### 3. Add Secrets to GitHub

Go to your GitHub repository → Settings → Secrets and variables → Actions

Add the following secrets:

**For Test Server:**
- `TEST_SERVER_SSH_KEY` - Content of `~/.ssh/github_actions_test` (private key)
- `TEST_SERVER_HOST` - IP or hostname of test server
- `TEST_SERVER_USER` - SSH username (usually your Linux username)

**For Production Server:**
- `PROD_SERVER_SSH_KEY` - Content of `~/.ssh/github_actions_prod` (private key)
- `PROD_SERVER_HOST` - IP or hostname of production server
- `PROD_SERVER_USER` - SSH username

### 4. Set Up GitHub Environments

Go to Settings → Environments:

1. Create `test` environment (no restrictions)
2. Create `production` environment:
   - Add required reviewers (yourself)
   - Add deployment branch rule: only `main` branch

## Deployment Workflow

### Test Environment (Automatic)

```bash
# Create feature branch
git checkout -b feature/my-feature

# Make changes, commit
git add .
git commit -m "Add new feature"

# Merge to dev branch
git checkout dev
git merge feature/my-feature
git push origin dev

# GitHub Actions automatically deploys to test server
```

### Production Environment (Manual Approval)

```bash
# After testing on dev, merge to main
git checkout main
git merge dev
git push origin main

# GitHub Actions workflow triggers, waits for approval
# Go to GitHub → Actions → Click on workflow run → Review deployments → Approve
```

## Maintenance Commands

### View Logs

```bash
# Real-time logs
docker logs -f discord-bot-prod

# Last 100 lines
docker logs discord-bot-prod --tail 100

# Follow logs with timestamps
docker logs -f discord-bot-prod --timestamps
```

### Check Status

```bash
# Container status
docker ps | grep discord-bot

# Health check
curl http://localhost:3000/health

# Resource usage
docker stats discord-bot-prod
```

### Manual Deployment

```bash
cd /opt/discord-bot
./deployment/deploy.sh prod  # or 'test' for test server
```

### Rollback

```bash
cd /opt/discord-bot
./deployment/rollback.sh
```

### Database Migrations

```bash
# Run migrations manually
cd /opt/discord-bot
docker run --rm \
    --env-file .env.prod \
    -v $(pwd)/migrations:/app/migrations \
    discord-bot:latest \
    npx node-pg-migrate up
```

### Database Backup

```bash
# Backup database
sudo -u postgres pg_dump discord_bot_prod > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore database
sudo -u postgres psql discord_bot_prod < backup_file.sql
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker logs discord-bot-prod

# Check if port 3000 is in use
sudo netstat -tlnp | grep 3000

# Check environment variables
docker exec discord-bot-prod env
```

### Database Connection Issues

```bash
# Test PostgreSQL connection
psql -h localhost -U discord_bot -d discord_bot_prod

# Check if PostgreSQL is running
sudo systemctl status postgresql

# Check PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-*.log
```

### Redis Connection Issues

```bash
# Test Redis connection
redis-cli ping

# Check if Redis is running
sudo systemctl status redis-server
```

### Health Check Failing

```bash
# Test health endpoint manually
curl -v http://localhost:3000/health

# Check if container is running
docker ps

# Check container health
docker inspect discord-bot-prod | grep -A 10 Health
```

### Out of Disk Space

```bash
# Clean up old Docker images
docker system prune -a

# Clean up old logs
cd /opt/discord-bot/logs
rm -f *.log.* # Remove rotated logs

# Check disk usage
df -h
du -sh /opt/discord-bot/*
```

## Security Best Practices

1. **Firewall**: Only allow necessary ports
   ```bash
   sudo ufw allow 22/tcp    # SSH
   sudo ufw allow 80/tcp    # HTTP (if needed)
   sudo ufw allow 443/tcp   # HTTPS (if needed)
   sudo ufw enable
   ```

2. **SSH Hardening**: Disable password authentication
   ```bash
   sudo nano /etc/ssh/sshd_config
   # Set: PasswordAuthentication no
   sudo systemctl restart sshd
   ```

3. **Regular Updates**:
   ```bash
   sudo apt-get update && sudo apt-get upgrade -y
   ```

4. **Environment File Permissions**:
   ```bash
   chmod 600 /opt/discord-bot/.env.prod
   ```

5. **Database Security**: Use strong passwords, disable remote connections if not needed

## Monitoring

Consider setting up:
- **Uptime monitoring**: UptimeRobot, Pingdom
- **Log aggregation**: Loki, ELK stack
- **Metrics**: Prometheus + Grafana
- **Alerts**: Discord webhooks for critical errors
