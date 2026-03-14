/**
 * Environment variable validation and utilities
 * Checks that all required environment variables are set before starting the application
 */

interface RequiredEnvVars {
  [key: string]: {
    description: string;
    required: boolean;
  };
}

const REQUIRED_ENV_VARS: RequiredEnvVars = {
  NODE_ENV: {
    description: 'Application environment (dev, test, prod)',
    required: true,
  },
  TOKEN: {
    description: 'Discord bot token',
    required: true,
  },
  CLIENT_ID: {
    description: 'Discord application client ID',
    required: true,
  },
  PGHOST: {
    description: 'PostgreSQL host',
    required: true,
  },
  PGPORT: {
    description: 'PostgreSQL port',
    required: true,
  },
  PGDATABASE: {
    description: 'PostgreSQL database name',
    required: true,
  },
  PGUSER: {
    description: 'PostgreSQL username',
    required: true,
  },
  PGPASSWORD: {
    description: 'PostgreSQL password',
    required: true,
  },
  REDIS_HOST: {
    description: 'Redis host',
    required: false, // Has default
  },
  REDIS_PORT: {
    description: 'Redis port',
    required: false, // Has default
  },
  CR_KEY: {
    description: 'Clash Royale API key',
    required: true,
  },
};

export function validateEnvironment(): void {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check each required variable
  for (const [key, config] of Object.entries(REQUIRED_ENV_VARS)) {
    const value = process.env[key];

    if (!value || value.trim() === '') {
      if (config.required) {
        missing.push(`${key} - ${config.description}`);
      } else {
        warnings.push(`${key} - ${config.description} (will use default)`);
      }
    }
  }

  // Log warnings for optional variables
  if (warnings.length > 0) {
    console.warn('⚠️  Optional environment variables not set:');
    warnings.forEach((warning) => console.warn(`   - ${warning}`));
    console.warn('');
  }

  // Error if required variables are missing
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach((msg) => console.error(`   - ${msg}`));
    console.error('');
    console.error('Please check your .env file or environment configuration.');
    console.error('See .env.example for reference.');
    process.exit(1);
  }

  // Validate NODE_ENV value
  const validEnvs = ['dev', 'test', 'prod', 'development', 'production'];
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv && !validEnvs.includes(nodeEnv)) {
    console.warn(`⚠️  NODE_ENV="${nodeEnv}" is not a standard value. Expected: ${validEnvs.join(', ')}`);
  }

  console.log('✅ Environment validation passed');
}

/**
 * Get environment with fallback
 */
export function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Environment variable ${key} is required but not set`);
  }
  return value;
}

/**
 * Check if running in production
 */
export function isProd(): boolean {
  return process.env.NODE_ENV === 'prod' || process.env.NODE_ENV === 'production';
}

/**
 * Check if running in development
 */
export function isDev(): boolean {
  return process.env.NODE_ENV === 'dev' || process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
}

/**
 * Check if running in test
 */
export function isTest(): boolean {
  return process.env.NODE_ENV === 'test';
}
