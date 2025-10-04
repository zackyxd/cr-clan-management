export function isPgUniqueViolation(err: unknown): err is { code: string; detail?: string } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof err === 'object' && err !== null && 'code' in err && (err as any).code === '23505';
}
