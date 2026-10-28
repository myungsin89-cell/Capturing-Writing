import React, { useId, useState } from 'react';
import { Star } from 'lucide-react';
import { normalizeCompletionStars } from '../utils/batchFeedback';

export default function CompletionStars({ value, className = '' }) {
  const count = normalizeCompletionStars(value);
  if (!count) return null;
  return <span role="img" aria-label={`선생님이 준 별 ${count}개`} className={`inline-flex items-center gap-0.5 text-[#B77910] ${className}`}>
    {Array.from({ length: count }, (_, index) => <Star key={index} className="w-4 h-4" fill="currentColor" strokeWidth={1.5} aria-hidden="true" />)}
  </span>;
}

export function CompletionStarPicker({ value, onChange, disabled = false }) {
  const name = useId();
  const [hover, setHover] = useState(null);
  const selected = normalizeCompletionStars(value);
  const preview = hover ?? selected;
  return <fieldset disabled={disabled} aria-label="완성 작품 별 선택" className="completion-star-picker">
    <legend className="text-xs font-semibold text-[#475569] mb-2">완성 작품의 별 <span className="font-normal text-[#64748B]">(선택)</span></legend>
    <div className="flex items-center gap-1 flex-wrap" onMouseLeave={() => setHover(null)}>
      {[1, 2, 3].map((count) => <label key={count} title="선택한 별을 다시 누르면 취소됩니다" onMouseEnter={() => !disabled && setHover(count)} className="completion-star-choice">
        <input type="radio" name={name} value={count} checked={selected === count}
          onClick={() => { if (selected === count) { setHover(0); onChange(0); } }}
          onChange={() => { setHover(count); onChange(count); }} aria-label={`별 ${count}개`} className="sr-only" />
        <Star aria-hidden="true" className={count <= preview ? 'text-[#B77910]' : 'text-[#CBD5E1]'} fill={count <= preview ? 'currentColor' : 'none'} strokeWidth={1.6} />
      </label>)}
      <label onMouseEnter={() => setHover(0)} className="completion-no-stars">
        <input type="radio" name={name} value={0} checked={selected === 0} onChange={() => onChange(0)} aria-label="별 없이" className="sr-only" />별 없이
      </label>
      <span aria-live="polite" className="text-xs text-[#64748B] ml-2">{selected ? `별 ${selected}개 선택` : '별 없이 완성'}</span>
    </div>
  </fieldset>;
}
