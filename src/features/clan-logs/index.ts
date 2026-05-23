/**
 * Clan Activity Logs Feature
 *
 * Automatically detects and logs clan changes:
 * - Members joining/leaving
 * - Role changes (promotions/demotions)  - Clan property changes
 * - Optional Discord role management for linked members
 */

export { startClanActivityScheduler } from './scheduler.js';
export { checkClanActivity } from './service.js';
export { detectClanChanges } from './comparator.js';
export { formatClanChange } from './formatter.js';
export { handleRoleChanges } from './roleManager.js';
export * from './types.js';
