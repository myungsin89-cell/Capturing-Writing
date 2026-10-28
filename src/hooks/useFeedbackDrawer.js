import { useEffect, useState } from 'react';

export default function useFeedbackDrawer(open, onClose) {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const change = () => setWide(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!open) return;
    const panel = document.getElementById('student-feedback-panel');
    if (!panel) return;
    const previousOverflow = document.body.style.overflow;
    if (!wide) document.body.style.overflow = 'hidden';
    const controls = () => [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href]')]
      .filter((element) => element.getClientRects().length > 0);
    controls()[0]?.focus({ preventScroll: true });
    const keydown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (wide || event.key !== 'Tab') return;
      const items = controls();
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    panel.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = previousOverflow; panel.removeEventListener('keydown', keydown); };
  }, [open, wide]);
  return wide;
}
