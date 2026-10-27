import { useMemo, useState } from 'react';

// Store only a viewing preference, separately for each student and notebook.
export default function useStudentFeedbackPanel(owner, defaultOpen = false) {
  const key = owner ? `sseudam_feedback_panel_v1:${encodeURIComponent(JSON.stringify(owner))}` : '';
  const savedOpen = useMemo(() => {
    if (!key) return null;
    try {
      const saved = localStorage.getItem(key);
      return saved === 'open' ? true : saved === 'closed' ? false : null;
    } catch { return null; }
  }, [key]);
  const [choice, setChoice] = useState(null);
  const isOpen = choice?.key === key ? choice.open : savedOpen ?? defaultOpen;

  const setOpen = (open) => {
    const next = Boolean(open);
    setChoice({ key, open: next });
    if (key) {
      try { localStorage.setItem(key, next ? 'open' : 'closed'); }
      catch { /* Viewing controls remain usable when browser storage is unavailable. */ }
    }
  };
  return [isOpen, setOpen];
}
