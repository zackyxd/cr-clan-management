# First-Time Deployment Checklist

Use this checklist when setting up deployment for the first time.

## Prerequisites

- [ ] Two separate servers (or one server for testing both environments)
  - Test server for `dev` branch
  - Production server for `main` branch
- [ ] GitHub repository access
- [ ] Discord bot token and application credentials
- [ ] Clash Royale API key

## Server Setup (Do for BOTH test and production servers)

### 1. Server Access
- [ ] SSH access to server configured
- [ ] Root or sudo privileges available

### 2. Install Dependencies
- [ ] Docker and Docker Compose installed
- [ ] PostgreSQL installed and running
- [ ] Redis installed and running
- [ ] Git installed

### 3. Database Setup
- [ ] Database created (`discord_bot_prod` or `discord_bot_test`)
- [ ] Database user created with proper permissions
- [ ] Can connect to database from localhost

### 4. Application Directory
- [ ] Created `/opt/discord-bot` directory
- [ ] Proper ownership set for your user
- [ ] Repository cloned to this directory
- [ ] Deployment scripts are executable (`chmod +x deployment/*.sh`)

### 5. Environment Configuration
- [ ] Created `.env.prod` (or `.env.test`) in `/opt/discord-bot/`
- [ ] All required variables filled in (see `.env.example`)
- [ ] File permissions set to 600 (`chmod 600 .env.prod`)
- [ ] Environment variables validated

### 6. Initial Deployment Test
- [ ] Ran `./deployment/deploy.sh prod` (or `test`) successfully
- [ ] Container shows as running (`docker ps`)
- [ ] Health check responds (`curl http://localhost:3000/health`)
- [ ] Bot appears online in Discord
- [ ] Can execute a test command

## GitHub Configuration

### 1. Branches
- [ ] `dev` branch exists and is up to date
- [ ] `main` branch exists and is protected (optional but recommended)

### 2. SSH Keys for Deployment
- [ ] Generated SSH key pair for test server
- [ ] Added public key to test server (`~/.ssh/authorized_keys`)
- [ ] Generated SSH key pair for production server
- [ ] Added public key to production server (`~/.ssh/authorized_keys`)
- [ ] Tested SSH connection with these keys

### 3. GitHub Secrets
Go to: `https://github.com/YOUR_USERNAME/cr-clan-management/settings/secrets/actions`

- [ ] `TEST_SERVER_SSH_KEY` - Private SSH key for test server
- [ ] `TEST_SERVER_HOST` - Test server IP/hostname
- [ ] `TEST_SERVER_USER` - SSH username for test server
- [ ] `PROD_SERVER_SSH_KEY` - Private SSH key for production server
- [ ] `PROD_SERVER_HOST` - Production server IP/hostname
- [ ] `PROD_SERVER_USER` - SSH username for production server

### 4. GitHub Environments
Go to: `https://github.com/YOUR_USERNAME/cr-clan-management/settings/environments`

**Test Environment:**
- [ ] Created environment named `test`
- [ ] No protection rules configured (auto-deploy)

**Production Environment:**
- [ ] Created environment named `production`
- [ ] Required reviewers added (yourself)
- [ ] Deployment branch limited to `main` only

## Testing the Workflow

### 1. Test Environment Deployment
- [ ] Created a test branch from `dev`
- [ ] Made a small change (e.g., updated README)
- [ ] Committed and pushed to the test branch
- [ ] Merged the test branch into `dev`
- [ ] Pushed `dev` branch to GitHub
- [ ] GitHub Actions workflow triggered automatically
- [ ] Tests passed in CI
- [ ] Deployment to test server succeeded
- [ ] Verified bot is working on test server
- [ ] Checked health endpoint on test server

### 2. Production Environment Deployment
- [ ] Merged `dev` into `main`
- [ ] Pushed `main` to GitHub
- [ ] GitHub Actions workflow triggered
- [ ] Tests passed in CI
- [ ] Received notification for deployment approval
- [ ] Reviewed and approved deployment
- [ ] Deployment to production server succeeded
- [ ] Verified bot is working on production server
- [ ] Checked health endpoint on production server
- [ ] Git tag created automatically

### 3. Rollback Test (Optional but Recommended)
- [ ] SSH'd to test server
- [ ] Ran `./deployment/rollback.sh`
- [ ] Previous version restored successfully
- [ ] Bot still functioning correctly

## Documentation Review

- [ ] Read [DEPLOYMENT.md](DEPLOYMENT.md) completely
- [ ] Read [deployment/SERVER_SETUP.md](deployment/SERVER_SETUP.md)
- [ ] Bookmarked health check URLs
- [ ] Bookmarked GitHub Actions URL
- [ ] Saved SSH connection details securely

## Monitoring Setup (Optional)

- [ ] Set up uptime monitoring for health endpoint
- [ ] Configured Discord webhook for deployment notifications
- [ ] Set up log monitoring/aggregation
- [ ] Configured automated database backups
- [ ] Set up server monitoring (CPU, RAM, disk usage)

## Security Hardening (Recommended)

- [ ] Disabled SSH password authentication
- [ ] Configured firewall (ufw) to allow only necessary ports
- [ ] Changed default PostgreSQL port (optional)
- [ ] Set up fail2ban for SSH protection (optional)
- [ ] Configured automatic security updates
- [ ] Reviewed and secured `.env` file permissions

## Post-Setup

- [ ] Documented any custom configurations or deviations
- [ ] Shared access with team members (if applicable)
- [ ] Created runbook for common operations
- [ ] Scheduled regular maintenance windows
- [ ] Set calendar reminders for certificate renewals (if using HTTPS)

## Troubleshooting Checklist

If something doesn't work:

- [ ] Checked GitHub Actions logs for errors
- [ ] Checked Docker logs on server
- [ ] Verified environment variables are correct
- [ ] Tested database connectivity
- [ ] Tested Redis connectivity
- [ ] Checked health endpoint response
- [ ] Verified firewall/security group rules
- [ ] Checked disk space on server
- [ ] Reviewed [DEPLOYMENT.md](DEPLOYMENT.md) troubleshooting section

---

## Quick Reference Commands

```bash
# Check deployment status
docker ps | grep discord-bot

# View logs
docker logs -f discord-bot-prod

# Health check
curl http://localhost:3000/health

# Manual deployment
cd /opt/discord-bot && ./deployment/deploy.sh prod

# Rollback
cd /opt/discord-bot && ./deployment/rollback.sh

# Database backup
sudo -u postgres pg_dump discord_bot_prod > backup_$(date +%Y%m%d).sql
```

## Need Help?

1. Review the documentation in `DEPLOYMENT.md`
2. Check the GitHub Actions logs
3. Check server logs with `docker logs`
4. Verify all environment variables
5. Test each component individually (database, Redis, Discord API)

---

**Once everything is checked off, your deployment pipeline is ready! 🚀**
