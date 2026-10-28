import React, { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';

export default function FriendNotebooks({ topic, onLoad, onClose }) {
  const [writings, setWritings] = useState([]);
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.resolve().then(() => onLoad(topic.id)).then((result) => {
      if (cancelled) return;
      if (!result?.ok) throw new Error(result?.error || '친구 글을 불러오지 못했어요.');
      setWritings(Array.isArray(result.writings) ? result.writings : []);
    }).catch((reason) => { if (!cancelled) setError(reason.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [topic.id, refresh]);
  const index = writings.findIndex((writing) => writing.number === selectedNumber);
  const selected = writings[index];
  return (
    <div className="student-quiet notebook-workspace flex-1 w-full px-6 lg:px-10 py-5 space-y-5">
      <header className="student-notebook-toolbar">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <button type="button" className="student-text-button" onClick={onClose}><ArrowLeft className="w-4 h-4" aria-hidden="true" />내 노트로 돌아가기</button>
          <h1 className="text-base font-semibold text-[#334155]">{topic.title} · 친구 완성 글</h1>
        </div>
        <button type="button" disabled={loading} className="student-text-button" onClick={() => setRefresh((value) => value + 1)}><RefreshCw className="w-4 h-4" aria-hidden="true" />새로고침</button>
      </header>
      {loading ? <p role="status" className="text-center py-12 text-[#64748B]">친구들의 공책을 가져오고 있어요.</p>
        : error ? <div role="alert" className="text-center py-12 space-y-3"><p>{error}</p><button type="button" className="student-action-button" onClick={() => setRefresh((value) => value + 1)}>다시 시도</button></div>
        : selected ? (
          <section aria-label="친구 완성 공책" className="notebook-card sketch-card bg-white" style={{ marginInline: 'auto' }}>
            <div className="student-paper-toolbar">
              <button type="button" className="student-text-button" onClick={() => setSelectedNumber(null)}><ArrowLeft className="w-4 h-4" aria-hidden="true" />친구 글 목록</button>
              <span className="text-xs text-[#64748B]">{index + 1} / {writings.length}</span>
            </div>
            <article className="manuscript-paper lined-paper rounded-2xl border border-[#CBD5E1] text-[#1E293B]">
              <h2 className="manuscript-title">{selected.pieceTitle || '제목 없는 글'}</h2>
              <div className="manuscript-name text-[#475569]">{selected.name}</div>
              <div className="manuscript-body">{selected.text}</div>
            </article>
            <footer className="student-paper-footer flex justify-between gap-3">
              <button type="button" disabled={index === 0} className="student-text-button" onClick={() => setSelectedNumber(writings[index - 1].number)}><ChevronLeft className="w-4 h-4" aria-hidden="true" />이전 공책</button>
              <button type="button" disabled={index === writings.length - 1} className="student-text-button" onClick={() => setSelectedNumber(writings[index + 1].number)}>다음 공책<ChevronRight className="w-4 h-4" aria-hidden="true" /></button>
            </footer>
          </section>
        ) : (
          <section aria-label="친구 완성 글 목록">
            <p className="text-sm text-[#64748B] mb-5">선생님이 완성 처리한 친구들의 글을 읽어 보세요.</p>
            {writings.length === 0 ? <p role="status" className="text-center py-16 text-[#64748B]">아직 이 주제에서 완성한 친구 글이 없어요.</p>
              : <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">{writings.map((writing) => (
                <button type="button" key={writing.number} onClick={() => setSelectedNumber(writing.number)} className="sketch-card bg-white p-6 text-left hover:border-[#2D6A4F] transition space-y-3 min-w-0">
                  <BookOpen className="w-5 h-5 text-[#64748B]" aria-hidden="true" />
                  <h2 className="font-editorial-serif text-lg text-[#1E293B] break-words">{writing.pieceTitle || '제목 없는 글'}</h2>
                  <p className="text-sm text-[#64748B]">{writing.number}번 {writing.name}</p>
                </button>
              ))}</div>}
          </section>
        )}
    </div>
  );
}
