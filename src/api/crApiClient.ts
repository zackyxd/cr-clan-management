import axios from 'axios';
import Bottleneck from 'bottleneck';
import axiosRetry from 'axios-retry';
import 'dotenv-flow/config';
console.log(process.env.CR_KEY);
// --- Bottleneck rate limiter ---
// Example: 10 requests per second (Clash Royale API is 10/s per token)
const limiter = new Bottleneck({
  reservoir: 70,
  reservoirRefreshAmount: 70,
  reservoirRefreshInterval: 1000,
  maxConcurrent: 5,
});

// --- Create axios instance ---
const crAxios = axios.create({
  baseURL: 'https://proxy.royaleapi.dev/v1/',
  headers: {
    Authorization: `Bearer ${process.env.CR_KEY}`,
  },
  timeout: 8000,
});

// --- Attach axios-retry ---
axiosRetry(crAxios, {
  retries: 3,
  retryDelay: (retryCount, error) => {
    // exponential backoff for 503 or 429
    const base = 500;
    const delay = base * Math.pow(2, retryCount);
    console.warn(`Retrying [${retryCount}] after ${delay}ms (${error?.response?.status ?? 'no status'})`);
    return delay;
  },
  retryCondition: (error) => {
    // Retry on 5xx and 429
    const status = error.response?.status ?? 0;
    return status === 429 || status >= 500;
  },
});

// --- Wrap axios calls with Bottleneck ---
// typed wrapper returns only .data
async function getWithLimit<T = unknown>(url: string): Promise<T> {
  const res = await crAxios.get<T>(url);
  return res.data; // only the payload
}

// Bottleneck wrap
export const limitedGet = limiter.wrap(getWithLimit) as <T>(url: string) => Promise<T>;
