// Deployment configuration. AAG_LAB_MODE is the DEFAULT mode a new workspace opens in (mock or live). Mock is the default. Anything else is an error,
// never a silent fallback. The app's own .env (settings.js) may carry AAG_LAB_MODE. A bare MODE is NOT read:
// Docker passes the whole .env into the container (env_file), and a generic MODE must not switch this lab.
// AAG_DEPLOY_MODE says where the lab runs: local (the default: a clone or local Docker) or hosted (the mock-only SE k8s build of the same image,
// rulebook section 6). Hosted is mock only: live, the llama.cpp brain and the app's .env are refused or ignored. It is set in the pod
// manifest, never read from the app's .env.
export const MODES = ['mock', 'live'];
export const DEPLOY_MODES = ['local', 'hosted'];
export function deployModeFrom(env = process.env) {
  const raw = env.AAG_DEPLOY_MODE;
  const m = raw === undefined || raw === '' ? 'local' : raw;
  if (!DEPLOY_MODES.includes(m)) throw new Error(`AAG_DEPLOY_MODE=${String(m).slice(0, 20)} is not available: use local or hosted`);
  return m;
}
export const isHosted = (env = process.env) => env.AAG_DEPLOY_MODE === 'hosted';
export function modeFrom(env = process.env) {
  const raw = env.AAG_LAB_MODE;
  const m = raw === undefined || raw === '' ? 'mock' : raw;
  if (!MODES.includes(m)) throw new Error(`AAG_LAB_MODE=${String(m).slice(0, 20)} is not available: use mock or live`);
  if (m !== 'mock' && deployModeFrom(env) === 'hosted') throw new Error('the hosted build is mock only: AAG_LAB_MODE must be mock');
  return m;
}
export const defaultMode = () => modeFrom(process.env);
export const modeOf = (v) => (typeof v === 'string' && MODES.includes(v) ? v : null);
