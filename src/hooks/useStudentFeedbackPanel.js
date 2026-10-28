import { useMemo, useState } from 'react';

// Store only a viewing preference, separately for each student and notebook.
export default function useStudentFeedbackPanel(owner, defaultOpen = false, feedbackVersion = '') {
  const key = owner ? `sseudam_feedback_panel_v1:${encodeURIComponent(JSON.stringify(owner))}` : '';
  const savedOpen = useMemo(() => {
    if (!key) return null;
    try {
      const saved = localStorage.getItem(key);
      if (saved === 'open' || saved === 'closed') return defaultOpen ? true : saved === 'open';
      const preference = JSON.parse(saved || 'null');
      return preference?.version === feedbackVersion ? Boolean(preference.open) : null;
    } catch { return null; }
  }, [key, feedbackVersion, defaultOpen]);
  const [choice, setChoice] = useState(null);
  const isOpen = choice?.key === key && choice.version === feedbackVersion ? choice.open : savedOpen ?? defaultOpen;

  const setOpen = (open) => {
    const next = Boolean(open);
    setChoice({ key, open: next, version: feedbackVersion });
    if (key) {
      try { localStorage.setItem(key, JSON.stringify({ open: next, version: feedbackVersion })); }
      catch { /* Viewing controls remain usable when browser storage is unavailable. */ }
    }
  };
  return [isOpen, setOpen];
}
