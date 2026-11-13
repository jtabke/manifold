/** Shared development port configuration consumed by Vite's TypeScript config. */
export function config(env?: Record<string, string | undefined>): {
  apiPort: number;
  devPort: number;
  python: string;
};
