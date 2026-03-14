# CR Clan Management Discord Bot

This project is a Discord bot that helps Clash Royale clan leaders manage their clans and members.

## Features

- Clan management and tracking
- Member verification and linking
- Automated clan invites
- Member channels with role synchronization
- Server settings and customization
- Ticket system for support

## 🚀 Quick Start

**Never used Docker before?** Start here:
- **[QUICK_START.md](QUICK_START.md)** - Step-by-step guide to get running (30 minutes)
- **[GETTING_STARTED.md](GETTING_STARTED.md)** - Detailed beginner-friendly guide with explanations

**Already know Docker?** See:
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Complete deployment documentation
- **[deployment/SERVER_SETUP.md](deployment/SERVER_SETUP.md)** - Server configuration details

## Development

### Local Setup

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env.dev

# Edit with your credentials
nano .env.dev

# Run database migrations
npm run migrate:dev:up

# Start the bot
npm run .
```

### With Docker (Recommended)

```bash
# Start everything (bot + PostgreSQL + Redis)
docker-compose up

# Health check
curl http://localhost:3000/health
```

### Testing

```bash
npm test
```

## Deployment

This project uses Docker and GitHub Actions for automated deployment:

- `dev` branch → Test server (automatic)
- `main` branch → Production servers (manual approval)

See [DEPLOYMENT.md](DEPLOYMENT.md) for complete setup instructions.

## Project Structure

```
src/
├── commands/          # Discord slash commands
├── events/            # Discord event handlers
├── features/          # Feature modules (clan-invites, member-channels, etc.)
├── services/          # Business logic services
├── utils/             # Utility functions
└── bot.ts            # Main entry point

migrations/            # Database migrations
deployment/           # Deployment scripts and documentation
```

## Tech Stack

- **Runtime**: Node.js 20 + TypeScript
- **Discord**: discord.js v14
- **Database**: PostgreSQL 16
- **Cache**: Redis 7
- **Container**: Docker
- **CI/CD**: GitHub Actions

## Contributing

1. Create a feature branch from `dev`
2. Make your changes
3. Test locally
4. Push to `dev` for testing
5. After testing, merge to `main` for production

## License

ISC
