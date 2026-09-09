/**
 * Device detection: is this a touch screen, and is it a phone-sized one?
 *
 * Both take an `env` so node can test them; the browser callers pass nothing
 * and get `window`. `?mobile` / `?desktop` on the URL override everything,
 * which is how the touch layout is checked on a laptop with DevTools' device
 * emulation off, and how a tablet with a keyboard gets the desktop game back.
 */

function defaultEnv() {
  if (typeof window === 'undefined') return {};
  return {
    search: location.search,
    maxTouchPoints: navigator.maxTouchPoints,
    coarse: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    userAgent: navigator.userAgent || '',
    innerWidth, innerHeight,
  };
}

function flag(env, name) {
  try { return new URLSearchParams(env.search || '').has(name); } catch { return false; }
}

/** A screen you poke: any touch point, or a coarse primary pointer. */
export function isTouchDevice(env = defaultEnv()) {
  if (flag(env, 'desktop')) return false;
  if (flag(env, 'mobile')) return true;
  return (env.maxTouchPoints || 0) > 0 || !!env.coarse;
}

const PHONE_UA = /Android|iPhone|iPad|iPod|Mobile|Silk|Tablet/i;

/** Touch AND small (shorter side under 900 css px) or a phone user agent. */
export function isMobile(env = defaultEnv()) {
  if (flag(env, 'desktop')) return false;
  if (flag(env, 'mobile')) return true;
  if (!isTouchDevice(env)) return false;
  const short = Math.min(env.innerWidth || 0, env.innerHeight || 0);
  return (short > 0 && short < 900) || PHONE_UA.test(env.userAgent || '');
}
