// pg-format.d.ts
declare module 'pg-format' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function format(query: string, ...args: any[]): string;
  export default format;
}
