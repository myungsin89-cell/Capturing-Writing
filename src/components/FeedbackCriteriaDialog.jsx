import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { buildFeedbackPrompt, normalizeFeedbackCriteria } from '../utils/batchFeedback';

const fieldClass = 'mt-1 w-full rounded-xl border border-[#CBD5E1] bg-white p-3 text-base leading-relaxed focus:outline-2 focus:outline-[#2D6A4F]';

export default function FeedbackCriteriaDialog({ topic, topics, onSave, onClose, onSaved }) {
  const dialogRef = useRef(null);
  const [criteria, setCriteria] = useState(() => normalizeFeedbackCriteria(topic.feedbackCriteria));
  const [reuseTopicId, setReuseTopicId] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const normalized = normalizeFeedbackCriteria(criteria);
  const dirty = JSON.stringify(normalized) !== JSON.stringify(normalizeFeedbackCriteria(topic.feedbackCriteria));
  const otherTopics = topics.filter((item) => item.id !== topic.id && item.feedbackCriteria);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);

  const requestClose = () => {
    if (savingRef.current) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };
  const save = async (event) => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const result = await onSave(topic.id, normalized);
      if (!result?.ok) throw new Error(result?.error || '기준을 저장하지 못했습니다. 다시 시도해 주세요.');
      onSaved();
      onClose();
    } catch (err) { setError(err.message); }
    finally { savingRef.current = false; setSaving(false); }
  };

  return (
    <dialog ref={dialogRef} aria-labelledby="feedback-criteria-title" aria-describedby="feedback-criteria-description"
      onCancel={(event) => { event.preventDefault(); requestClose(); }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-2xl max-h-[90dvh] overflow-hidden rounded-2xl border border-[#CBD5E1] bg-[#FBFBF9] p-0 text-[#1E293B] shadow-xl backdrop:bg-black/40">
      <form onSubmit={save} className="flex max-h-[90dvh] flex-col">
        <div className="shrink-0 flex items-start justify-between gap-3 border-b border-[#E2E8F0] p-5 sm:p-6">
          <div className="min-w-0">
            <h2 id="feedback-criteria-title" className="text-xl font-bold text-[#1B4332]">피드백 기준</h2>
            <p className="mt-1 text-sm font-bold text-[#475569] break-words">{topic.title}</p>
          </div>
          <button type="button" onClick={requestClose} disabled={saving} aria-label="피드백 기준 닫기" className="min-h-11 min-w-11 flex items-center justify-center rounded-xl border border-[#CBD5E1] bg-white cursor-pointer disabled:opacity-50"><X aria-hidden="true" className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 overflow-y-auto p-5 sm:p-6 space-y-4">
          <p id="feedback-criteria-description" className="text-sm text-[#475569]">한 번 저장하면 이 주제의 개인·묶음 피드백에서 ‘기준 복사’로 사용할 수 있습니다.</p>
          {otherTopics.length > 0 && <details className="rounded-xl border border-[#D8F3DC] bg-[#F2F9F5] p-3">
            <summary className="cursor-pointer text-sm font-bold text-[#1B4332] py-1">다른 주제의 기준 불러오기</summary>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1"><label htmlFor="feedback-reuse-topic" className="text-sm font-bold">불러올 주제</label><select id="feedback-reuse-topic" disabled={saving} value={reuseTopicId} onChange={(event) => setReuseTopicId(event.target.value)} className={fieldClass}><option value="">주제를 선택하세요</option>{otherTopics.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>
              <button type="button" disabled={saving || !reuseTopicId} onClick={() => { setCriteria(normalizeFeedbackCriteria(otherTopics.find((item) => item.id === reuseTopicId)?.feedbackCriteria)); setConfirmDiscard(false); }} className="sketch-btn-secondary min-h-11 px-4 py-2 text-sm font-bold disabled:opacity-50">불러오기</button>
            </div>
          </details>}
          <div><label htmlFor="feedback-criteria-goal" className="text-sm font-bold">이번 수업의 목표</label><textarea autoFocus id="feedback-criteria-goal" className={fieldClass} rows={2} disabled={saving} value={criteria.goal} onChange={(event) => setCriteria({ ...criteria, goal: event.target.value })} placeholder="예: 경험한 일을 순서대로 생생하게 표현하기" /></div>
          <div><label htmlFor="feedback-criteria-items" className="text-sm font-bold">살펴볼 기준</label><textarea id="feedback-criteria-items" className={fieldClass} rows={3} disabled={saving} value={criteria.criteria} onChange={(event) => setCriteria({ ...criteria, criteria: event.target.value })} placeholder="예: 사건의 순서 / 구체적인 장면 / 생각과 느낌" /></div>
          <div><label htmlFor="feedback-criteria-guidance" className="text-sm font-bold">피드백 방식</label><textarea id="feedback-criteria-guidance" className={fieldClass} rows={3} disabled={saving} value={criteria.guidance} onChange={(event) => setCriteria({ ...criteria, guidance: event.target.value })} /></div>
          <details className="text-sm text-[#475569]"><summary className="cursor-pointer py-2 font-bold">Brisk에 복사될 전체 요청문 보기</summary><textarea readOnly aria-label="피드백 전체 요청문" className={fieldClass} rows={7} value={buildFeedbackPrompt(topic, criteria)} onFocus={(event) => event.target.select()} /></details>
          {error && <p role="alert" className="text-sm text-[#B91C1C]">{error}</p>}
          {confirmDiscard && <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-sm space-y-2" role="alert"><p>저장하지 않은 변경 내용이 있습니다.</p><div className="flex flex-wrap gap-2"><button type="button" className="sketch-btn-secondary min-h-11 px-3 py-2 font-bold" onClick={() => setConfirmDiscard(false)}>계속 수정</button><button type="button" className="min-h-11 px-3 py-2 underline cursor-pointer" onClick={onClose}>저장하지 않고 닫기</button></div></div>}
        </div>
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8F0] p-5 sm:p-6">
          <p className="text-xs text-[#64748B]">변경한 기준은 개인 피드백과 새 묶음에 적용됩니다.</p>
          <div className="flex gap-2"><button type="button" onClick={requestClose} disabled={saving} className="sketch-btn-secondary min-h-11 px-4 py-2 text-sm font-bold">닫기</button><button type="submit" disabled={saving || (!dirty && Boolean(topic.feedbackCriteria))} className="sketch-btn-primary min-h-11 px-5 py-2 text-sm font-bold disabled:opacity-50">{saving ? '저장 중…' : '저장하기'}</button></div>
        </div>
      </form>
    </dialog>
  );
}
