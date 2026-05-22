export function isHeadlessMode(env: NodeJS.ProcessEnv): boolean {
  return env.HEADLESS === '1'
}
