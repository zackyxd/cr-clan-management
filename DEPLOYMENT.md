# 🚀 Deployment Guide - Hetzner Server with PM2

Complete guide for deploying both dev and production bots using PM2 on your Hetzner server.

---

## Why PM2?

✅ **Simple** - No Docker complexity, just Node.js  
✅ **Auto-restart** - Automatically restarts on crashes  
✅ **Built-in logging** - Easy log viewing with `pm2 logs`  
✅ **Monitoring** - Real-time CPU/memory stats with `pm2 monit`  
✅ **Fast updates** - Just `git pull && pm2 restart`  
✅ **Lightweight** - No container overhead  
✅ **Production-ready** - Used by millions of Node.js apps

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Hetzner Linux Server                           │
│                                                             │
│  ┌────────────────┐          ┌────────────────┐           │
│  │   bot-dev      │          │   bot-prod     │           │
│  │   (PM2)        │          │   (PM2)        │           │
│  │   Branch: dev  │          │   Branch: main │           │
│  └────────┬───────┘          └────────┬───────┘           │
│           │                           │                    │
│           └───────────┬───────────────┘                    │
│                       ▼                                    │
│              ┌─────────────────┐                           │
│              │   PostgreSQL    │                           │
│              │   Port: 5432    │                           │
│              │   Databases:    │                           │
│              │   - cr_bot_dev  │                           │
│              │   - cr_bot_prod │                           │
│              └─────────────────┘                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Part 1: Local Machine Setup

### 1. Commit and Push Code

```bash
# Commit PM2 setup
git add .
git commit -m "Switch from Docker to PM2 for deployment"

# Create dev branch
git checkout -b dev
git push -u origin dev

# Push main branch
git checkout main
git push origin main
```

---

## Part 2: Server Prerequisites

### 1. Connect to Your Hetzner Server

```bash
ssh your_user@your_server_ip
```

### 2. Install Node.js 20

```bash
# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version  # Should be v20.x.x
npm --version
```

### 3. Install PM2 Globally

```bash
# Install PM2
sudo npm install -g pm2

# Verify
pm2 --version

# Setup PM2 startup script (auto-start on server reboot)
pm2 startup
# Follow the command it gives you (copy and paste it)
```

### 4. Install PostgreSQL

```bash
# Install PostgreSQL
sudo apt update
sudo apt install postgresql postgresql-contrib -y

# Start and enable PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Verify
sudo systemctl status postgresql
```

### 5. Setup PostgreSQL Databases

```bash
# Switch to postgres user
sudo -u postgres psql
```

```sql
-- Create bot user
CREATE USER botuser WITH PASSWORD 'YOUR_SECURE_PASSWORD_HERE';

-- Create dev database
CREATE DATABASE cr_bot_dev OWNER botuser;

-- Create prod database
CREATE DATABASE cr_bot_prod OWNER botuser;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE cr_bot_dev TO botuser;
GRANT ALL PRIVILEGES ON DATABASE cr_bot_prod TO botuser;

-- Exit
\q
```

---

## Part 3: Deploy Your Bot

### 1. Clone Repository

```bash
cd ~
git clone git@github.com:zackyxd/cr-clan-management.git
cd cr-clan-management

# Install dependencies
npm install
```

### 2. Create Environment Files

#### Create `.env.dev`

```bash
nano .env.dev
```

```env
# Discord - DEV BOT
DISCORD_TOKEN=your_dev_bot_token
DISCORD_CLIENT_ID=your_dev_bot_client_id
DISCORD_GUILD_ID=your_test_server_id

# Database - DEV
PGUSER=botuser
PGPASSWORD=YOUR_SECURE_PASSWORD_HERE
PGDATABASE=cr_bot_dev
PGHOST=localhost
PGPORT=5432

# Clash Royale API
CR_API_KEY=your_cr_api_key

# Environment
NODE_ENV=dev
```

Save: `Ctrl+X`, `Y`, `Enter`

#### Create `.env.prod`

```bash
nano .env.prod
```

```env
# Discord - PROD BOT
DISCORD_TOKEN=your_prod_bot_token
DISCORD_CLIENT_ID=your_prod_bot_client_id

# Database - PROD
PGUSER=botuser
PGPASSWORD=YOUR_SECURE_PASSWORD_HERE
PGDATABASE=cr_bot_prod
PGHOST=localhost
PGPORT=5432

# Clash Royale API
CR_API_KEY=your_cr_api_key

# Environment
NODE_ENV=production
```

Save: `Ctrl+X`, `Y`, `Enter`

### 3. Update ecosystem.config.js Paths

```bash
nano ecosystem.config.js
```

Change the `cwd` path on **both** apps from `/home/zacky/cr-clan-management` to your actual path (e.g., `/home/your_user/cr-clan-management`).

Save: `Ctrl+X`, `Y`, `Enter`

### 4. Run Migrations

```bash
# Run migrations on DEV database
npm run migrate:dev:up

# Run migrations on PROD database
npm run migrate:prod:up
```

### 5. Start Both Bots

```bash
# Start both dev and prod bots
pm2 start ecosystem.config.js

# OR start individually
npm run pm2:start:dev   # Dev only
npm run pm2:start:prod  # Prod only

# Save PM2 process list (for auto-restart on reboot)
pm2 save
```

### 6. Verify Bots Are Running

```bash
# Check status
pm2 status

# View logs
pm2 logs

# View dev bot logs only
pm2 logs bot-dev

# View prod bot logs only
pm2 logs bot-prod

# Real-time monitoring
pm2 monit
```

✅ **Both bots should now be online in Discord!**

---

## Daily Workflow

### Deploying Changes to DEV (Testing)

**On your local machine:**

```bash
# Work on dev branch
git checkout dev

# Make changes, test locally
npm run .

# Commit and push
git add .
git commit -m "New feature"
git push origin dev
```

**On your server:**

```bash
cd ~/cr-clan-management

# Switch to dev branch
git checkout dev

# Pull latest changes
git pull origin dev

# Install new dependencies (if any)
npm install

# Restart dev bot
pm2 restart bot-dev

# Check logs
pm2 logs bot-dev --lines 50
```

✅ **Test your changes in Discord with your test server**

### Promoting DEV to PROD (When Stable)

**On your local machine:**

```bash
# Merge dev into main
git checkout main
git merge dev
git push origin main
```

**On your server:**

```bash
cd ~/cr-clan-management

# Switch to main branch
git checkout main

# Pull latest changes
git pull origin main

# Install new dependencies (if any)
npm install

# Restart prod bot
pm2 restart bot-prod

# Check logs
pm2 logs bot-prod --lines 50
```

✅ **Production bot updated!**

### Running New Migrations

```bash
# For dev database
npm run migrate:dev:up
pm2 restart bot-dev

# For prod database
npm run migrate:prod:up
pm2 restart bot-prod
```

---

## PM2 Commands

### Basic Commands

```bash
# View all running processes
pm2 status
pm2 list

# Start bots
pm2 start ecosystem.config.js              # Both
npm run pm2:start:dev                      # Dev only
npm run pm2:start:prod                     # Prod only

# Stop bots
pm2 stop bot-dev                           # Dev only
pm2 stop bot-prod                          # Prod only
pm2 stop all                               # Stop everything

# Restart bots
pm2 restart bot-dev                        # Dev only
pm2 restart bot-prod                       # Prod only
pm2 restart all                            # Restart everything

# Delete from PM2 (stops and removes)
pm2 delete bot-dev
pm2 delete bot-prod
pm2 delete all
```

### Logging

```bash
# View all logs (follow mode)
pm2 logs

# View specific bot logs
pm2 logs bot-dev
pm2 logs bot-prod

# View last 50 lines
pm2 logs bot-dev --lines 50

# Clear logs
pm2 flush

# View error logs only
pm2 logs bot-dev --err

# View output logs only
pm2 logs bot-dev --out
```

### Monitoring

```bash
# Real-time monitoring (CPU, memory)
pm2 monit

# Detailed info
pm2 show bot-dev
pm2 show bot-prod

# Process info
pm2 info bot-dev
```

### Advanced

```bash
# Save process list (for auto-restart on reboot)
pm2 save

# Resurrect saved processes after reboot
pm2 resurrect

# Update PM2
pm2 update

# Reset restart counter
pm2 reset bot-dev
```

---

## Troubleshooting

### Bot Not Starting

```bash
# Check PM2 status
pm2 status

# View detailed logs
pm2 logs bot-dev --lines 100

# Check if process crashed
pm2 show bot-dev

# Try restarting
pm2 restart bot-dev

# If still failing, delete and recreate
pm2 delete bot-dev
pm2 start ecosystem.config.js --only bot-dev
```

### Database Connection Issues

```bash
# Test PostgreSQL connection
psql -U botuser -d cr_bot_dev -c "SELECT 1;"

# Check PostgreSQL is running
sudo systemctl status postgresql

# Restart PostgreSQL if needed
sudo systemctl restart postgresql
```

### Permission Issues with Logs

```bash
# Ensure logs directory exists
mkdir -p ~/cr-clan-management/logs

# Fix permissions
chmod 755 ~/cr-clan-management/logs
```

### High Memory Usage

```bash
# Check memory usage
pm2 monit

# The ecosystem.config.js has max_memory_restart: '500M'
# Bot will auto-restart if it exceeds this

# To change the limit, edit ecosystem.config.js:
nano ecosystem.config.js
# Change max_memory_restart value, then restart:
pm2 restart ecosystem.config.js
```

### Bot Keeps Restarting (Crash Loop)

```bash
# View recent logs to find the error
pm2 logs bot-dev --err --lines 100

# Check environment variables
cat .env.dev

# Verify Discord token is correct
# Verify database credentials are correct

# Test bot locally first
npm run .
```

### PM2 Not Starting on Reboot

```bash
# Ensure PM2 startup is configured
pm2 startup

# Follow the command it outputs (copy and run it)

# Save current process list
pm2 save

# Test by rebooting
sudo reboot

# After reboot, check status
pm2 status
```

---

## Security Checklist

- [ ] `.env.dev` and `.env.prod` are NOT in git
- [ ] Strong passwords used for PostgreSQL
- [ ] PostgreSQL only accepts localhost connections (default)
- [ ] Discord bot tokens kept secret
- [ ] Server firewall enabled (ufw)
- [ ] SSH key authentication only
- [ ] Regular backups of databases
- [ ] PM2 logs rotated to prevent disk filling

---

## Database Backups

### Manual Backup

```bash
# Create backups directory
mkdir -p ~/backups

# Backup dev database
pg_dump -U botuser cr_bot_dev > ~/backups/cr_bot_dev_$(date +%Y%m%d).sql

# Backup prod database
pg_dump -U botuser cr_bot_prod > ~/backups/cr_bot_prod_$(date +%Y%m%d).sql
```

### Automated Daily Backup (Cron)

```bash
# Edit crontab
crontab -e

# Add this line (backup prod daily at 2 AM)
0 2 * * * pg_dump -U botuser cr_bot_prod > ~/backups/cr_bot_prod_$(date +\%Y\%m\%d).sql

# Add this for dev (optional)
0 3 * * * pg_dump -U botuser cr_bot_dev > ~/backups/cr_bot_dev_$(date +\%Y\%m\%d).sql
```

### Restore from Backup

```bash
# Restore dev database
psql -U botuser cr_bot_dev < ~/backups/cr_bot_dev_20260318.sql

# Restore prod database
psql -U botuser cr_bot_prod < ~/backups/cr_bot_prod_20260318.sql

# Restart bots after restore
pm2 restart all
```

---

## Quick Reference Card

```bash
# === Status ===
pm2 status                    # View all bots
pm2 logs                      # View logs (all)
pm2 logs bot-dev              # Dev logs only
pm2 logs bot-prod             # Prod logs only
pm2 monit                     # Real-time monitoring

# === Start/Stop ===
pm2 start ecosystem.config.js # Start both
pm2 stop bot-dev              # Stop dev
pm2 restart bot-prod          # Restart prod

# === Deploy Update (Dev) ===
git checkout dev
git pull
npm install
pm2 restart bot-dev
pm2 logs bot-dev --lines 20

# === Deploy Update (Prod) ===
git checkout main
git pull
npm install
pm2 restart bot-prod
pm2 logs bot-prod --lines 20

# === Migrations ===
npm run migrate:dev:up        # Run dev migrations
npm run migrate:prod:up       # Run prod migrations

# === Database ===
psql -U botuser -d cr_bot_dev         # Connect to dev DB
psql -U botuser -d cr_bot_prod        # Connect to prod DB
pg_dump -U botuser cr_bot_prod > backup.sql  # Backup

# === Other ===
pm2 save                      # Save process list
pm2 resurrect                 # Restore processes
pm2 flush                     # Clear all logs
```

---

## Migration from Docker

If you previously had Docker setup:

```bash
# Stop and remove Docker containers
docker-compose -f docker-compose.dev.yml down
docker-compose -f docker-compose.prod.yml down

# Remove Docker files (already removed if following this guide)
rm -f Dockerfile docker-compose*.yml .dockerignore

# Your data in PostgreSQL is safe!
# Just start PM2 as described above
```

---

## Support

- **Bot not starting?** Check `pm2 logs bot-dev` for errors
- **Database issues?** Verify `.env.dev` and `.env.prod` credentials
- **Can't connect to Discord?** Verify bot tokens are correct
- **Memory issues?** Check `pm2 monit` and adjust `max_memory_restart`
- **After server reboot?** Run `pm2 resurrect` or ensure `pm2 startup` is configured

✅ **PM2 makes deployment simple and reliable!**
