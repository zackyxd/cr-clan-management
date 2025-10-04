// Real duration (3 days)
// export const INVITE_EXPIRY_MS = 1000 * 60 * 60 * 24 * 3; // 3 days
// export const INVITE_EXPIRY_INTERVAL_SQL = `interval '3 days'`;

import { Job } from 'bullmq';

// For testing, flip these values
export const INVITE_EXPIRY_MS = 1000 * 15; // 15s
export const INVITE_EXPIRY_INTERVAL_SQL = `interval '15 seconds'`;

export async function safeRemoveJob(job: Job | null): Promise<boolean> {
  if (!job) return false;
  try {
    await job.remove();
    return true; // ✅ successfully removed
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('locked by another worker')) {
      // This means the job is already being processed — can't remove
      console.warn(`Job ${job.id} locked, skipping removal`);
      return false;
    }

    console.error(`Failed to remove job ${job.id}:`, err);
    return false;
  }
}
