import React, { useEffect, useRef, useState } from 'react';
import { X, History } from 'lucide-react';
import { sameDraftContent } from '../utils/studentDraftStorage';

export default function DraftRecoveryDialog({ topicTitle, currentDraft, items, legacy, canRestore, onRestore, onClose }) {
  const dialogRef = useRef(null);
  const [selectedId, setSelectedId] = useState(items.find((item) => !sameDraftContent(item, currentDraft))?.id || items[0]?.id || '');
  const [legacyConfirmed, setLegacyConfirmed] = useState(false);
  const [error, setError] = useState('');
  const selected = selectedId === 'legacy' && legacyConfirmed ? legacy : items.find((item) => item.id === selectedId);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return (
    <dialog ref={dialogRef} aria-labelledby="draft-recovery-title" onCancel={(event) => { event.preventDefault(); onClose(); }} className="m-auto w-[calc(100%_-_2rem)] max-w-3xl max-h-[90dvh] overflow-hidden rounded-2xl border border-[#CBD5E1] bg-[#FBFBF9] p-0 text-[#1E293B] shadow-xl backdrop:bg-black/40">
      <div className="flex max-h-[90dvh] flex-col">
        <div className="shrink-0 flex items-start justify-between gap-3 border-b border-[#E2E8F0] p-5"><div><h2 id="draft-recovery-title" className="flex items-center gap-2 text-lg font-bold text-[#1B4332]"><History className="h-5 w-5" aria-hidden="true" />이전 글 복구</h2><p className="mt-1 text-sm text-[#475569]">{topicTitle} · 이 기기에 보관한 글</p></div><button type="button" aria-label="이전 글 복구 닫기" onClick={onClose} className="min-h-11 min-w-11 flex items-center justify-center rounded-xl border border-[#CBD5E1] bg-white cursor-pointer"><X className="h-5 w-5" aria-hidden="true" /></button></div>
        <div className="min-h-0 overflow-y-auto p-5 space-y-4">
          <p className="text-sm text-[#475569]">내용을 확인하고 복구할 글을 골라 주세요. 지금 쓰던 글도 함께 보관합니다.</p>
          {items.length ? <div className="flex max-h-52 flex-col gap-2 overflow-y-auto pr-1" aria-label="보관한 임시 글 목록">{items.map((item) => <button key={item.id} type="button" aria-pressed={selectedId === item.id} onClick={() => setSelectedId(item.id)} className={`min-h-14 shrink-0 rounded-xl border p-3 text-left cursor-pointer ${selectedId === item.id ? 'border-[#1B4332] bg-[#F2F9F5]' : 'border-[#CBD5E1] bg-white'}`}><span className="block text-sm font-bold">{item.pieceTitle || '제목 없는 글'} · {item.text.length}자</span><span className="block text-xs text-[#64748B]">{item.savedAt ? new Date(item.savedAt).toLocaleString('ko-KR') : '이전 보관 글'}{sameDraftContent(item, currentDraft) ? ' · 지금 글과 같아요' : ''}{item.reason === 'submitted' ? ' · 제출했던 글' : ''}</span><span className="mt-1 block line-clamp-2 break-words text-xs text-[#475569]">{item.text.slice(0, 80) || '(본문이 없는 글)'}</span></button>)}</div> : <p className="rounded-xl border border-[#E2E8F0] bg-white p-4 text-sm text-[#64748B]">아직 보관한 이전 글이 없어요.</p>}
          {legacy && <details className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-sm"><summary className="cursor-pointer py-1 font-bold text-[#92400E]">예전에 임시 보관한 글 확인</summary><p className="mt-2">이 글에는 작성자 정보가 없어 자동으로 불러오지 않았어요. 공용 기기라면 선생님과 함께 확인해 주세요.</p><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={legacyConfirmed} onChange={(event) => { setLegacyConfirmed(event.target.checked); if (!event.target.checked && selectedId === 'legacy') setSelectedId(''); }} className="h-4 w-4 accent-[#1B4332]" />이 기기에서 내가 작성하던 글이 맞아요</label><button type="button" disabled={!legacyConfirmed} onClick={() => setSelectedId('legacy')} className="sketch-btn-secondary min-h-11 px-3 py-2 font-bold disabled:opacity-50">확인하고 미리보기</button></details>}
          {selected && <div className="rounded-xl border border-[#CBD5E1] bg-white p-4"><h3 className="text-center font-bold text-[#1B4332]">{selected.pieceTitle || '제목 없는 글'}</h3><div aria-label="복구할 글 미리보기" className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-base leading-8">{selected.text || '(본문이 없는 글)'}</div></div>}
          {!canRestore && <p className="text-sm text-[#92400E]">지금은 제출한 글을 읽는 중이에요. 제출을 회수하거나 선생님이 고쳐 쓰기를 열어 주면 복구할 수 있어요.</p>}
          {error && <p role="alert" className="text-sm text-[#B91C1C]">{error}</p>}
        </div>
        <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t border-[#E2E8F0] p-5"><button type="button" onClick={onClose} className="sketch-btn-secondary min-h-11 px-4 py-2 text-sm font-bold">닫기</button><button type="button" disabled={!selected || !canRestore} onClick={() => { if (!onRestore(selected)) setError('복구할 글을 저장하지 못했어요. 현재 글을 먼저 복사해 보관해 주세요.'); }} className="sketch-btn-primary min-h-11 px-4 py-2 text-sm font-bold disabled:opacity-50">선택한 글로 복구</button></div>
      </div>
    </dialog>
  );
}
