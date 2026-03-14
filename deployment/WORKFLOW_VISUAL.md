# Deployment Workflow Visual Guide

## Simple Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  YOU (Developer)                                                │
│  ├── Write code locally                                         │
│  ├── Test with: npm run . OR docker-compose up                  │
│  └── Commit and push to GitHub                                  │
└───────────────────┬─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  GITHUB                                                         │
│  ├── dev branch pushed                                          │
│  │   ├── Runs tests automatically                               │
│  │   ├── Builds Docker image                                    │
│  │   └── Deploys to TEST SERVER (no approval needed)           │
│  │                                                              │
│  └── main branch pushed                                         │
│      ├── Runs tests automatically                               │
│      ├── WAITS FOR YOUR APPROVAL ⏸️                            │
│      ├── You click "Approve" on GitHub                          │
│      └── Deploys to PRODUCTION SERVER                           │
└─────────────────────────────────────────────────────────────────┘
```

## Detailed Flow

### For Testing New Features

```
┌──────────────┐
│ Local Dev    │
│              │
│ 1. Code      │
│ 2. Test      │
│ 3. Commit    │
└──────┬───────┘
       │ git push origin dev
       ▼
┌──────────────┐
│ GitHub       │
│ Actions      │
│              │
│ • Run tests  │
│ • Lint code  │
│ • Build      │
└──────┬───────┘
       │ If tests pass ✅
       ▼
┌──────────────┐
│ Test Server  │
│ Hetzner VPS  │
│              │
│ Bot updates  │
│ automatically│
└──────────────┘
       │
       │ Test it with
       │ real Discord
       ▼
┌──────────────┐
│ Is it good?  │
│              │
│ YES → merge  │
│       to main│
│              │
│ NO  → fix &  │
│       push dev│
└──────────────┘
```

### For Production Deployment

```
┌──────────────┐
│ dev branch   │
│ tested ✅    │
└──────┬───────┘
       │ git checkout main
       │ git merge dev
       │ git push origin main
       ▼
┌──────────────┐
│ GitHub       │
│ Actions      │
│              │
│ • Run tests  │
│ • Build      │
└──────┬───────┘
       │ If tests pass ✅
       ▼
┌──────────────┐
│   ⏸️ PAUSE   │
│              │
│ Needs YOUR   │
│ approval     │
└──────┬───────┘
       │
       │ You go to GitHub →
       │ Actions → Click
       │ "Review deployments"
       │ → Approve
       ▼
┌──────────────┐
│ Production   │
│ Server       │
│ Hetzner VPS  │
│              │
│ Bot updates! │
│ All your     │
│ real servers │
└──────────────┘
```

## What Happens Behind the Scenes

### When You Push to `dev`

1. **GitHub detects the push**
2. **Workflow starts**: `.github/workflows/deploy-test.yml`
3. **CI Server spins up** (GitHub's computer)
   - Installs Node.js
   - Installs PostgreSQL (temporary, for testing)
   - Installs Redis (temporary, for testing)
4. **Runs your tests**
   - `npm install`
   - `npm run build`
   - `npm test`
5. **If tests pass:**
   - SSH to your test server
   - Run `/opt/discord-bot/deployment/deploy.sh test`
6. **Deployment script on server:**
   - Pull latest code from GitHub
   - Build Docker image
   - Stop old container
   - Run database migrations
   - Start new container
   - Check health endpoint
   - If health check fails → rollback automatically
7. **Done!** Your test bot is updated

### When You Push to `main`

Same as above, BUT:
- Uses `.github/workflows/deploy-prod.yml`
- **STOPS and waits** after tests pass
- You get a notification: "Deployment waiting for approval"
- You must go to GitHub and click "Approve"
- Only then does it deploy to production

## File Organization

```
Your Repository
├── .github/
│   └── workflows/
│       ├── deploy-test.yml      ← Defines test deployment
│       └── deploy-prod.yml      ← Defines prod deployment
│
├── deployment/
│   ├── deploy.sh                ← Runs on server to deploy
│   ├── rollback.sh              ← Runs on server to rollback
│   └── SERVER_SETUP.md          ← How to set up server
│
├── Dockerfile                   ← How to build bot container
├── docker-compose.yml           ← Local development setup
├── docker-compose.prod.yml      ← Production container setup
│
└── Your actual bot code...
```

## Docker Basics (Simple Explanation)

### What is Docker?

Think of Docker like a shipping container for your app:

```
┌─────────────────────────────────┐
│  DOCKER CONTAINER               │
│  ┌───────────────────────────┐  │
│  │ Your Bot Code             │  │
│  ├───────────────────────────┤  │
│  │ Node.js                   │  │
│  ├───────────────────────────┤  │
│  │ All Dependencies          │  │
│  │ (discord.js, pg, etc.)    │  │
│  └───────────────────────────┘  │
│                                 │
│  Everything packaged together   │
└─────────────────────────────────┘
        │
        ├── Works on your laptop
        ├── Works on test server
        └── Works on production server
           (exactly the same way!)
```

### Without Docker (Old Way):

```
Your Laptop:        Test Server:       Prod Server:
Node v20.0         Node v18.5         Node v19.2
npm packages       Different npm      Different npm
Works! ✅          Breaks! ❌         Works weird ⚠️

"But it works on my machine!"
```

### With Docker (New Way):

```
Your Laptop:        Test Server:       Prod Server:
Docker Container   Docker Container   Docker Container
All identical!     All identical!     All identical!
Works! ✅          Works! ✅          Works! ✅

"It works everywhere!"
```

## Common Commands You'll Use

### Local Development

```bash
# Start everything locally
docker-compose up

# Stop everything
Ctrl+C then: docker-compose down

# View logs
docker logs -f discord-bot-dev

# Check if it's running
docker ps
```

### On Your Server (SSH'd in)

```bash
# Check bot status
docker ps
curl http://localhost:3000/health

# View logs
docker logs -f discord-bot-prod

# Restart bot
docker restart discord-bot-prod

# Deploy manually
cd /opt/discord-bot
./deployment/deploy.sh prod

# Rollback if needed
./deployment/rollback.sh
```

### Git Workflow

```bash
# Daily development
git checkout dev
# ... make changes ...
git add .
git commit -m "Add new feature"
git push origin dev
# → Auto-deploys to test

# When ready for production
git checkout main
git merge dev
git push origin main
# → Go to GitHub Actions → Approve → Deploys to prod
```

## The Magic Moment

Once everything is set up:

```
┌────────────────────────────────────────┐
│  OLD WAY (manual)                      │
│                                        │
│  1. Edit code                          │
│  2. Test locally                       │
│  3. Open WinSCP                        │
│  4. Upload files one by one           │
│  5. SSH to server with Bitvise        │
│  6. Restart the bot manually          │
│  7. Check logs                        │
│  8. Hope nothing broke                │
│                                        │
│  Time: 10-15 minutes                  │
│  Error-prone: High                    │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│  NEW WAY (automated)                   │
│                                        │
│  1. Edit code                          │
│  2. Test locally                       │
│  3. git push origin dev                │
│  4. ☕ Wait 2 minutes                  │
│  5. Test server updated!              │
│  6. git push origin main               │
│  7. Click "Approve" on GitHub         │
│  8. ☕ Wait 2 minutes                  │
│  9. Production updated!               │
│                                        │
│  Time: 5 minutes (mostly automated)   │
│  Error-prone: Low (auto-rollback)     │
└────────────────────────────────────────┘
```

## Troubleshooting Flowchart

```
Something doesn't work?
    │
    ├── Local dev (docker-compose up)
    │   ├── Docker not running? → Start Docker Desktop
    │   ├── Port already used? → Change port or kill process
    │   └── Wrong .env values? → Check .env.dev
    │
    ├── GitHub Actions failing?
    │   ├── Tests failing? → Fix tests locally first
    │   ├── Can't SSH to server? → Check SSH keys
    │   └── Wrong secrets? → Verify in GitHub Settings
    │
    └── Server deployment failing?
        ├── Can't connect to DB? → Check .env.prod
        ├── Container won't start? → Check 'docker logs'
        └── Health check fails? → Check DB and Redis running
```

## Visual: Complete Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         GITHUB                                  │
│                                                                 │
│  Repository: zackyxd/cr-clan-management                        │
│  ├── main branch ──────────────────────────────┐               │
│  │   └── Triggers: .github/workflows/          │               │
│  │       deploy-prod.yml                       │               │
│  │                                             │               │
│  └── dev branch ────────────────┐              │               │
│      └── Triggers: .github/     │              │               │
│          workflows/              │              │               │
│          deploy-test.yml         │              │               │
└────────────────────────────────┬┴──────────────┴───────────────┘
                                 │                │
                        SSH via Actions      SSH via Actions
                                 │                │
         ┌───────────────────────┘                └────────────────┐
         ▼                                                          ▼
┌────────────────────┐                                  ┌────────────────────┐
│  TEST SERVER       │                                  │  PROD SERVER       │
│  (Hetzner VPS)     │                                  │  (Hetzner VPS)     │
│                    │                                  │                    │
│  ┌──────────────┐  │                                  │  ┌──────────────┐  │
│  │ PostgreSQL   │  │                                  │  │ PostgreSQL   │  │
│  │ (localhost)  │  │                                  │  │ (localhost)  │  │
│  └──────────────┘  │                                  │  └──────────────┘  │
│         ▲          │                                  │         ▲          │
│  ┌──────────────┐  │                                  │  ┌──────────────┐  │
│  │ Redis        │  │                                  │  │ Redis        │  │
│  │ (localhost)  │  │                                  │  │ (localhost)  │  │
│  └──────────────┘  │                                  │  └──────────────┘  │
│         ▲          │                                  │         ▲          │
│  ┌──────────────┐  │                                  │  ┌──────────────┐  │
│  │ Docker       │  │                                  │  │ Docker       │  │
│  │  Container   │  │                                  │  │  Container   │  │
│  │ ┌──────────┐ │  │                                  │  │ ┌──────────┐ │  │
│  │ │   Bot    │ │  │                                  │  │ │   Bot    │ │  │
│  │ │ (Node.js)│ │  │                                  │  │ │ (Node.js)│ │  │
│  │ └──────────┘ │  │                                  │  │ └──────────┘ │  │
│  └──────────────┘  │                                  │  └──────────────┘  │
│    Port 3000       │                                  │    Port 3000       │
│    /health         │                                  │    /health         │
└────────────────────┘                                  └────────────────────┘
         │                                                         │
         │ Connects to                                           │ Connects to
         ▼                                                         ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                            DISCORD API                                     │
│                                                                            │
│  Test Bot (test token)              Production Bot (prod token)           │
│  ├── Test Discord Server            ├── All your real Discord servers     │
│  └── For testing features           └── Live bot serving users            │
└────────────────────────────────────────────────────────────────────────────┘
```

## Summary

**You push code → GitHub tests it → GitHub deploys it → Server runs it → Users see it**

All automatic, all professional! 🚀
