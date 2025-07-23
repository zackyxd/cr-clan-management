// jest.config.js
export default {
  preset: 'ts-jest/presets/default-esm',

  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1', // Fixes ESM path imports
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }],
  },
  setupFiles: ['<rootDir>/jest.env-setup.ts'],
  setupFilesAfterEnv: ['./jest.setup.ts'],
};