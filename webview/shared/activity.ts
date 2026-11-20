// Hybrid follow (src/live/userActivity.ts): tells the extension when the user works in this view, so
// it stops bringing agents' changes into view for a while. Only real input counts (a click, a key, the
// mouse wheel, a touch), not scrolling or selection done by the live view itself.

const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
/** At most one message per second; the pause is 30 seconds, so this is precise enough. */
const THROTTLE_MS = 1000;

export function reportUserActivity(post: () => void): () => void {
  let last = 0;
  const on = (e: Event) => {
    if (!e.isTrusted) return;
    const now = Date.now();
    if (now - last < THROTTLE_MS) return;
    last = now;
    post();
  };
  for (const type of EVENTS) window.addEventListener(type, on, { capture: true, passive: true });
  return () => {
    for (const type of EVENTS) window.removeEventListener(type, on, { capture: true });
  };
}
