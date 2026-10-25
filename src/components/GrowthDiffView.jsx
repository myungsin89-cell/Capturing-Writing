import React, { useState, useMemo, useEffect } from 'react';
import {
  computeKoreanDiff,
  getStudentDraftPages,
  renderTextWithGreenAdditions,
  renderTextWithHighlight
} from '../utils/diffHelper';
import {
  HandDrawnDiffIcon,
  HandDrawnLeafIcon,
  HandDrawnSparkleIcon
} from './HandDrawnIcons';
import { X, ChevronLeft, ChevronRight, Eye } from 'lucide-react';

export default function GrowthDiffView({ student, topicTitle = '' }) {
  const pages = useMemo(() => getStudentDraftPages(student), [student]);

  // 비교할 왼쪽(이전 차수) 페이지 인덱스와 오른쪽(이후 차수) 페이지 인덱스
  const [leftIdx, setLeftIdx] = useState(0);
  const [rightIdx, setRightIdx] = useState(() => Math.max(0, pages.length - 1));

  // [핵심] 녹색 박스 없이 '추가된 표현 초록 글씨 표시' ON/OFF 토글
  const [showGreenText, setShowGreenText] = useState(true);

  useEffect(() => {
    if (pages.length >= 2) {
      setLeftIdx(0);
      setRightIdx(pages.length - 1);
    } else {
      setLeftIdx(0);
      setRightIdx(0);
    }
  }, [student?.number, pages.length]);

  const leftPage = pages[leftIdx] || { round: 1, label: '1차 글', text: '' };
  const rightPage = pages[rightIdx] || leftPage;

  const diffResult = useMemo(
    () => computeKoreanDiff(leftPage.text, rightPage.text),
    [leftPage.text, rightPage.text]
  );

  const countParagraphs = (txt = '') =>
    txt
      .replace(/\r\n/g, '\n')
      .split(/\n\s*\n|\n/)
      .filter((p) => p.trim().length > 0).length;

  const oldParaCount = countParagraphs(leftPage.text);
  const newParaCount = countParagraphs(rightPage.text);

  if (pages.length < 2) {
    return (
      <div className="sketch-card bg-white p-8 text-center space-y-4">
        <div className="text-lg font-bold text-[#1B4332]">
          아직 고쳐 쓴 글(2차 이상 수정본)이 제출되지 않았어요
        </div>
        <p className="text-sm text-[#64748B]">
          선생님의 첨삭을 보고 글을 고쳐 제출하면, 차수별로 글을 넘겨 보며 비교할 수 있어요!
        </p>
        {leftPage.text && (
          <div className="mt-4 p-6 rounded-2xl lined-paper border border-[#CBD5E1] text-left font-editorial-serif text-lg sm:text-[19.5px] text-[#1E293B] whitespace-pre-wrap leading-8">
            {leftPage.text}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 상단 안내 & 다회차(1차·2차·3차·4차...) 페이지 넘김 및 초록 글씨 토글 바 */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-[#F2F9F5] border border-[#B7E4C7] rounded-2xl px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#1B4332] text-white flex items-center justify-center shrink-0">
            <HandDrawnDiffIcon size={22} color="#FFFFFF" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base sm:text-lg font-bold text-[#1B4332]">
                {leftPage.label} vs {rightPage.label} 나란히 비교
              </span>
              {topicTitle && (
                <span className="text-xs font-semibold text-[#2D6A4F] bg-white px-2.5 py-0.5 rounded-full border border-[#B7E4C7]">
                  {topicTitle}
                </span>
              )}
              <span className="px-2.5 py-0.5 rounded-full bg-[#1B4332] text-white text-xs font-bold">
                총 {pages.length}차 작성됨
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs sm:text-sm text-[#2D6A4F] mt-0.5 flex-wrap">
              <span>
                글자 수: <strong>{diffResult.stats.oldLength}자 → {diffResult.stats.newLength}자</strong> (
                {diffResult.stats.charDiff >= 0
                  ? `+${diffResult.stats.charDiff}자 더 풍성해짐`
                  : `${Math.abs(diffResult.stats.charDiff)}자 다듬음`}
                )
              </span>
              {showGreenText && (
                <span className="font-bold text-[#15803D]">
                  * 초록색 글씨 = 고치며 새로 더한 표현
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 오른쪽 컨트롤: 차수 페이지 넘김 + 초록 글씨 표시 토글 */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* 3차, 4차 이상일 때 원하는 차수끼리 바로 넘겨 보는 페이지 버튼 */}
          <div className="inline-flex items-center gap-1 rounded-xl bg-white border border-[#CBD5E1] px-2.5 py-1.5 text-xs font-bold text-[#1B4332]">
            <button
              type="button"
              disabled={rightIdx <= 1}
              onClick={() => {
                const nextRight = Math.max(1, rightIdx - 1);
                setRightIdx(nextRight);
                setLeftIdx(nextRight - 1);
              }}
              className="p-1 rounded hover:bg-[#F2F9F5] disabled:opacity-35 cursor-pointer"
              title="이전 차수 비교"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <select
              value={leftIdx}
              onChange={(e) => setLeftIdx(Number(e.target.value))}
              className="bg-transparent font-bold text-[#1B4332] focus:outline-none cursor-pointer px-1"
            >
              {pages.map((p, idx) => (
                <option key={p.round} value={idx}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="text-[#64748B] px-1">→</span>
            <select
              value={rightIdx}
              onChange={(e) => setRightIdx(Number(e.target.value))}
              className="bg-transparent font-bold text-[#1B4332] focus:outline-none cursor-pointer px-1"
            >
              {pages.map((p, idx) => (
                <option key={p.round} value={idx}>
                  {p.label} {idx === pages.length - 1 ? '(최신)' : ''}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={rightIdx >= pages.length - 1}
              onClick={() => {
                const nextRight = Math.min(pages.length - 1, rightIdx + 1);
                setRightIdx(nextRight);
                setLeftIdx(nextRight - 1);
              }}
              className="p-1 rounded hover:bg-[#F2F9F5] disabled:opacity-35 cursor-pointer"
              title="다음 차수 비교"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {pages.length >= 3 && (
            <button
              type="button"
              onClick={() => {
                setLeftIdx(0);
                setRightIdx(pages.length - 1);
              }}
              className="px-3 py-2 rounded-xl bg-white border border-[#CBD5E1] hover:border-[#1B4332] text-xs font-bold text-[#1B4332] cursor-pointer"
            >
              1차 ↔ 최종({pages.length}차) 비교
            </button>
          )}

          {/* [핵심] 초록 글씨 표시 ON / OFF 스위치 (박스 없이 깔끔한 초록 글씨만!) */}
          <button
            type="button"
            onClick={() => setShowGreenText((prev) => !prev)}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition cursor-pointer ${
              showGreenText
                ? 'bg-[#1B4332] text-white border-[#1B4332]'
                : 'bg-white text-[#475569] border-[#CBD5E1] hover:border-[#1B4332]'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>
              {showGreenText ? '추가된 표현 초록 글씨: 켜짐' : '추가된 표현 초록 글씨: 꺼짐 (순수 완성본)'}
            </span>
          </button>
        </div>
      </div>

      {/* 양옆 나란히 비교 (학생 공책과 100% 동일한 19.5px 큼직한 글씨 크기 & 문단 보존) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* 왼쪽: 기준 차수 글 */}
        <div className="sketch-card p-6 sm:p-7 bg-[#FBFBF9] flex flex-col">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#CBD5E1]">
            <span className="text-base font-bold text-[#475569]">
              {leftPage.label} {leftIdx === 0 ? '(처음 쓴 글)' : ''}
            </span>
            <div className="flex items-center gap-2 text-xs font-bold text-[#64748B]">
              <span className="px-2.5 py-1 rounded-full bg-white border border-[#CBD5E1]">
                {oldParaCount}개 문단
              </span>
              <span className="px-2.5 py-1 rounded-full bg-white border border-[#CBD5E1]">
                {diffResult.stats.oldLength}자
              </span>
            </div>
          </div>

          <div className="flex-1 lined-paper p-5 sm:p-6 rounded-2xl border border-[#E2E8F0] font-editorial-serif text-lg sm:text-[19.5px] leading-8 text-[#334155] whitespace-pre-wrap">
            {renderTextWithHighlight(leftPage.text, '')}
          </div>
        </div>

        {/* 오른쪽: 비교 대상 차수 글 (초록 박스 없이 깔끔한 초록 글씨로만 추가 표현 표시!) */}
        <div className="sketch-card p-6 sm:p-7 bg-white border-2 border-[#1B4332] flex flex-col">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#B7E4C7]">
            <span className="text-base font-bold text-[#1B4332] flex items-center gap-1.5">
              <HandDrawnLeafIcon size={17} color="#1B4332" />
              <span>
                {rightPage.label} {rightIdx === pages.length - 1 ? '(최신 완성본)' : ''}
              </span>
            </span>
            <div className="flex items-center gap-2 text-xs font-bold text-[#1B4332]">
              <span className="px-2.5 py-1 rounded-full bg-[#F2F9F5] border border-[#52B788]">
                {newParaCount}개 문단
              </span>
              <span className="px-2.5 py-1 rounded-full bg-[#F2F9F5] border border-[#52B788]">
                {diffResult.stats.newLength}자
              </span>
            </div>
          </div>

          <div className="flex-1 lined-paper p-5 sm:p-6 rounded-2xl border border-[#B7E4C7] font-editorial-serif text-lg sm:text-[19.5px] leading-8 text-[#1E293B] whitespace-pre-wrap">
            {showGreenText
              ? renderTextWithGreenAdditions(leftPage.text, rightPage.text, '')
              : renderTextWithHighlight(rightPage.text, '')}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 화면 전체(96vw)를 시원하게 쓰는 초대형 나란히 비교 모달
 */
export function GrowthDiffModal({ isOpen, onClose, student, topicTitle = '' }) {
  if (!isOpen || !student) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <div className="w-[96vw] max-w-7xl sketch-card bg-[#FBFBF9] p-6 sm:p-8 my-6 max-h-[92dvh] overflow-y-auto">
        <div className="flex items-center justify-between pb-4 mb-5 border-b border-[#CBD5E1]">
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-xl bg-[#1B4332] text-white text-sm font-bold">
              {student.number}번 {student.name}
            </span>
            <h2 className="text-lg sm:text-xl font-bold text-[#1B4332]">
              글쓰기 성장 비교
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl bg-white border border-[#CBD5E1] text-xs sm:text-sm font-bold text-[#475569] hover:text-[#1E293B] flex items-center gap-1.5 cursor-pointer"
          >
            <X className="w-4 h-4" />
            <span>닫기</span>
          </button>
        </div>

        <GrowthDiffView student={student} topicTitle={topicTitle} />
      </div>
    </div>
  );
}
