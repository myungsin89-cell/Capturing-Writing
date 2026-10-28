import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function StudentFeedbackSurface({ open, onClose, trigger, children }) {
  const [present, setPresent] = useState(open);
  const [shown, setShown] = useState(false);
  useLayoutEffect(() => {
    let firstFrame; let secondFrame; let timer;
    if (open) {
      setPresent(true);
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => setShown(true));
      });
    } else {
      setShown(false);
      timer = setTimeout(() => setPresent(false), 240);
    }
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); clearTimeout(timer); };
  }, [open]);
  // Both the edge control and drawer stay fixed to the viewport, outside notebook containers.
  return createPortal(<div className="student-quiet student-feedback-drawer-layer">
    {!open && trigger}
    {(open || present) && <>
      <button type="button" tabIndex={-1} disabled={!open} onClick={onClose} className="student-feedback-backdrop" data-open={shown && open} aria-label="첨삭 패널 바깥 닫기" />
      <div className="student-feedback-drawer" data-open={shown && open} aria-hidden={!open} inert={!open}>
        {children}
      </div>
    </>}
  </div>, document.body);
}
