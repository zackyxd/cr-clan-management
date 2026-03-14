# Getting Started - Step by Step Guide

This guide assumes you've never used Docker before and will walk you through everything from scratch.

## What is Docker? (Simple Explanation)

Docker packages your bot and all its dependencies into a "container" - think of it like a portable box that contains everything your bot needs to run. This box works the same way on your laptop, test server, and production server. No more "works on my machine" problems!

You don't need to deeply understand Docker to use this setup - just follow these steps.

## Phase 1: Test Locally First (Your Computer)

Before deploying to servers, let's make sure everything works on your local machine.

### Step 1: Install Docker on Your Computer

**Windows (with WSL2 - recommended):**
1. Download Docker Desktop from https://www.docker.com/products/docker-desktop
2. Install it (it will set up WSL2 if needed)
3. Start Docker Desktop
4. Open a terminal and verify: `docker --version`

**Linux (Ubuntu/Debian):**
```bash
# You probably already have this working since you're on Linux
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
# Log out and back in
docker --version
```

**Mac:**
1. Download Docker Desktop from https://www.docker.com/products/docker-desktop
2. Install it
3. Start Docker Desktop
4. Open terminal and verify: `docker --version`

### Step 2: Test Your Bot with Docker Locally

This will test if the Docker setup works before worrying about servers.

```bash
# Navigate to your project
cd ~/cr-management-discord-bot

# Make sure you have a .env.dev file
# If not, copy the example
cp .env.example .env.dev

# Edit .env.dev with your actual values
nano .env.dev
# Add your Discord TOKEN, CLIENT_ID, CR_KEY, etc.
# Save and exit (Ctrl+X, then Y, then Enter)

# Start everything with Docker Compose
docker-compose up
```

**What this does:**
- Starts PostgreSQL database
- Starts Redis
- Builds your bot into a Docker image
- Starts your bot
- All of these run in containers on your computer

**When it works, you'll see:**
- Logs showing the bot connecting
- "✅ Ready! Logged in as YourBot#1234"
- "🏥 Health check server listening on port 3000"

**To stop it:**
- Press `Ctrl+C`
- Run `docker-compose down` to clean up

**Test the health endpoint:**
```bash
# In another terminal while bot is running
curl http://localhost:3000/health
```

You should see JSON with bot status!

### Step 3: Commit and Push Your Changes

Now that everything works locally, let's push these changes to GitHub.

```bash
# Check what files were added
git status

# Add all the new deployment files
git add Dockerfile docker-compose.yml docker-compose.prod.yml .dockerignore
git add .github/ deployment/ DEPLOYMENT.md .env.example
git add src/utils/env.ts src/utils/healthCheck.ts src/bot.ts package.json

# Commit
git commit -m "Add professional deployment setup with Docker and CI/CD"

# Push to main
git push origin main
```

## Phase 2: Configure GitHub

You need to set up GitHub so it can automatically deploy your bot.

### Step 1: Create a Dev Branch

The `dev` branch is for testing before production.

```bash
# Create and switch to dev branch
git checkout -b dev

# Push it to GitHub
git push -u origin dev

# Switch back to main
git checkout main
```

### Step 2: Set Up GitHub Environments

1. Go to your repository on GitHub: https://github.com/zackyxd/cr-clan-management
2. Click **Settings** (top menu)
3. Click **Environments** (left sidebar)

**Create Test Environment:**
1. Click "New environment"
2. Name it: `test`
3. Click "Configure environment"
4. Don't add any protection rules
5. Click "Save protection rules"

**Create Production Environment:**
1. Click "New environment"
2. Name it: `production`
3. Click "Configure environment"
4. Check "Required reviewers"
5. Add yourself as a reviewer
6. Under "Deployment branches", click "Selected branches"
7. Add a rule: `main`
8. Click "Add rule" then "Save protection rules"

### Step 3: Prepare SSH Keys (For Later)

We'll set up the actual servers in Phase 3, but let's prepare the SSH keys now.

```bash
# Create a directory for deployment keys
mkdir -p ~/.ssh/deployment-keys

# Generate key for test server
ssh-keygen -t ed25519 -C "github-actions-test" -f ~/.ssh/deployment-keys/github_actions_test -N ""

# Generate key for production server
ssh-keygen -t ed25519 -C "github-actions-prod" -f ~/.ssh/deployment-keys/github_actions_prod -N ""

# View the private keys (we'll need these for GitHub)
echo "=== TEST SERVER PRIVATE KEY ==="
cat ~/.ssh/deployment-keys/github_actions_test
echo ""
echo "=== PROD SERVER PRIVATE KEY ==="
cat ~/.ssh/deployment-keys/github_actions_prod
echo ""
echo "=== TEST SERVER PUBLIC KEY ==="
cat ~/.ssh/deployment-keys/github_actions_test.pub
echo ""
echo "=== PROD SERVER PUBLIC KEY ==="
cat ~/.ssh/deployment-keys/github_actions_prod.pub
```

**Save these somewhere safe!** You'll need them later.

## Phase 3: Set Up Your Hetzner Servers

You need two servers (or you can use one server but with different ports/containers for testing).

### Option A: Two Separate Servers (Recommended)

**Server 1: Test Server** - For `dev` branch  
**Server 2: Production Server** - For `main` branch

### Option B: One Server (Budget Option)

You can use one server and run both test and production bots with different:
- Container names (`discord-bot-test` vs `discord-bot-prod`)
- Ports (3000 vs 3001)
- Database names (`discord_bot_test` vs `discord_bot_prod`)

**For this guide, I'll assume two separate servers.**

### Server Setup Process (Do This for BOTH Servers)

#### 1. SSH into your server

```bash
# Replace with your server IP
ssh root@YOUR_SERVER_IP
```

#### 2. Run this complete setup script

Copy and paste this entire script into your server terminal:

```bash
#!/bin/bash
# Complete server setup script

echo "🚀 Starting Discord bot server setup..."

# Update system
apt-get update && apt-get upgrade -y

# Install Docker
echo "📦 Installing Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
systemctl start docker
systemctl enable docker

# Install PostgreSQL
echo "🗄️ Installing PostgreSQL..."
apt-get install -y postgresql postgresql-contrib
systemctl start postgresql
systemctl enable postgresql

# Install Redis
echo "💾 Installing Redis..."
apt-get install -y redis-server
systemctl start redis-server
systemctl enable redis-server

# Install other utilities
apt-get install -y git curl wget

echo "✅ Base installation complete!"

# Create database (you'll need to customize this part)
echo "📊 Setting up database..."
read -p "Enter database name (e.g., discord_bot_prod or discord_bot_test): " DB_NAME
read -p "Enter database user (e.g., discord_bot): " DB_USER
read -sp "Enter database password: " DB_PASS
echo ""

sudo -u postgres psql << EOF
CREATE DATABASE $DB_NAME;
CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
\q
EOF

echo "✅ Database created!"

# Create application directory
echo "📁 Creating application directory..."
mkdir -p /opt/discord-bot
cd /opt/discord-bot

# Clone repository
read -p "Clone repository now? (you need to set up SSH key first) [y/N]: " CLONE_NOW
if [ "$CLONE_NOW" = "y" ]; then
    git clone https://github.com/zackyxd/cr-clan-management.git .
fi

echo ""
echo "✅ Server setup complete!"
echo ""
echo "📝 Next steps:"
echo "1. Add SSH keys for GitHub Actions access"
echo "2. Create .env.prod (or .env.test) file in /opt/discord-bot/"
echo "3. Test deployment with ./deployment/deploy.sh"
```

Save this as `setup-server.sh`, make it executable, and run it:

```bash
nano setup-server.sh
# Paste the script above
# Save: Ctrl+X, Y, Enter

chmod +x setup-server.sh
./setup-server.sh
```

#### 3. Add SSH access for GitHub Actions

Still on your server:

```bash
# For TEST server, add the test public key
# For PROD server, add the prod public key

# View your public keys (from your local machine)
# On your LOCAL machine:
cat ~/.ssh/deployment-keys/github_actions_test.pub  # or github_actions_prod.pub

# Back on SERVER, add it to authorized_keys
mkdir -p ~/.ssh
nano ~/.ssh/authorized_keys
# Paste the public key
# Save: Ctrl+X, Y, Enter

# Set permissions
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

#### 4. Create environment file on server

```bash
cd /opt/discord-bot
nano .env.prod  # or .env.test for test server
```

Paste this template and fill in your values:

```bash
NODE_ENV=prod

# Discord
TOKEN=your_discord_bot_token_here
CLIENT_ID=your_discord_client_id_here

# PostgreSQL (use the values from setup script)
PGHOST=localhost
PGPORT=5432
PGDATABASE=discord_bot_prod
PGUSER=discord_bot
PGPASSWORD=your_database_password_here

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Clash Royale API
CR_KEY=your_clash_royale_api_key_here

# Logging
LOG_LEVEL=info
```

Save it (Ctrl+X, Y, Enter) and secure it:

```bash
chmod 600 .env.prod
```

#### 5. Test deployment manually

```bash
cd /opt/discord-bot

# Clone repository if you haven't
git clone https://github.com/zackyxd/cr-clan-management.git .

# Make scripts executable
chmod +x deployment/*.sh

# Test deployment
./deployment/deploy.sh prod  # or 'test' for test server
```

If successful, you'll see the bot come online!

**Check it's working:**
```bash
docker ps  # Should show discord-bot-prod container running
curl http://localhost:3000/health  # Should return JSON health status
docker logs discord-bot-prod  # View bot logs
```

## Phase 4: Configure GitHub Secrets

Now we connect GitHub Actions to your servers.

1. Go to: https://github.com/zackyxd/cr-clan-management/settings/secrets/actions
2. Click "New repository secret"

**Add these secrets:**

**For Test Server:**
- Name: `TEST_SERVER_SSH_KEY`  
  Value: [Paste private key from `~/.ssh/deployment-keys/github_actions_test`]
  
- Name: `TEST_SERVER_HOST`  
  Value: [Your test server IP, e.g., `123.45.67.89`]
  
- Name: `TEST_SERVER_USER`  
  Value: [SSH username, probably `root`]

**For Production Server:**
- Name: `PROD_SERVER_SSH_KEY`  
  Value: [Paste private key from `~/.ssh/deployment-keys/github_actions_prod`]
  
- Name: `PROD_SERVER_HOST`  
  Value: [Your production server IP, e.g., `123.45.67.90`]
  
- Name: `PROD_SERVER_USER`  
  Value: [SSH username, probably `root`]

## Phase 5: Test the Deployment Pipeline!

### Test Automatic Deployment to Test Server

```bash
# On your local machine
cd ~/cr-management-discord-bot

# Switch to dev branch
git checkout dev

# Make a small test change
echo "# Test deployment" >> README.md

# Commit and push
git add README.md
git commit -m "Test automatic deployment to test server"
git push origin dev
```

**What happens:**
1. Go to https://github.com/zackyxd/cr-clan-management/actions
2. You'll see a workflow running "Deploy to Test Server"
3. Watch it run (click on it to see details)
4. If successful, your test server bot will update automatically!

**Verify it worked:**
```bash
# SSH to test server
ssh root@YOUR_TEST_SERVER_IP

# Check logs
docker logs discord-bot-prod
```

### Test Production Deployment with Approval

```bash
# On your local machine
git checkout main
git merge dev
git push origin main
```

**What happens:**
1. Go to https://github.com/zackyxd/cr-clan-management/actions
2. Workflow runs tests
3. Stops and waits for YOUR approval
4. Click "Review deployments" → Select "production" → "Approve and deploy"
5. Watches it deploy to production!

## Common Docker Commands (Cheat Sheet)

Once your bot is running on the server, here are useful commands:

```bash
# View running containers
docker ps

# View all containers (including stopped)
docker ps -a

# View logs (real-time)
docker logs -f discord-bot-prod

# View last 100 log lines
docker logs discord-bot-prod --tail 100

# Restart container
docker restart discord-bot-prod

# Stop container
docker stop discord-bot-prod

# Start container
docker start discord-bot-prod

# Check container resource usage
docker stats discord-bot-prod

# Enter container shell (for debugging)
docker exec -it discord-bot-prod sh

# Remove stopped containers
docker container prune

# Remove unused images
docker image prune -a
```

## Troubleshooting

### "Permission denied" when running Docker

```bash
# Add your user to docker group
sudo usermod -aG docker $USER
# Log out and back in
```

### "Port already in use"

```bash
# See what's using port 3000
sudo netstat -tlnp | grep 3000
# Kill it or change the port in docker-compose
```

### Can't SSH to server

```bash
# Test SSH connection
ssh -v -i ~/.ssh/deployment-keys/github_actions_test root@SERVER_IP
# Check if public key is in server's ~/.ssh/authorized_keys
```

### Deployment fails in GitHub Actions

1. Check the workflow logs in Actions tab
2. Common issues:
   - SSH key not added correctly (check secrets)
   - Server IP wrong (check secrets)
   - Server not set up yet
   - Wrong username (check secrets)

### Bot doesn't start

```bash
# Check logs
docker logs discord-bot-prod

# Common issues:
# - Wrong environment variables (check .env.prod)
# - Database connection failed (test: psql -h localhost -U discord_bot -d discord_bot_prod)
# - Redis connection failed (test: redis-cli ping)
```

## Summary: What You Need

**From your computer:**
- ✅ Docker installed
- ✅ Code pushed to GitHub
- ✅ SSH keys generated

**From GitHub:**
- ✅ Two branches: `main` and `dev`
- ✅ Two environments: `test` and `production`
- ✅ Six secrets configured (SSH keys, hosts, users)

**From Hetzner:**
- ✅ Two servers (or one with separation)
- ✅ Docker, PostgreSQL, Redis installed
- ✅ `/opt/discord-bot` with code and scripts
- ✅ `.env.prod` and `.env.test` files with credentials
- ✅ SSH keys added for GitHub Actions access

**Your workflow:**
```
Local changes → push to dev → auto-deploys to test server → test it
                      ↓
              merge dev to main → approve on GitHub → deploys to production
```

That's it! Once set up, you just push code and it deploys automatically. No more manual WinSCP! 🚀

## Need Help?

Start with Phase 1 (test locally) - that's the easiest way to understand if everything works before dealing with servers. If you get stuck, check which phase you're on and troubleshoot that specific step.
