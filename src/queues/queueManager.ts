import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

// Shared Redis connection
export const redisConnection = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});

// Queue for invite-related background tasks (delayed expiration jobs)
export const inviteQueue = new Queue('inviteQueue', { connection: redisConnection });

// Add more queues here when you need them:
// export const apiQueue = new Queue('apiQueue', { connection: redisConnection });
// export const notificationQueue = new Queue('notificationQueue', { connection: redisConnection });

// Helper function to add jobs to the invite queue
export function scheduleInviteJob(name: string, data: Record<string, unknown>, options = {}) {
  return inviteQueue.add(name, data, options);
}
