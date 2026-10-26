import React, { useState, useEffect, useRef } from 'react';
import {
  HandDrawnNotebookLogo,
  HandDrawnPencilIcon,
  HandDrawnDiffIcon,
  HandDrawnChatIcon,
  HandDrawnSparkleIcon,
  HandDrawnCheckIcon,
  HandDrawnLeafIcon,
  HandDrawnArrowRightIcon
} from './HandDrawnIcons';
import { GrowthDiffModal } from './GrowthDiffView';
import {
  STAGE_META,
  renderTextWithHighlight,
  renderTextWithGreenAdditions,
  getStudentDraftPages,
  isFinalWritingStatus
} from '../utils/diffHelper';
import {
  Send,
  LogOut,
  AlertCircle,
  BookOpen,
  CornerDownLeft,
  ArrowLeft,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

export default function StudentStudio({
  topics,
  students,
  questions,
  config,
  activeStudent,
  isTeacherPreview = false,
  initialTopicId = '',
  onLoginStudent,
  onLogoutStudent,
  onSubmitStage,
  onAddQuestion
}) {
  const [loginNumber, setLoginNumber] = useState('');
  const [loginName, setLoginName] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isEntering, setIsEntering] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isQuestionSubmitting, setIsQuestionSubmitting] = useState(false);

  // null이면 [내 글쓰기 책장] 화면, 값이 있으면 해당 [주제 공책 글쓰기] 화면!
  const [openedTopicId, setOpenedTopicId] = useState(null);

  // 오른쪽 첨삭 메모 클릭 시 왼쪽 본문에서 형광펜으로 보여줄 문장
  const [highlightedQuote, setHighlightedQuote] = useState('');
  // 대형 나란히 비교 모달 열림 상태
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);

  const [editorText, setEditorText] = useState('');
  const [pieceTitle, setPieceTitle] = useState('');
  const [questionInput, setQuestionInput] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [showGreenText, setShowGreenText] = useState(false);
  const [viewingPageIdx, setViewingPageIdx] = useState(null); // null이면 현재 작성·수정 공책, 숫자면 해당 차수 글 보기
  const textareaRef = useRef(null);
  const questionSubmittingRef = useRef(false);

  const currentStudent =
    students.find((s) => String(s.number) === String(activeStudent?.number)) ||
    activeStudent;

  // 학생은 책장부터, 교사 미리보기는 선택한 주제 공책부터 바로 보여줍니다.
  useEffect(() => {
    setOpenedTopicId(isTeacherPreview && initialTopicId ? initialTopicId : null);
  }, [currentStudent?.number, isTeacherPreview, initialTopicId]);

  // 특정 주제에 대한 이 학생의 글 데이터 가져오기 헬퍼
  const getStudentDataForTopic = (topic) => {
    if (!currentStudent || !topic) return null;
    const isCurrentActive = topic.id === (config.activeTopicId || 'TOPIC_1');
    if (isCurrentActive) return currentStudent;
    const past = currentStudent.historyByTopic?.[topic.id];
    return {
      ...currentStudent,
      status: past?.status || 'STAGE_1_WRITING',
      pieceTitle: past?.pieceTitle || '',
      draft1: past?.draft1 || '',
      draft2: past?.draft2 || '',
      draft3: past?.draft3 || '',
      draft4: past?.draft4 || '',
      draftHistory: past?.draftHistory || [],
      teacherNote: past?.teacherNote || '',
      feedbackItems: past?.feedbackItems || [],
      locked: Boolean(past?.locked) || Boolean(topic.classLocked)
    };
  };

  const selectedTopic = topics.find((t) => t.id === openedTopicId) || null;
  const topicStudentData = getStudentDataForTopic(selectedTopic);
  const draftPages = getStudentDraftPages(topicStudentData);
  const displayPieceTitle = String(
    pieceTitle || topicStudentData?.pieceTitle || ''
  ).trim();

  const myQuestions = questions.filter(
    (q) =>
      String(q.number) === String(currentStudent?.number) &&
      (!selectedTopic?.id || !q.topicId || q.topicId === selectedTopic.id)
  );

  const feedbackItems = topicStudentData?.feedbackItems || [];

  const currentWritingStage = Math.max(1, draftPages.length + 1);

  useEffect(() => {
    if (!topicStudentData) return;
    setHighlightedQuote('');
    setShowGreenText(false);
    setViewingPageIdx(null);
    const pages = getStudentDraftPages(topicStudentData);
    const latest = pages.length > 0 ? pages[pages.length - 1].text : '';
    setPieceTitle(topicStudentData.pieceTitle || '');
    setEditorText(
      latest ||
        topicStudentData.draft3 ||
        topicStudentData.draft2 ||
        topicStudentData.draft1 ||
        ''
    );
  }, [currentStudent?.number, openedTopicId, topicStudentData?.status, topicStudentData?.pieceTitle]);

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLoginError('');
    setIsEntering(true);
    try {
      const result = await onLoginStudent({
        number: loginNumber.trim(),
        name: loginName.trim()
      });
      if (!result?.ok) {
        setLoginError(result?.error || '번호와 이름을 다시 확인해 주세요.');
      }
    } finally {
      setIsEntering(false);
    }
  };

  const handleInsertParagraph = () => {
    setHighlightedQuote('');
    const el = textareaRef.current;
    if (!el) {
      setEditorText((prev) => prev + '\n\n  ');
      return;
    }
    const start = el.selectionStart ?? editorText.length;
    const end = el.selectionEnd ?? editorText.length;
    const nextText =
      editorText.substring(0, start) + '\n\n  ' + editorText.substring(end);
    setEditorText(nextText);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + 4, start + 4);
    }, 20);
  };

  const handleStageSubmit = async () => {
    if (isTeacherPreview) return;
    if (!pieceTitle.trim()) {
      showToast('작품 제목을 먼저 지어 주세요.');
      return;
    }
    if (!editorText.trim()) {
      showToast('글을 먼저 작성해 주세요.');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await onSubmitStage(
        currentStudent.number,
        currentWritingStage,
        editorText,
        selectedTopic.id,
        pieceTitle.trim()
      );
      showToast(
        result?.ok
          ? '선생님께 내 글을 제출했어요!'
          : result?.error || '제출하지 못했습니다. 다시 시도해 주세요.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuestionSubmit = async (e) => {
    e.preventDefault();
    if (isTeacherPreview) return;
    const cleanQuestion = questionInput.trim();
    if (!cleanQuestion || questionSubmittingRef.current) return;
    questionSubmittingRef.current = true;
    setIsQuestionSubmitting(true);
    try {
      const result = await onAddQuestion({
        number: currentStudent.number,
        name: currentStudent.name,
        topicId: selectedTopic?.id || '',
        source: '학생 질문',
        quote: '',
        question: cleanQuestion
      });
      if (result?.ok) {
        setQuestionInput('');
        showToast('선생님께 질문을 보냈어요!');
      } else {
        showToast(result?.error || '질문을 보내지 못했습니다. 다시 시도해 주세요.');
      }
    } finally {
      questionSubmittingRef.current = false;
      setIsQuestionSubmitting(false);
    }
  };

  // ============================================================================
  // 화면 1: 학생 간편 입장 화면 (번호 + 이름)
  // ============================================================================
  if (!currentStudent) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg sketch-card bg-white p-8 sm:p-10">
          <div className="flex flex-col items-center text-center">
            <HandDrawnNotebookLogo size={64} isOpen={true} />
            <div className="mt-3 px-3 py-1 rounded-full bg-[#F2F9F5] border border-[#B7E4C7] text-xs font-bold text-[#1B4332]">
              {config.className || '우리 반 글쓰기 스튜디오'}
            </div>
            <h1 className="mt-3 text-2xl sm:text-3xl font-bold text-[#1B4332] font-editorial-serif">
              내 글쓰기 책장 열기
            </h1>
            <p className="mt-1.5 text-sm text-[#64748B]">
              출석 번호와 이름을 입력하면 나의 글쓰기 책장으로 들어갑니다.
            </p>
          </div>

          <form onSubmit={handleLoginSubmit} className="mt-7 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-[#1B4332] mb-1.5">
                  출석 번호
                </label>
                <input
                  type="number"
                  min="1"
                  max="99"
                  value={loginNumber}
                  onChange={(e) => setLoginNumber(e.target.value)}
                  placeholder="2"
                  className="w-full h-13 px-3 rounded-xl border border-[#CBD5E1] bg-[#FBFBF9] text-lg font-bold text-center text-[#1E293B] focus:outline-none focus:border-[#1B4332]"
                  required
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-bold text-[#1B4332] mb-1.5">
                  이름
                </label>
                <input
                  type="text"
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value)}
                  placeholder="이도윤"
                  className="w-full h-13 px-4 rounded-xl border border-[#CBD5E1] bg-[#FBFBF9] text-lg font-bold text-[#1E293B] focus:outline-none focus:border-[#1B4332]"
                  required
                />
              </div>
            </div>

            {loginError && (
              <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs font-medium text-[#DC2626] flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isEntering}
              className="w-full h-14 sketch-btn-primary text-base font-bold flex items-center justify-center gap-2"
            >
              <HandDrawnPencilIcon size={20} color="#FFFFFF" />
              <span>{isEntering ? '내 공책을 확인하고 있어요...' : '내 글쓰기 책장 들어가기'}</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ============================================================================
  // 화면 2: 학생 전용 『나의 글쓰기 주제 책장』 (책장에서 공책 하나를 골라 들어가는 화면!)
  // ============================================================================
  if (!selectedTopic) {
    return (
      <div className="flex-1 w-full px-6 lg:px-12 py-8 space-y-6">
        {/* 책장 상단 환영 헤더 */}
        <div className="sketch-card bg-white px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-[#1B4332] text-white flex items-center justify-center font-bold text-base shrink-0">
              {currentStudent.number}번
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold text-[#1B4332] font-editorial-serif">
                  {currentStudent.name} 어린이의 글쓰기 책장
                </h1>
                <span className="px-2.5 py-0.5 rounded-full bg-[#F2F9F5] border border-[#B7E4C7] text-xs font-bold text-[#1B4332]">
                  총 {topics.length}권의 공책
                </span>
              </div>
              <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">
                오늘 글을 쓸 주제 공책이나, 내가 그동안 썼던 지난 공책을 책장에서 골라 펼쳐 보세요!
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onLogoutStudent}
            className="sketch-btn-secondary px-4 py-2.5 text-xs sm:text-sm font-bold flex items-center gap-1.5 self-start sm:self-auto"
          >
            <LogOut className="w-4 h-4" />
            <span>{isTeacherPreview ? '선생님 관리로 돌아가기' : '다른 번호로 입장하기'}</span>
          </button>
        </div>

        {/* 책장 그리드 (주제별 공책 카드) */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {topics.map((tp, idx) => {
            const stData = getStudentDataForTopic(tp);
            const meta = STAGE_META[stData?.status] || STAGE_META.STAGE_1_WRITING;
            const hasFeedback =
              Boolean(stData?.teacherNote) || (stData?.feedbackItems || []).length > 0;

            return (
              <div
                key={tp.id}
                onClick={() => setOpenedTopicId(tp.id)}
                className={`sketch-card sketch-card-hover p-6 flex flex-col justify-between cursor-pointer transition relative overflow-hidden ${
                  tp.isActive
                    ? 'bg-white border-2 border-[#1B4332]'
                    : 'bg-[#FBFBF9] border-[#CBD5E1]'
                }`}
              >
                {/* 왼쪽 공책 제본 띠 장식 */}
                <div
                  className={`absolute left-0 top-0 bottom-0 w-2.5 ${
                    tp.isActive ? 'bg-[#1B4332]' : 'bg-[#52B788]'
                  }`}
                />

                <div className="pl-3 space-y-3">
                  {/* 상단 배지 줄 */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      {tp.isActive ? (
                        <span className="px-2.5 py-0.5 rounded-full bg-[#1B4332] text-white text-xs font-bold">
                          오늘의 글쓰기 주제
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full bg-white border border-[#CBD5E1] text-[#64748B] text-xs font-semibold">
                          지난 공책 · {tp.createdAt}
                        </span>
                      )}
                      {hasFeedback && (
                        <span className="px-2.5 py-0.5 rounded-full bg-[#FEF3C7] border border-[#F59E0B] text-[#92400E] text-xs font-bold">
                          선생님 첨삭 도착!
                        </span>
                      )}
                    </div>

                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${meta.badgeBg} ${meta.badgeBorder} ${meta.badgeText}`}
                    >
                      {meta.shortLabel}
                    </span>
                  </div>

                  {/* 공책 제목 및 안내문 */}
                  <div className="py-2">
                    <h2 className="text-lg sm:text-xl font-bold text-[#1B4332] font-editorial-serif leading-snug">
                      {tp.title}
                    </h2>
                    <p className="text-xs sm:text-sm text-[#475569] mt-2 line-clamp-2 leading-relaxed">
                      {tp.prompt}
                    </p>
                  </div>
                </div>

                {/* 하단 공책 펼치기 버튼 */}
                <div className="pl-3 mt-5 pt-3.5 border-t border-[#E2E8F0] flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#64748B]">
                    {tp.createdAt}
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-[#1B4332] inline-flex items-center gap-1.5 group-hover:underline">
                    <span>이 공책 펼치기</span>
                    <HandDrawnArrowRightIcon size={15} color="#1B4332" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ============================================================================
  // 화면 3: 책장에서 선택한 주제의 『와이드 글쓰기 공책 화면』
  // ============================================================================
  const isLocked = Boolean(topicStudentData?.locked) || Boolean(selectedTopic?.classLocked);
  const isReadOnly = isTeacherPreview || isLocked;
  const isFinalCompleted = isFinalWritingStatus(topicStudentData?.status);
  const hasRevision = draftPages.length >= 2;
  const activeDisplayText =
    viewingPageIdx !== null && draftPages[viewingPageIdx]
      ? draftPages[viewingPageIdx].text
      : editorText;
  const prevComparisonText =
    viewingPageIdx !== null
      ? viewingPageIdx > 0
        ? draftPages[viewingPageIdx - 1]?.text || ''
        : ''
      : draftPages.length > 0
      ? draftPages[0].text
      : '';

  const paragraphCount = activeDisplayText
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n|\n/)
    .filter((p) => p.trim().length > 0).length;

  return (
    <div className="flex-1 w-full px-6 lg:px-10 py-5 flex flex-col gap-4">
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-2xl bg-[#1B4332] text-white px-5 py-3 shadow-lg flex items-center gap-2 text-sm font-bold">
          <HandDrawnCheckIcon size={18} color="#52B788" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 상단 바: [← 내 글쓰기 책장으로] + 현재 공책 제목 + [처음 글과 크게 비교하기] */}
      <div className="w-full flex items-center justify-between gap-4 flex-wrap bg-white border border-[#CBD5E1] rounded-2xl px-5 py-3.5 shadow-2xs">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => {
              if (isTeacherPreview) onLogoutStudent();
              else setOpenedTopicId(null);
            }}
            className="sketch-btn-secondary px-3.5 py-2 text-xs sm:text-sm font-bold flex items-center gap-1.5 shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{isTeacherPreview ? '선생님 관리로 돌아가기' : '내 글쓰기 책장으로'}</span>
          </button>

          <span className="px-3 py-1 rounded-xl bg-[#1B4332] text-white text-xs sm:text-sm font-bold shrink-0">
            {currentStudent.number}번 {currentStudent.name}
          </span>

          <h1 className="text-base sm:text-lg font-bold text-[#1E293B] truncate font-editorial-serif">
            {selectedTopic.title}
          </h1>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {isTeacherPreview && (
            <span className="px-3 py-1.5 rounded-xl bg-[#FEF3C7] border border-[#F59E0B] text-xs font-bold text-[#92400E] flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5" />
              교사 읽기 전용
            </span>
          )}
          <button
            type="button"
            onClick={() => setIsDiffModalOpen(true)}
            className="sketch-btn-secondary px-4 py-2 text-xs sm:text-sm font-bold flex items-center gap-2"
          >
            <HandDrawnDiffIcon size={16} color="#1B4332" />
            <span>처음 쓴 글 · 고쳐 쓴 글 크게 비교하기</span>
            {hasRevision && (
              <span className="px-2 py-0.5 rounded-full bg-[#D8F3DC] text-[#1B4332] text-[11px] font-bold">
                총 {draftPages.length}차 작성
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 메인 와이드 2단 영역 (왼쪽 8칸: 내 원고지 / 오른쪽 4칸: 선생님 첨삭) */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* 왼쪽 (8칸 - 시원하고 넓은 원고지 책상 + 다회차 페이지 넘김 + 초록 글씨 비교) */}
        <div className="lg:col-span-7 xl:col-span-8 sketch-card bg-white p-6 sm:p-8 flex flex-col justify-between">
          <div className="flex-1 flex flex-col">
            <div className="flex items-center justify-between gap-2 pb-3 mb-3 border-b border-[#E2E8F0] flex-wrap">
              {/* 왼쪽: 내가 쓰는 글 + 문단·글자수 + [고친 표현 초록 글씨로 보기] 버튼 */}
              <div className="flex items-center gap-2 flex-wrap">
                <HandDrawnPencilIcon size={20} color="#1B4332" />
                <h2 className="text-lg font-bold text-[#1B4332]">내가 쓰는 글</h2>
                <span className="px-2.5 py-0.5 rounded-full bg-[#F8FAFC] border border-[#CBD5E1] text-xs font-bold text-[#475569]">
                  {paragraphCount}개 문단 · {activeDisplayText.trim().length}자
                </span>

                {prevComparisonText && prevComparisonText.trim() !== activeDisplayText.trim() && (
                  <button
                    type="button"
                    onClick={() => setShowGreenText((prev) => !prev)}
                    className={`px-3 py-1 rounded-xl text-xs font-bold border transition cursor-pointer ${
                      showGreenText
                        ? 'bg-[#15803D] text-white border-[#15803D]'
                        : 'bg-white text-[#15803D] border-[#86EFAC] hover:border-[#15803D]'
                    }`}
                  >
                    {showGreenText ? '초록 글씨 표시: 켜짐' : '고친 표현 초록 글씨로 보기'}
                  </button>
                )}
              </div>

              {/* 오른쪽: [1차 글 | 2차 글 | 3차 글...] 페이지 넘김 탭 (흐름이 끊기지 않게 한 덩어리로 배치) */}
              <div className="flex items-center gap-2 flex-wrap">
                {draftPages.length > 0 && (
                  <div className="inline-flex items-center gap-1 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl p-1">
                    {draftPages.map((pg, idx) => (
                      <button
                        key={pg.round}
                        type="button"
                        onClick={() => setViewingPageIdx(idx)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                          viewingPageIdx === idx
                            ? 'bg-[#1B4332] text-white'
                            : 'text-[#475569] hover:text-[#1B4332]'
                        }`}
                      >
                        {pg.label}
                        {idx === draftPages.length - 1
                          ? isFinalCompleted
                            ? ' · 최종 완성본'
                            : ' · 최신 수정본'
                          : ''}
                      </button>
                    ))}
                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={() => {
                          setViewingPageIdx(null);
                          setShowGreenText(false);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                          viewingPageIdx === null
                            ? 'bg-[#1B4332] text-white'
                            : 'text-[#1B4332] hover:bg-[#D8F3DC]'
                        }`}
                      >
                        고쳐 쓰기 공책
                      </button>
                    )}
                  </div>
                )}

                {highlightedQuote ? (
                  <button
                    type="button"
                    onClick={() => setHighlightedQuote('')}
                    className="sketch-btn-primary px-3.5 py-1.5 text-xs font-bold flex items-center gap-1.5"
                  >
                    <HandDrawnPencilIcon size={14} color="#FFFFFF" />
                    <span>형광펜 끄고 계속 고쳐 쓰기</span>
                  </button>
                ) : (
                  !isReadOnly &&
                  viewingPageIdx === null &&
                  !showGreenText && (
                    <button
                      type="button"
                      onClick={handleInsertParagraph}
                      className="px-3 py-1.5 rounded-xl bg-[#F2F9F5] border border-[#52B788] text-xs font-bold text-[#1B4332] hover:bg-[#D8F3DC] flex items-center gap-1.5 cursor-pointer"
                    >
                      <CornerDownLeft className="w-3.5 h-3.5" />
                      <span>새 문단 나누기 (들여쓰기)</span>
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="text-xs sm:text-sm text-[#2D6A4F] mb-3 bg-[#F2F9F5] px-4 py-2.5 rounded-xl border border-[#B7E4C7] font-medium">
              안내: {selectedTopic.prompt}
            </div>

            <div
              className={`flex-1 min-h-[460px] w-full lined-paper p-5 sm:p-6 rounded-2xl border font-editorial-serif text-[#1E293B] ${
                highlightedQuote || showGreenText || viewingPageIdx !== null
                  ? 'border-2 border-[#52B788]'
                  : 'border-[#CBD5E1] focus-within:border-[#1B4332]'
              }`}
            >
              {!isReadOnly && viewingPageIdx === null && !highlightedQuote && !showGreenText ? (
                <input
                  type="text"
                  value={pieceTitle}
                  onChange={(e) => setPieceTitle(e.target.value)}
                  maxLength={50}
                  aria-label="작품 제목"
                  placeholder="제목을 써주세요"
                  className="w-full bg-transparent border-0 border-b border-dashed border-[#94A3B8] px-2 pb-2 text-center text-xl sm:text-2xl font-bold font-editorial-serif text-[#1E293B] placeholder:text-[#94A3B8]/70 placeholder:font-normal focus:outline-none focus:border-[#1B4332]"
                />
              ) : (
                <h3
                  className={`px-2 pb-2 text-center text-xl sm:text-2xl font-editorial-serif ${
                    displayPieceTitle
                      ? 'font-bold text-[#1E293B]'
                      : 'font-normal text-[#94A3B8]/70'
                  }`}
                >
                  {displayPieceTitle || '제목을 써주세요'}
                </h3>
              )}
              <div className="mt-3 mb-8 pr-[10%] text-right text-lg sm:text-[19.5px] leading-8 font-semibold text-[#475569]">
                {currentStudent.name}
              </div>

              {highlightedQuote || showGreenText || viewingPageIdx !== null ? (
                <div
                  onClick={() => {
                    if (!isReadOnly) {
                      setHighlightedQuote('');
                      setShowGreenText(false);
                      setViewingPageIdx(null);
                    }
                  }}
                  className="min-h-[330px] text-lg sm:text-[19.5px] whitespace-pre-wrap leading-8 cursor-text"
                >
                  <div className="mb-3 flex items-center justify-between bg-[#F2F9F5] border border-[#B7E4C7] px-3.5 py-2 rounded-xl text-xs font-bold text-[#1B4332]">
                    <span>
                      {highlightedQuote
                        ? '선생님이 첨삭해 주신 문장에 노란 형광펜이 켜졌어요!'
                        : showGreenText
                        ? '고치며 새로 추가한 표현이 초록색 글씨로 표시되었어요!'
                        : `${draftPages[viewingPageIdx]?.label || '이전 차수'}을 보고 있어요.`}
                      {!isReadOnly ? ' (공책을 클릭하면 바로 이어서 고쳐 쓸 수 있어요)' : ''}
                    </span>
                  </div>
                  {showGreenText
                    ? renderTextWithGreenAdditions(
                        prevComparisonText,
                        activeDisplayText,
                        highlightedQuote
                      )
                    : renderTextWithHighlight(activeDisplayText, highlightedQuote)}
                </div>
              ) : (
                <textarea
                  ref={textareaRef}
                  value={editorText}
                  onChange={(e) => setEditorText(e.target.value)}
                  disabled={isReadOnly}
                  placeholder="여기에 글을 시작해 주세요."
                  className="min-h-[330px] w-full bg-transparent border-0 p-0 focus:outline-none font-editorial-serif text-lg sm:text-[19.5px] text-[#1E293B] resize-none leading-8 whitespace-pre-wrap disabled:opacity-75 disabled:cursor-not-allowed"
                />
              )}
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-[#E2E8F0] flex items-center justify-between gap-4 flex-wrap">
            <span className="text-xs text-[#64748B]">
              * 오른쪽의 첨삭 메모를 클릭하면 내 글의 어느 문장인지 노란 형광펜으로 보여줍니다.
            </span>

            {isTeacherPreview ? (
              <div className="py-3.5 px-6 rounded-xl bg-[#FEF3C7] border border-[#F59E0B] text-sm font-bold text-[#92400E] flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                <span>교사 미리보기에서는 학생 공책을 읽기만 할 수 있습니다</span>
              </div>
            ) : isFinalCompleted ? (
              <div className="py-3.5 px-6 rounded-xl bg-[#D8F3DC] border border-[#1B4332] text-sm font-bold text-[#1B4332] flex items-center gap-2">
                <HandDrawnCheckIcon size={18} color="#1B4332" />
                <span>선생님이 최종 완성본으로 확인했어요.</span>
              </div>
            ) : isLocked ? (
              <div className="py-3.5 px-6 rounded-xl bg-[#F2F9F5] border border-[#52B788] text-sm font-bold text-[#1B4332] flex items-center gap-2">
                <HandDrawnCheckIcon size={18} color="#1B4332" />
                <span>최신 수정본을 제출했어요. 선생님의 확인을 기다리고 있어요.</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleStageSubmit}
                disabled={isSubmitting}
                className="w-full sm:w-auto min-w-[260px] h-14 px-8 sketch-btn-primary text-base font-bold flex items-center justify-center gap-2"
              >
                <HandDrawnCheckIcon size={20} color="#FFFFFF" />
                <span>
                  {isSubmitting
                    ? '안전하게 제출하고 있어요...'
                    : currentWritingStage === 1
                    ? '다 썼어요! 선생님께 제출하기'
                    : `${currentWritingStage}차 수정 완료! 다시 제출하기`}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* 오른쪽 (4칸 - 선생님의 다정한 첨삭 & 클릭 시 본문 형광펜 연동) */}
        <div className="lg:col-span-5 xl:col-span-4 sketch-card bg-[#FBFBF9] p-6 sm:p-7 flex flex-col justify-between gap-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#CBD5E1]">
              <div className="flex items-center gap-2">
                <HandDrawnSparkleIcon size={20} color="#1B4332" />
                <h2 className="text-lg font-bold text-[#1B4332]">
                  선생님의 다정한 첨삭
                </h2>
              </div>
              {feedbackItems.length > 0 && (
                <span className="text-xs font-semibold text-[#2D6A4F]">
                  메모를 누르면 형광펜이 켜져요
                </span>
              )}
            </div>

            {!topicStudentData?.teacherNote && feedbackItems.length === 0 ? (
              <div className="py-16 px-6 text-center rounded-2xl bg-white border border-[#E2E8F0] space-y-2">
                <p className="text-base font-bold text-[#475569]">
                  아직 도착한 첨삭이 없어요
                </p>
                <p className="text-sm text-[#64748B] leading-relaxed">
                  왼쪽 공책에 글을 쓰고 [제출하기]를 누르면, 선생님이 내 글을 읽고 여기에 다정한 조언을 적어 주실 거예요!
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {topicStudentData?.teacherNote && (
                  <div className="p-5 rounded-2xl bg-white border-2 border-[#1B4332] text-sm sm:text-[15px] text-[#1E293B] leading-relaxed whitespace-pre-wrap shadow-2xs">
                    <div className="font-bold text-[#1B4332] pb-2 mb-2.5 border-b border-[#D8F3DC] flex items-center gap-1.5">
                      <HandDrawnSparkleIcon size={16} color="#1B4332" />
                      <span>선생님의 종합 첨삭 노트</span>
                    </div>
                    {topicStudentData.teacherNote}
                  </div>
                )}

                {feedbackItems.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="text-xs font-bold text-[#2D6A4F] px-1">
                      문장별 부분 첨삭 (클릭하면 내 글에서 노란 형광펜으로 보여요)
                    </div>
                    {feedbackItems.map((item, idx) => {
                      const isHighlighted =
                        highlightedQuote && highlightedQuote === item.quote;

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            if (!item.quote) return;
                            setHighlightedQuote(isHighlighted ? '' : item.quote);
                          }}
                          className={`w-full text-left p-4 rounded-2xl bg-white border transition space-y-2 cursor-pointer ${
                            isHighlighted
                              ? 'border-2 border-[#F59E0B] shadow-sm'
                              : 'border-[#CBD5E1] hover:border-[#1B4332] shadow-2xs'
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs font-bold text-[#2D6A4F]">
                            <span>부분 첨삭 {idx + 1}</span>
                            {item.quote && (
                              <span className="px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E] text-[11px]">
                                {isHighlighted ? '형광펜 켜짐' : '클릭해서 위치 보기'}
                              </span>
                            )}
                          </div>

                          {item.quote && (
                            <div className="inline-block text-xs sm:text-sm font-bold text-[#92400E] bg-[#FEF08A]/85 px-3 py-1 rounded-xl font-editorial-serif">
                              "{item.quote}"
                            </div>
                          )}
                          <p className="text-sm text-[#1E293B] bg-white leading-relaxed font-medium pl-1">
                            → {item.comment}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 하단 고정: 선생님께 궁금한 점 물어보기 */}
          <div className="pt-4 border-t border-[#CBD5E1] space-y-3">
            <div className="flex items-center gap-1.5 text-sm font-bold text-[#1B4332]">
              <HandDrawnChatIcon size={16} color="#1B4332" />
              <span>선생님께 궁금한 점 물어보기</span>
            </div>

            {myQuestions.length > 0 && (
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {myQuestions.map((q) => (
                  <div
                    key={q.id}
                    className="p-3 rounded-xl bg-white border border-[#E2E8F0] text-xs sm:text-sm space-y-1.5"
                  >
                    <div className="font-semibold text-[#1E293B]">나: {q.question}</div>
                    {q.reply ? (
                      <div className="text-[#1B4332] font-bold bg-[#F2F9F5] px-2.5 py-1.5 rounded-lg">
                        선생님: {q.reply}
                      </div>
                    ) : (
                      <div className="text-xs text-[#94A3B8]">선생님 답변 기다리는 중...</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!isTeacherPreview && (
              <form onSubmit={handleQuestionSubmit} className="flex gap-2">
                <input
                  type="text"
                  value={questionInput}
                  onChange={(e) => setQuestionInput(e.target.value)}
                  placeholder="궁금한 점을 적어 보세요"
                  className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#CBD5E1] bg-white text-sm focus:outline-none focus:border-[#1B4332]"
                />
                <button
                  type="submit"
                  disabled={isQuestionSubmitting}
                  className="sketch-btn-secondary px-4 py-2.5 text-sm font-bold flex items-center gap-1.5 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                  <span>{isQuestionSubmitting ? '보내는 중' : '질문'}</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* [처음 쓴 글 · 고쳐 쓴 글 크게 비교하기] 화면 꽉 차는 대형 모달 */}
      <GrowthDiffModal
        isOpen={isDiffModalOpen}
        onClose={() => setIsDiffModalOpen(false)}
        student={topicStudentData}
        topicTitle={selectedTopic.title}
      />
    </div>
  );
}
