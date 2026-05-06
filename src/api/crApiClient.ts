import axios from 'axios';
import Bottleneck from 'bottleneck';
import axiosRetry from 'axios-retry';
import 'dotenv-flow/config';
import { logApiResponse } from './dev-logger.js';
import { loadMockData, isMockingEnabled } from './mock-loader.js';

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
    const status = error?.response?.status ?? error?.code ?? 'unknown';
    console.warn(`Retrying [${retryCount}] after ${delay}ms (status: ${status})`);
    return delay;
  },
  retryCondition: (error) => {
    // Retry on 5xx, 429, timeouts, and network errors
    const status = error.response?.status ?? 0;
    const isTimeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
    const isNetworkError = !error.response && error.code !== 'ERR_BAD_REQUEST';
    return status === 429 || status >= 500 || isTimeout || isNetworkError;
  },
});

// --- Wrap axios calls with Bottleneck ---
// typed wrapper returns only .data
async function getWithLimit<T = unknown>(url: string, endpoint?: string, identifier?: string): Promise<T> {
  // Check for mock data first
  if (isMockingEnabled() && endpoint && identifier) {
    const mockData = await loadMockData<T>(endpoint, identifier);
    if (mockData) return mockData;
  }

  // Make real API call
  const res = await crAxios.get<T>(url);
  const data = res.data;

  // Log response in dev mode
  if (endpoint && identifier) {
    await logApiResponse(endpoint, identifier, data);
  }

  return data;
}

// Bottleneck wrap
export const limitedGet = limiter.wrap(getWithLimit) as <T>(
  url: string,
  endpoint?: string,
  identifier?: string,
) => Promise<T>;
