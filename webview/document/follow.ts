// Live view in the document: an agent is about to change a chapter, a diagram or a table (the
// extension says so with a `follow` message); the page brings it into view and highlights the change.

/** The chapter whose next outside change is an agent's edit: its changed block gets highlighted. */
export const pendingEdit = { sectionId: '', until: 0 };

export function expectEdit(sectionId: string): void {
  pendingEdit.sectionId = sectionId;
  pendingEdit.until = Date.now() + 6000;
}

/** Whether an outside change of this chapter is the agent's edit announced before (once). */
export function takeEdit(sectionId: string): boolean {
  if (pendingEdit.sectionId !== sectionId || Date.now() > pendingEdit.until) return false;
  pendingEdit.until = 0;
  return true;
}

/** Scrolls an element to the middle of the view and highlights it briefly. */
export function showChange(el: Element | null | undefined, scroll = true): void {
  if (!(el instanceof HTMLElement)) return;
  if (scroll) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('live-change');
  void el.offsetWidth;
  el.classList.add('live-change');
  window.setTimeout(() => el.classList.remove('live-change'), 2200);
}

/** The figure of a diagram or the table of a data file in the page. */
export function itemFor(src: string): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>('[data-src]')];
  return all.find((e) => e.dataset.src === src) ?? all.find((e) => e.dataset.src?.split('#')[0] === src) ?? null;
}
