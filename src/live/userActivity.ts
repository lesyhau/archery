// Hybrid follow for the live view (src/live/liveView.ts): Archery follows what agents change, unless
// the user is working in Archery's views themselves. Any action of theirs there (a click, a key, the
// mouse wheel, a click in the Contents or Diagrams view) pauses following for 30 seconds, and every
// further action starts the 30 seconds again. When they run out, following resumes with the agent's
// next change.

export const FOLLOW_PAUSE_MS = 30_000;

let timer: ReturnType<typeof setTimeout> | undefined;

/** The user did something in an Archery view: pause following (again) for 30 seconds. */
export function noteUserActivity(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => (timer = undefined), FOLLOW_PAUSE_MS);
}

export function followPaused(): boolean {
  return timer !== undefined;
}

export function resetUserActivity(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
}
