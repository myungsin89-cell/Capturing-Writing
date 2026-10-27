import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, ExternalLink, X } from 'lucide-react';
import { createBookletSnapshot, getBookletTopicSummary, isClosedBookletTopic } from '../utils/bookletData';

export default function BookletDialog({ topics, students, config, initialTopicIds, initialTitle, onClose }) {
  const dialogRef = useRef(null);
  const mounted = useRef(true);
  const classId = config.activeClassId;
  const eligible = useMemo(() => topics.filter((topic) => isClosedBookletTopic(topic) && (!topic.classId || String(topic.classId) === String(classId))).slice().reverse(), [topics, classId]);
  const [selectedIds, setSelectedIds] = useState(() => initialTopicIds || eligible.map((topic) => String(topic.id)));
  const [title, setTitle] = useState(initialTitle || (config.className || '우리 반') + ' 글모음');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const summaries = eligible.map((topic) => getBookletTopicSummary(topic, students, config.activeTopicId, classId));
  const selected = selectedIds.map((id) => summaries.find((topic) => topic.id === String(id))).filter(Boolean);
  const includedCount = selected.reduce((sum, topic) => sum + topic.includedCount, 0);
  const excludedCount = selected.reduce((sum, topic) => sum + topic.excludedCount, 0);
  const invalidSelection = selected.length !== selectedIds.length;

  useEffect(() => {
    mounted.current = true;
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    dialog.showModal();
    return () => { mounted.current = false; dialog.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => () => { if (result?.url) URL.revokeObjectURL(result.url); }, [result?.url]);

  const move = (id, direction) => {
    const index = selectedIds.indexOf(id);
    const next = [...selectedIds];
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setSelectedIds(next);
  };
  const download = (book) => {
    const anchor = document.createElement('a');
    anchor.href = book.url;
    anchor.download = book.filename;
    anchor.click();
  };
  const generate = async () => {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const snapshot = createBookletSnapshot({ topics, students, selectedTopicIds: selectedIds, activeTopicId: config.activeTopicId, classId, className: config.className, title });
      setProgress('문집을 준비하고 있어요...');
      const { generateBookletPdf } = await import('../services/bookletPdfService');
      const generated = await generateBookletPdf(snapshot, (message) => { if (mounted.current) setProgress(message); });
      if (!mounted.current) return;
      const book = { ...generated, url: URL.createObjectURL(generated.blob), snapshot };
      setResult(book);
      download(book);
    } catch (cause) {
      console.warn('문집 PDF 생성 실패:', cause);
      if (mounted.current) setError(/[가-힣]/.test(cause.message || '') ? cause.message : '문집을 만들지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
    } finally {
      if (mounted.current) { setBusy(false); setProgress(''); }
    }
  };

  return (
    <dialog ref={dialogRef} aria-labelledby="booklet-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} className="m-auto w-[calc(100%_-_2rem)] max-w-3xl max-h-[90dvh] rounded-2xl border border-[#CBD5E1] bg-white p-0 text-[#1E293B] shadow-xl backdrop:bg-black/35">
      <div className="flex max-h-[90dvh] flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-[#E2E8F0] p-5 shrink-0">
          <div><h2 id="booklet-title" className="text-lg font-bold text-[#1B4332]">문집 만들기</h2><p className="mt-1 text-sm text-[#64748B]">마감한 주제의 최종 완성 글을 한 권의 PDF로 모아요.</p></div>
          <button type="button" aria-label="문집 만들기 닫기" disabled={busy} onClick={onClose} className="min-h-10 min-w-10 flex items-center justify-center rounded-lg border border-[#CBD5E1] disabled:opacity-40"><X className="w-4 h-4" /></button>
        </header>
        <div className="overflow-y-auto p-5 space-y-5">
          <label className="block text-sm font-bold text-[#475569]">문집 제목<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} disabled={busy} className="mt-2 w-full rounded-xl border border-[#CBD5E1] px-3 py-2.5 font-normal focus:outline-none focus:border-[#1B4332]" /></label>
          <p className="text-xs text-[#64748B]">A4 세로 · 표지와 목차 · 주제별 묶음 · 학생별 새 페이지 · 쪽번호<br />작품 제목·이름·본문을 담고, 첨삭·질문·수정 이력은 넣지 않습니다.</p>
          <fieldset disabled={busy} className="space-y-3">
            <legend className="text-sm font-bold text-[#475569] mb-2">담을 주제</legend>
            {!eligible.length && <p className="text-sm text-[#64748B]">마감한 주제가 없어요. 주제 안에서 전체 마감을 먼저 해 주세요.</p>}
            {summaries.map((topic) => <label key={topic.id} className="flex items-center gap-3 rounded-xl border border-[#E2E8F0] p-3 cursor-pointer"><input type="checkbox" checked={selectedIds.includes(topic.id)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, topic.id] : ids.filter((id) => id !== topic.id))} className="w-4 h-4 accent-[#1B4332]" /><span className="min-w-0 flex-1 text-sm font-semibold break-words">{topic.title}</span><span className="text-xs text-[#64748B] shrink-0">포함 {topic.includedCount}명 / 제외 {topic.excludedCount}명</span></label>)}
          </fieldset>
          {selected.length > 0 && <section aria-label="문집 주제 순서" className="space-y-2">
            <h3 className="text-sm font-bold text-[#475569]">목차 순서</h3>
            {selected.map((topic, index) => <div key={topic.id} className="flex items-center gap-2 text-sm"><span className="text-[#94A3B8] w-5 shrink-0">{index + 1}</span><span className="flex-1 min-w-0 break-words">{topic.title}</span><button type="button" aria-label={topic.title + ' 위로'} disabled={busy || index === 0} onClick={() => move(topic.id, -1)} className="min-h-9 min-w-9 rounded-lg border border-[#E2E8F0] flex items-center justify-center disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button><button type="button" aria-label={topic.title + ' 아래로'} disabled={busy || index === selected.length - 1} onClick={() => move(topic.id, 1)} className="min-h-9 min-w-9 rounded-lg border border-[#E2E8F0] flex items-center justify-center disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button></div>)}
          </section>}
          <div className="rounded-xl border border-[#D8F3DC] bg-[#F2F9F5] p-4 space-y-2 text-sm">
            <p className="font-bold text-[#1B4332]">최종 완성 글 {includedCount}편 포함 / {excludedCount}편 제외</p>
            <p className="text-xs text-[#64748B]">여러 주제를 선택하면 같은 학생의 글도 주제별로 각각 셉니다. 완성 글이 없는 주제는 PDF에서 빠집니다.</p>
            {excludedCount > 0 && <details><summary className="cursor-pointer py-1 text-xs font-semibold text-[#475569]">제외되는 학생 확인</summary><div className="mt-2 space-y-2 max-h-40 overflow-y-auto">{selected.filter((topic) => topic.excludedCount > 0).map((topic) => <div key={topic.id} className="text-xs text-[#64748B]"><p className="font-bold text-[#475569]">{topic.title}</p>{topic.excluded.map((student, index) => <p key={index}>{student.number}번 {student.name} · {student.reason}</p>)}</div>)}</div></details>}
          </div>
          {invalidSelection && <p role="alert" className="text-sm text-[#B91C1C]">선택한 주제 중 마감이 해제되거나 삭제된 주제가 있어요. <button type="button" disabled={busy} onClick={() => setSelectedIds(selected.map((topic) => topic.id))} className="underline">현재 선택 정리하기</button></p>}
          {result && <section aria-label="생성한 문집" className="rounded-xl border border-[#CBD5E1] p-4 space-y-3 text-sm">
            <p className="font-bold text-[#1B4332]">{result.snapshot.title} · {result.pageCount}쪽</p>
            <p className="text-xs text-[#64748B]">{result.snapshot.chapters.length}개 주제 · {result.snapshot.includedCount}편 · {new Date(result.snapshot.createdAt).toLocaleString('ko-KR')} 기준</p>
            {result.unsupportedCharacters.length > 0 && <p role="status" className="text-xs text-[#92400E]">글꼴이 지원하지 않는 문자({result.unsupportedCharacters.slice(0, 8).join(' ')})는 PDF에서 □로 표시했어요. 원문은 그대로 보관됩니다.</p>}
            <div className="flex flex-wrap gap-2"><button type="button" onClick={() => download(result)} className="sketch-btn-secondary min-h-10 px-3 text-xs font-bold flex items-center gap-1.5"><Download className="w-4 h-4" />다시 다운로드</button><a href={result.url} target="_blank" rel="noopener noreferrer" className="sketch-btn-secondary min-h-10 px-3 text-xs font-bold flex items-center gap-1.5"><ExternalLink className="w-4 h-4" />PDF 열어 인쇄</a></div>
          </section>}
          {error && <p role="alert" className="text-sm text-[#B91C1C]">{error}</p>}
          {busy && <p role="status" className="text-sm text-[#2D6A4F]">{progress}</p>}
        </div>
        <footer className="shrink-0 flex items-center justify-between gap-3 flex-wrap border-t border-[#E2E8F0] p-5">
          <p className="text-xs text-[#64748B]">생성을 누른 시점의 저장된 글로 만들어요.<br />첫 생성에는 한글 글꼴을 불러오는 시간이 필요해요.</p>
          <button type="button" disabled={busy || !includedCount || !title.trim() || invalidSelection} onClick={generate} className="sketch-btn-primary min-h-11 px-5 text-sm font-bold disabled:opacity-50">{busy ? '문집 만드는 중...' : 'PDF 만들고 다운로드'}</button>
        </footer>
      </div>
    </dialog>
  );
}
