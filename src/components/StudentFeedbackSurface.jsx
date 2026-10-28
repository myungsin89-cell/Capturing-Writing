import React from 'react';
import { createPortal } from 'react-dom';

export default function StudentFeedbackSurface({ wide, open, onClose, children }) {
  if (wide) return children;
  if (!open) return null;
  // A portal keeps the drawer above the app header and outside notebook containers.
  return createPortal(<div className="student-quiet student-feedback-drawer-layer">
    <button type="button" tabIndex={-1} onClick={onClose} className="student-feedback-backdrop" aria-label="첨삭 패널 바깥 닫기" />
    {children}
  </div>, document.body);
}
