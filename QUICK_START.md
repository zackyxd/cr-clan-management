# Quick Start: Do This Right Now

This is the absolute minimum to get started. Follow these steps in order.

## Step 1: Test Locally (5 minutes)

You already have the code. Let's make sure it works with Docker on your computer.

```bash
# Make sure you're in the project directory
cd ~/cr-management-discord-bot

# Copy the example environment file
cp .env.example .env.dev

# Edit it with your Discord credentials
nano .env.dev
```

**In `.env.dev`, add:**
- Your Discord `TOKEN`
- Your Discord `CLIENT_ID`
- Your `CR_KEY`
- Leave the database settings as-is (Docker will handle them)

**Save and exit** (Ctrl+X, Y, Enter)

**Start everything:**
```bash
docker-compose up
```

**You should see:** Your bot log in and connect to Discord!

**Test the health check** (open new terminal):
```bash
curl http://localhost:3000/health
```

**Stop it:** Press Ctrl+C

**If you saw "Ready! Logged in as..." - SUCCESS! Continue to Step 2.**

---

## Step 2: Push to GitHub (2 minutes)

```bash
# Add all the deployment files
git add -A

# Commit
git commit -m "Add Docker deployment setup"

# Push
git push origin main

# Create dev branch
git checkout -b dev
git push -u origin dev

# Go back to main
git checkout main
```

---

## Step 3: Set Up GitHub Environments (3 minutes)

**Go to:** https://github.com/zackyxd/cr-clan-management/settings/environments

**Create "test" environment:**
1. Click "New environment"
2. Name: `test`
3. Just click "Configure environment" → No changes needed

**Create "production" environment:**
1. Click "New environment"
2. Name: `production`
3. Check "Required reviewers" → Add yourself
4. Save

---

## Step 4: Generate SSH Keys (1 minute)

```bash
mkdir -p ~/.ssh/deployment-keys

# Generate keys
ssh-keygen -t ed25519 -f ~/.ssh/deployment-keys/github_actions_test -N ""
ssh-keygen -t ed25519 -f ~/.ssh/deployment-keys/github_actions_prod -N ""

# Display keys (you'll need these)
echo "=== SAVE THESE SOMEWHERE ===" > ~/deployment-keys.txt
echo "" >> ~/deployment-keys.txt
echo "TEST PRIVATE KEY:" >> ~/deployment-keys.txt
cat ~/.ssh/deployment-keys/github_actions_test >> ~/deployment-keys.txt
echo "" >> ~/deployment-keys.txt
echo "TEST PUBLIC KEY:" >> ~/deployment-keys.txt
cat ~/.ssh/deployment-keys/github_actions_test.pub >> ~/deployment-keys.txt
echo "" >> ~/deployment-keys.txt
echo "PROD PRIVATE KEY:" >> ~/deployment-keys.txt
cat ~/.ssh/deployment-keys/github_actions_prod >> ~/deployment-keys.txt
echo "" >> ~/deployment-keys.txt
echo "PROD PUBLIC KEY:" >> ~/deployment-keys.txt
cat ~/.ssh/deployment-keys/github_actions_prod.pub >> ~/deployment-keys.txt

cat ~/deployment-keys.txt
```

**Save the output!** You'll need it for your servers and GitHub.

---

## Step 5: Decide on Servers

**Option A: Use one Hetzner server for now (easiest)**
- Test and prod can run on same server with different containers
- Cheapest option to start

**Option B: Use two Hetzner servers (recommended for real production)**
- One for testing (dev branch)
- One for production (main branch)
- More realistic setup

**Don't have servers yet?** You can stop here and continue when you do. Everything will be ready.

**Have servers?** Continue to Step 6.

---

## Step 6: Set Up Server (Per Server)

**SSH to your server:**
```bash
ssh root@YOUR_SERVER_IP
```

**Run this one big command to install everything:**
```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Install PostgreSQL
apt-get update && apt-get install -y postgresql postgresql-contrib redis-server git curl

# Start services
systemctl start postgresql redis-server docker
systemctl enable postgresql redis-server docker

# Create database
DB_NAME="discord_bot_prod"  # Use discord_bot_test for test server
DB_USER="discord_bot"
DB_PASS="$(openssl rand -base64 32)"  # Random password

sudo -u postgres psql -c "CREATE DATABASE $DB_NAME;"
sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"

echo "Database password: $DB_PASS"
echo "SAVE THIS PASSWORD!"

# Create app directory
mkdir -p /opt/discord-bot
cd /opt/discord-bot

# Show instructions
echo ""
echo "✅ Server ready! Next steps:"
echo "1. Add SSH public key to ~/.ssh/authorized_keys"
echo "2. Clone repository: git clone https://github.com/zackyxd/cr-clan-management.git ."
echo "3. Create .env.prod file with credentials"
```

---

## Step 7: Configure Server Environment

**Still on the server:**

**Add SSH key for GitHub Actions:**
```bash
mkdir -p ~/.ssh
nano ~/.ssh/authorized_keys
```
Paste the **PUBLIC** key (from Step 4, use `github_actions_test.pub` for test server or `github_actions_prod.pub` for prod)

Save (Ctrl+X, Y, Enter)

**Clone the repository:**
```bash
cd /opt/discord-bot
git clone https://github.com/zackyxd/cr-clan-management.git .
chmod +x deployment/*.sh
```

**Create environment file:**
```bash
nano .env.prod  # or .env.test for test server
```

**Paste this and fill in YOUR values:**
```env
NODE_ENV=prod

TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_client_id
CR_KEY=your_cr_api_key

PGHOST=localhost
PGPORT=5432
PGDATABASE=discord_bot_prod
PGUSER=discord_bot
PGPASSWORD=the_password_from_step_6

REDIS_HOST=localhost
REDIS_PORT=6379

LOG_LEVEL=info
```

Save and secure it:
```bash
chmod 600 .env.prod
```

**Test deployment manually:**
```bash
./deployment/deploy.sh prod  # or 'test' for test server
```

**Check if it's running:**
```bash
docker ps
curl http://localhost:3000/health
docker logs discord-bot-prod --tail 50
```

**If you see the bot online in Discord - SUCCESS!**

---

## Step 8: Add GitHub Secrets

**Go to:** https://github.com/zackyxd/cr-clan-management/settings/secrets/actions

**Click "New repository secret" for each:**

| Name | Value |
|------|-------|
| `TEST_SERVER_SSH_KEY` | Private key from `github_actions_test` (no .pub) |
| `TEST_SERVER_HOST` | Test server IP (e.g., `123.45.67.89`) |
| `TEST_SERVER_USER` | `root` |
| `PROD_SERVER_SSH_KEY` | Private key from `github_actions_prod` (no .pub) |
| `PROD_SERVER_HOST` | Prod server IP (e.g., `98.76.54.32`) |
| `PROD_SERVER_USER` | `root` |

---

## Step 9: Test Automatic Deployment

**Test the dev→test server deployment:**
```bash
cd ~/cr-management-discord-bot
git checkout dev
echo "# Test" >> README.md
git add README.md
git commit -m "Test auto-deploy"
git push origin dev
```

**Watch it happen:**
1. Go to https://github.com/zackyxd/cr-clan-management/actions
2. See "Deploy to Test Server" workflow running
3. It should complete successfully
4. Your test server bot should restart with latest code!

**Test the main→prod server deployment:**
```bash
git checkout main
git merge dev
git push origin main
```

1. Go to Actions tab
2. See "Deploy to Production" workflow
3. It waits for approval
4. Click "Review deployments" → Approve
5. It deploys!

---

## ✅ Done!

**Your workflow is now:**
```
Make changes → git push origin dev → Auto-deploys to test
                          ↓
                 Test it works
                          ↓
              git push origin main → Approve on GitHub → Deploys to prod
```

No more manual uploads! 🎉

---

## If Something Doesn't Work

**Docker fails locally:**
- Make sure Docker Desktop is running (Windows/Mac)
- Run `docker --version` to verify installation

**Can't SSH to server:**
- Check if you added the public key to server's `~/.ssh/authorized_keys`
- Test manually: `ssh -i ~/.ssh/deployment-keys/github_actions_test root@SERVER_IP`

**GitHub Actions fails:**
- Check the error in Actions tab
- Usually it's wrong SSH key or wrong server IP
- Verify secrets are set correctly

**Bot doesn't start on server:**
- Check logs: `docker logs discord-bot-prod`
- Verify `.env.prod` has correct values
- Test database: `psql -h localhost -U discord_bot -d discord_bot_prod`

**Need more help?** See [GETTING_STARTED.md](GETTING_STARTED.md) for detailed explanations.
