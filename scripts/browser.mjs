/** Shared Playwright browser selection for application and foundation checks.
 * Use managed Chromium by default, or an explicitly selected local executable.
 * An invalid override fails launch; it never silently falls back to another browser.
 */
export function browserOptions(env = process.env) {
  return env.MANIFOLD_BROWSER_EXECUTABLE
    ? { executablePath: env.MANIFOLD_BROWSER_EXECUTABLE }
    : { channel: "chromium" };
}
