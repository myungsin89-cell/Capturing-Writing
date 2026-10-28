/**
 * 문단(줄바꿈 \n)을 100% 보존하는 초등 글쓰기 비교(Diff) 알고리즘
 * 학생이 나눈 문단 형식이 절대 깨지지 않도록 문단 및 줄바꿈 토큰을 보존하며 비교합니다.
 */
export function computeKoreanDiff(oldText = '', newText = '') {
  const cleanOld = (oldText || '').replace(/\r\n/g, '\n');
  const cleanNew = (newText || '').replace(/\r\n/g, '\n');

  if (!cleanOld.trim() && !cleanNew.trim()) {
    return { tokens: [], stats: { addedCount: 0, removedCount: 0, charDiff: 0, oldLength: 0, newLength: 0 } };
  }

  // 줄바꿈(\n)과 일반 공백을 분리하여 토큰화함으로써 문단 구조를 정확히 유지
  const oldTokens = cleanOld.split(/(\n+|\s+)/);
  const newTokens = cleanNew.split(/(\n+|\s+)/);

  const m = oldTokens.length;
  const n = newTokens.length;
  const dp = Array.from({ length: m + 1 }, () => new Int16Array(n + 1));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldTokens[i] === newTokens[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const rawResult = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldTokens[i] === newTokens[j]) {
      rawResult.push({ type: 'unchanged', value: oldTokens[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rawResult.push({ type: 'removed', value: oldTokens[i] });
      i++;
    } else {
      rawResult.push({ type: 'added', value: newTokens[j] });
      j++;
    }
  }
  while (i < m) {
    rawResult.push({ type: 'removed', value: oldTokens[i++] });
  }
  while (j < n) {
    rawResult.push({ type: 'added', value: newTokens[j++] });
  }

  // 줄바꿈(\n)은 병합하지 않고 독립 유지하여 문단 구분이 흐트러지지 않게 처리
  const merged = [];
  for (const item of rawResult) {
    const isNewline = /^\n+$/.test(item.value);
    if (
      !isNewline &&
      merged.length > 0 &&
      merged[merged.length - 1].type === item.type &&
      !/^\n+$/.test(merged[merged.length - 1].value)
    ) {
      merged[merged.length - 1].value += item.value;
    } else {
      merged.push({ ...item });
    }
  }

  const addedCount = merged.filter(t => t.type === 'added' && t.value.trim().length > 0).length;
  const removedCount = merged.filter(t => t.type === 'removed' && t.value.trim().length > 0).length;
  const charDiff = cleanNew.trim().length - cleanOld.trim().length;

  return {
    tokens: merged,
    stats: {
      addedCount,
      removedCount,
      charDiff,
      oldLength: cleanOld.trim().length,
      newLength: cleanNew.trim().length
    }
  };
}

import React from 'react';
import { getUsableDraftHistory } from './topicTransition.js';
import { normalizeWritingText, resolveTextSelection } from './textSelection.js';

/**
 * 본문에서 특정 문장(highlightedQuote)을 찾아 노란 형광펜으로 하이라이트 렌더링하는 헬퍼
 * 문단(줄바꿈)을 그대로 보존합니다.
 */
export function renderTextWithHighlight(text = '', highlightedQuote = '') {
  if (!text) return null;
  const normalizedText = normalizeWritingText(text);
  const range = resolveTextSelection(normalizedText, highlightedQuote);
  if (!range) return normalizedText;
  return [normalizedText.slice(0, range.start), React.createElement('mark', {
    key: 'selected-range', id: 'active-highlight-quote',
    className: 'manuscript-highlight bg-[#FEF08A] text-[#1E293B]'
  }, normalizedText.slice(range.start, range.end)), normalizedText.slice(range.end)];
}

/**
 * [초록 글씨 비교 헬퍼]
 * 녹색 배경 박스 없이, 완성본 문단 그대로 보여주되 이전 차수 대비 새로 추가·수정한 표현만
 * 글자 폭을 바꾸지 않는 초록색 글씨로 표시합니다.
 */
export function renderTextWithGreenAdditions(
  prevText = '',
  currentText = '',
  highlightedQuote = ''
) {
  if (!currentText) return null;
  if (highlightedQuote) {
    return renderTextWithHighlight(currentText, highlightedQuote);
  }
  if (!prevText || !prevText.trim() || prevText.trim() === currentText.trim()) {
    return renderTextWithHighlight(currentText, '');
  }

  const diff = computeKoreanDiff(prevText, currentText);
  const visibleTokens = diff.tokens.filter((t) => t.type !== 'removed');

  return React.createElement(
    'div',
    { className: 'leading-8 whitespace-pre-wrap' },
    visibleTokens.map((tok, idx) =>
      tok.type === 'added' && tok.value.trim().length > 0
        ? React.createElement(
            'span',
            {
              key: idx,
              className: 'text-[#15803D]'
            },
            tok.value
          )
        : React.createElement('span', { key: idx }, tok.value)
    )
  );
}

/**
 * 학생의 모든 차수별 글(1차, 2차, 3차, 4차...)을 페이지 배열로 반환합니다.
 * 3개, 4개 이상의 다회차 첨삭·고쳐쓰기도 페이지 넘김(◀ 1차 | 2차 | 3차 | 4차 ▶)으로 볼 수 있습니다.
 */
export function getStudentDraftPages(student) {
  if (!student) return [];

  const storedHistory = getUsableDraftHistory(student);
  if (storedHistory.length > 0) {
    return storedHistory
      .map((d, idx) => ({
        round: idx + 1,
        label: `${idx + 1}차 글`,
        text: d.text,
        pieceTitle: d.pieceTitle || student.pieceTitle || '',
        teacherNote: d.teacherNote || '',
        feedbackItems: d.feedbackItems || [],
        updatedAt: d.updatedAt || ''
      }));
  }

  const rawDrafts = [
    student.draft1,
    student.draft2,
    student.draft3,
    student.draft4,
    student.draft5
  ].filter((t) => t && String(t).trim().length > 0);

  return rawDrafts.map((txt, idx) => ({
    round: idx + 1,
    label: `${idx + 1}차 글`,
    text: txt,
    pieceTitle: student.pieceTitle || '',
    teacherNote: idx === rawDrafts.length - 1 ? student.teacherNote || '' : '',
    feedbackItems: idx === rawDrafts.length - 1 ? student.feedbackItems || [] : []
  }));
}

/**
 * 현재 필드에서 이전 차수로 보관된 첨삭까지 합쳐, 학생이 다시 볼 수 있는
 * 차수별 피드백만 반환합니다. 예전 데이터처럼 최신 첨삭이 최상위 필드에만
 * 남아 있는 경우에도 마지막 글에 연결합니다.
 */
export function getStudentFeedbackPages(student) {
  if (!student) return [];

  const draftPages = getStudentDraftPages(student);
  const topLevelNote = student.teacherNote || '';
  const topLevelItems = Array.isArray(student.feedbackItems) ? student.feedbackItems : [];

  if (draftPages.length === 0) {
    if (!topLevelNote.trim() && topLevelItems.length === 0) return [];
    return [{
      round: 1,
      label: '1차 글',
      text: '',
      teacherNote: topLevelNote,
      feedbackItems: topLevelItems
    }];
  }

  return draftPages
    .map((page, idx) => {
      const isLatest = idx === draftPages.length - 1;
      const pageItems = Array.isArray(page.feedbackItems) ? page.feedbackItems : [];
      return {
        ...page,
        teacherNote: page.teacherNote || (isLatest ? topLevelNote : ''),
        feedbackItems: pageItems.length > 0
          ? pageItems
          : isLatest
          ? topLevelItems
          : []
      };
    })
    .filter(
      (page) =>
        Boolean(page.teacherNote && page.teacherNote.trim()) ||
        page.feedbackItems.length > 0
    );
}

export function isFinalWritingStatus(status) {
  return status === 'FINAL_COMPLETED';
}

export function isSubmittedWritingStatus(status) {
  return (
    status === 'REVISION_SUBMITTED' ||
    status === 'STAGE_1_SUBMITTED' ||
    status === 'STAGE_2_SUBMITTED' ||
    status === 'STAGE_3_COMPLETED'
  );
}

export const STAGE_META = {
  STAGE_1_WRITING: {
    label: '1차 초안 작성중',
    shortLabel: '초안 작성중',
    step: 1,
    badgeBg: 'bg-[#F8FAFC]',
    badgeBorder: 'border-[#CBD5E1]',
    badgeText: 'text-[#475569]'
  },
  STAGE_1_SUBMITTED: {
    label: '1차 초안 제출완료',
    shortLabel: '1차 제출완료',
    step: 1,
    badgeBg: 'bg-[#FEF3C7]',
    badgeBorder: 'border-[#F59E0B]',
    badgeText: 'text-[#92400E]'
  },
  FEEDBACK_DONE: {
    label: '첨삭 도착 · 고쳐 쓰는 중',
    shortLabel: '첨삭 도착 (수정중)',
    step: 2,
    badgeBg: 'bg-[#F2F9F5]',
    badgeBorder: 'border-[#52B788]',
    badgeText: 'text-[#1B4332]'
  },
  STAGE_2_SUBMITTED: {
    label: '2차 수정본 제출완료',
    shortLabel: '2차 제출완료',
    step: 2,
    badgeBg: 'bg-[#E0F2FE]',
    badgeBorder: 'border-[#38BDF8]',
    badgeText: 'text-[#075985]'
  },
  REVISION_SUBMITTED: {
    label: '수정본 제출완료 · 확인 대기중',
    shortLabel: '수정본 확인 대기',
    step: 2,
    badgeBg: 'bg-[#E0F2FE]',
    badgeBorder: 'border-[#38BDF8]',
    badgeText: 'text-[#075985]'
  },
  STAGE_3_COMPLETED: {
    label: '3차 수정본 제출완료 · 확인 대기중',
    shortLabel: '3차 수정본 확인 대기',
    step: 2,
    badgeBg: 'bg-[#E0F2FE]',
    badgeBorder: 'border-[#38BDF8]',
    badgeText: 'text-[#075985]'
  },
  FINAL_COMPLETED: {
    label: '최종 완성본',
    shortLabel: '최종 완성',
    step: 3,
    badgeBg: 'bg-[#D8F3DC]',
    badgeBorder: 'border-[#1B4332]',
    badgeText: 'text-[#1B4332]'
  }
};
