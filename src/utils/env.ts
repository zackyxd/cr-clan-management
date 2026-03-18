// Util to check which environment mode we're in to run certain code.
export const isDev = process.env.NODE_ENV === 'dev';
export const isProd = process.env.NODE_ENV === 'prod';
