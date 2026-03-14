/**
 * Health check HTTP server
 * Provides a simple HTTP endpoint for Docker and monitoring systems to check if the bot is alive
 */

import http from 'node:http';
import { Client } from 'discord.js';
import logger from '../logger.js';
import { pool } from '../db.js';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  checks: {
    discord: {
      status: 'ok' | 'error';
      ready: boolean;
      guilds?: number;
    };
    database: {
      status: 'ok' | 'error';
      connected?: boolean;
    };
  };
  version?: string;
}

export class HealthCheckServer {
  private server: http.Server | null = null;
  private readonly port: number;
  private readonly client: Client;

  constructor(client: Client, port: number = 3000) {
    this.client = client;
    this.port = port;
  }

  /**
   * Start the health check server
   */
  start(): void {
    this.server = http.createServer(async (req, res) => {
      // Only respond to /health endpoint
      if (req.url !== '/health') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }

      // Handle health check
      const health = await this.checkHealth();
      const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;

      res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(health, null, 2));
    });

    this.server.listen(this.port, () => {
      logger.info(`🏥 Health check server listening on port ${this.port}`);
    });

    this.server.on('error', (error) => {
      logger.error('Health check server error:', error);
    });
  }

  /**
   * Stop the health check server
   */
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve, reject) => {
        this.server!.close((err) => {
          if (err) {
            logger.error('Error closing health check server:', err);
            reject(err);
          } else {
            logger.info('Health check server stopped');
            resolve();
          }
        });
      });
    }
  }

  /**
   * Perform health checks
   */
  private async checkHealth(): Promise<HealthStatus> {
    const health: HealthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        discord: {
          status: 'ok',
          ready: false,
        },
        database: {
          status: 'ok',
        },
      },
    };

    // Check Discord connection
    try {
      health.checks.discord.ready = this.client.isReady();
      health.checks.discord.guilds = this.client.guilds.cache.size;

      if (!this.client.isReady()) {
        health.checks.discord.status = 'error';
        health.status = 'degraded';
      }
    } catch (error) {
      logger.error('Discord health check failed:', error);
      health.checks.discord.status = 'error';
      health.status = 'unhealthy';
    }

    // Check database connection
    try {
      const dbClient = await pool.connect();
      await dbClient.query('SELECT 1');
      dbClient.release();
      health.checks.database.connected = true;
    } catch (error) {
      logger.error('Database health check failed:', error);
      health.checks.database.status = 'error';
      health.checks.database.connected = false;
      health.status = 'unhealthy';
    }

    return health;
  }
}
