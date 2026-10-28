import { useEffect, useState } from 'react';

export default function useCompletionNotice(owner, completed, edition, enabled = true) {
  const key = owner ? `sseudam_completion_seen_v1:${encodeURIComponent(JSON.stringify(owner))}` : '';
  const version = edition || 'legacy-completed';
  const [visible, setVisible] = useState(null);
  useEffect(() => {
    if (!enabled || !completed || !key) return;
    try { if (localStorage.getItem(key) === version) return; }
    catch { /* The notice remains usable without browser storage. */ }
    setVisible({ key, version });
    try { localStorage.setItem(key, version); } catch { /* No writing data is stored here. */ }
  }, [key, completed, version, enabled]);
  const open = enabled && completed && visible?.key === key && visible.version === version;
  return [open, () => setVisible({ key, version }), () => setVisible(null)];
}
