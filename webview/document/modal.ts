// While a modal (a dialog or the maximized diagram) is open, the page behind it does not scroll: the
// wheel scrolls the modal (see .modal-open in document.css).
import { useEffect } from 'react';

let open = 0;

export function useModalScrollLock(): void {
  useEffect(() => {
    open++;
    document.documentElement.classList.add('modal-open');
    return () => {
      open = Math.max(0, open - 1);
      if (open === 0) document.documentElement.classList.remove('modal-open');
    };
  }, []);
}
