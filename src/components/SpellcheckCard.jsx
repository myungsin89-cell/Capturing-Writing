import React from 'react';
import { ArrowRight, LoaderCircle, SpellCheck, X } from 'lucide-react';

export default function SpellcheckCard({ state, canCheck, waitSeconds = 0, canLocate, onCheck, onLocate, onClose }) {
  if (!state) return null;
  const issues = state.result?.issues || [];
  return <section id="student-spellcheck-results" className="student-spellcheck-card" aria-label="맞춤법 검사 결과" aria-busy={state.status === 'loading'}>
    <header className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-[#334155]"><SpellCheck className="w-4 h-4" aria-hidden="true" />맞춤법 검사</h2>
      <div className="flex items-center gap-3">
        {state.status !== 'loading' && <button type="button" aria-label="다시 검사" onClick={onCheck} disabled={!canCheck} className="student-text-button">{waitSeconds > 0 ? `${waitSeconds}초 후 검사` : '다시 검사'}</button>}
        {state.status !== 'loading' && <button type="button" onClick={onClose} className="student-text-button" aria-label="맞춤법 결과 닫기"><X className="w-4 h-4" aria-hidden="true" /></button>}
      </div>
    </header>
    <p role="status" className="text-sm text-[#64748B]">
      {state.status === 'loading' ? <span className="flex items-center gap-2"><LoaderCircle className="w-4 h-4 animate-spin" aria-hidden="true" />글을 확인하고 있어요…</span>
        : state.status === 'error' ? state.error
        : issues.length ? `확인할 표현 ${issues.length}곳` : '이번 검사에서 확인할 표현을 찾지 못했어요.'}
    </p>
    {issues.length > 0 && <ul className="student-spellcheck-list">
      {issues.map((issue) => <li key={issue.id}>
        <button type="button" className={'student-spellcheck-item ' + (issue.changed ? 'is-changed' : '')}
          disabled={!canLocate || issue.changed || issue.start === null} onClick={() => onLocate(issue)}
          title={issue.start === null && !issue.changed ? '정확한 위치를 찾기 어려워요. 표현을 확인해 주세요.' : '공책에서 이 표현 선택하기'}>
          <span className="student-spellcheck-expression"><span>{issue.field === 'title' && <span className="text-xs text-[#64748B] mr-1">제목</span>}{issue.original}</span>
            <ArrowRight className="w-3.5 h-3.5 shrink-0 text-[#94A3B8]" aria-hidden="true" />
            <span className="text-[#2D6A4F]">{issue.suggestions.join(' / ')}</span></span>
          {issue.changed && <span className="text-xs text-[#64748B]">변경됨</span>}
        </button>
      </li>)}
    </ul>}
    {state.result?.dirty && <p className="text-xs text-[#64748B]">검사 후 글이 바뀌었어요. 다 고친 뒤 다시 검사해 주세요.</p>}
    <p className="text-xs leading-relaxed text-[#64748B]">모든 오류를 찾지는 못하며, 제안이 맞지 않을 수 있어요.</p>
    <p className="text-[11px] text-[#94A3B8]">제목과 본문만 외부 맞춤법 검사 서비스로 보내요.</p>
  </section>;
}
