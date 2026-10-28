import React, { useEffect, useRef } from 'react';
import { BookOpen, Check, X } from 'lucide-react';
import { HandDrawnDiffIcon } from './HandDrawnIcons';
import CompletionStars from './CompletionStars';

export default function CompletionDialog({ name, stars = 0, canCompare, onClose, onFriends, onCompare }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} aria-labelledby="completion-title" onCancel={(event) => { event.preventDefault(); onClose(); }} className="student-completion-dialog">
    <div className="flex items-start justify-between gap-3">
      <div><span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#2D6A4F]"><Check className="w-4 h-4" aria-hidden="true" />최종 완성</span>
        <h2 id="completion-title" className="mt-3 text-xl font-bold text-[#1B4332]">{name} 학생, 작품을 완성했어요!</h2></div>
      <button type="button" aria-label="완성 안내 닫기" onClick={onClose} className="student-text-button shrink-0"><X className="w-5 h-5" aria-hidden="true" /></button>
    </div>
    {stars > 0 && <div className="mt-4 flex items-center gap-2"><CompletionStars value={stars} /><p className="text-sm font-semibold text-[#92400E]">선생님이 별 {stars}개를 주셨어요!</p></div>}
    <p className="my-5 text-base leading-relaxed text-[#475569]">끝까지 글을 쓰고 다듬은 노력이 멋져요. 처음 쓴 글과 달라진 점을 찾아보고, 친구들의 작품도 감상해 보세요. 내 작품은 계속 다듬을 수 있어요.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="student-action-button" onClick={onFriends}><BookOpen className="w-4 h-4" aria-hidden="true" />친구 완성 글 보기</button>
      <button type="button" disabled={!canCompare} className="student-action-button" onClick={onCompare}><HandDrawnDiffIcon size={16} color="#475569" />처음 글과 비교하기</button>
    </div>
    <div className="mt-6 flex justify-end"><button type="button" className="student-primary-button" onClick={onClose}>내 작품 보기</button></div>
  </dialog>;
}
