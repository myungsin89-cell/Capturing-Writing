import React, { useState, useEffect, useRef } from 'react';
import useStudentDraft from '../hooks/useStudentDraft';
import { getDraftBase, getDraftOwner } from '../utils/studentDraftStorage';
import DraftRecoveryDialog from './DraftRecoveryDialog';
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
  ChevronRight,
  Sparkles,
  History,
  Copy,
  Download
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
  onUnsubmitStage,
  onAddQuestion
}) {
  const [loginNumber, setLoginNumber] = useState('');
  const [loginName, setLoginName] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isEntering, setIsEntering] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUnsubmitting, setIsUnsubmitting] = useState(false);
  const [isQuestionSubmitting, setIsQuestionSubmitting] = useState(false);
  const [isEditingCompleted, setIsEditingCompleted] = useState(false);
  const [isRecalled, setIsRecalled] = useState(false);
  const [isSubmissionAccepted, setIsSubmissionAccepted] = useState(false);

  // null이면 [내 글쓰기 책장] 화면, 값이 있으면 해당 [주제 공책 글쓰기] 화면!
  const [openedTopicId, setOpenedTopicId] = useState(null);

  // 오른쪽 첨삭 메모 클릭 시 왼쪽 본문에서 형광펜으로 보여줄 문장
  const [highlightedQuote, setHighlightedQuote] = useState('');
  // 대형 나란히 비교 모달 열림 상태
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);

  const [questionInput, setQuestionInput] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [showGreenText, setShowGreenText] = useState(false);
  const [viewingPageIdx, setViewingPageIdx] = useState(null); // null이면 현재 작성·수정 공책, 숫자면 해당 차수 글 보기
  const [recoveryData, setRecoveryData] = useState(null);
  const textareaRef = useRef(null);
  const questionSubmittingRef = useRef(false);

  const currentStudent =
    students.find((s) => String(s.number) === String(activeStudent?.number)) ||
    activeStudent;

  // 학생은 책장부터, 교사 미리보기는 선택한 주제 공책부터 바로 보여줍니다.
  useEffect(() => {
    setOpenedTopicId(isTeacherPreview && initialTopicId ? initialTopicId : null);
  }, [currentStudent?.classId, currentStudent?.number, currentStudent?.name, isTeacherPreview, initialTopicId]);

  useEffect(() => {
    setIsSubmissionAccepted(false);
  }, [openedTopicId]);

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
  const draftBase = getDraftBase(topicStudentData || {});
  const canEditCompletedDraft = isFinalWritingStatus(topicStudentData?.status) && isEditingCompleted;
  const canEditDraft = Boolean(topicStudentData) && !isTeacherPreview && !isSubmissionAccepted &&
    (!selectedTopic?.classLocked || canEditCompletedDraft) && !isSubmitting &&
    ((!topicStudentData.locked && !isFinalWritingStatus(topicStudentData.status)) || Boolean(topicStudentData.recalled) ||
      canEditCompletedDraft);
  const draft = useStudentDraft({
    owner: getDraftOwner({ spreadsheetId: config.spreadsheetId || '', classId: config.activeClassId || '', student: currentStudent, topicId: openedTopicId }),
    base: draftBase, enabled: !isTeacherPreview && Boolean(topicStudentData), editable: canEditDraft,
    editingCompleted: isEditingCompleted, isCompleted: isFinalWritingStatus(topicStudentData?.status)
  });
  const { text: editorText, pieceTitle, setText: setEditorText, setPieceTitle } = draft;
  const lastSavedTime = draft.savedAt ? new Date(draft.savedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  const restoredBannerMsg = draft.notice;
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

  // 제출본/공책이 바뀔 때만 보기 상태를 초기화합니다. 입력 내용은 전용 저장 훅에서 복원합니다.
  useEffect(() => {
    if (!topicStudentData) return;
    setHighlightedQuote('');
    setShowGreenText(false);
    setViewingPageIdx(null);
    setIsEditingCompleted(Boolean(draft.loadState?.editingCompleted));
    setIsRecalled(Boolean(topicStudentData.recalled));
    setRecoveryData(null);
  }, [draft.loadState?.id, topicStudentData?.status, topicStudentData?.recalled]);

  // 재제출 응답이 잠금 상태까지 반영되면 임시 화면 잠금은 서버 상태에 넘깁니다.
  useEffect(() => {
    if (topicStudentData?.locked && !topicStudentData?.recalled) {
      setIsSubmissionAccepted(false);
    }
  }, [topicStudentData?.locked, topicStudentData?.recalled]);

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  const copyCurrentDraft = async () => {
    try { await navigator.clipboard.writeText(`${pieceTitle}\n\n${editorText}`); showToast('지금 글을 복사했어요. 다른 문서에 붙여 넣어 보관해 주세요.'); }
    catch { showToast('자동 복사가 허용되지 않았어요. 제목과 본문을 직접 선택해 복사해 주세요.'); }
  };
  const downloadCurrentDraft = () => {
    const url = URL.createObjectURL(new Blob([`${pieceTitle}\n\n${editorText}`], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url;
    anchor.download = `${(pieceTitle || '쓰담 임시 글').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.txt`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    if (isSubmitting) return;
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

  const handleStageSubmit = async (requestFeedback = false) => {
    if (isTeacherPreview) return;
    if (!pieceTitle.trim()) {
      showToast('작품 제목을 먼저 지어 주세요.');
      return;
    }
    if (!editorText.trim()) {
      showToast('글을 먼저 작성해 주세요.');
      return;
    }
    const submittedDraft = draft.captureSubmission();
    const wasRecalled = isRecalled;
    const wasEditingCompleted = isEditingCompleted;
    const isFeedbackRequest = wasEditingCompleted && requestFeedback;
    setIsSubmitting(true);
    try {
      const options = {
        isRecallUpdate: wasRecalled,
        allowRevision: wasEditingCompleted,
        keepFinalCompleted: wasEditingCompleted && !isFeedbackRequest
      };
      const result = await onSubmitStage(
        currentStudent.number,
        currentWritingStage,
        editorText,
        selectedTopic.id,
        pieceTitle.trim(),
        options
      );
      if (result?.ok) {
        draft.submitted(submittedDraft);
        setIsSubmissionAccepted(true);
        setIsRecalled(false);
        setIsEditingCompleted(false);
        showToast(
          wasRecalled
            ? '수정한 글을 다시 선생님께 제출했어요!'
            : isFeedbackRequest
            ? '선생님께 첨삭을 요청했어요!'
            : wasEditingCompleted
            ? '수정한 글을 최종 완성본에 저장했어요!'
            : '선생님께 내 글을 제출했어요!'
        );
      } else {
        showToast(result?.error || '제출하지 못했습니다. 다시 시도해 주세요.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnsubmitStage = async () => {
    if (isTeacherPreview || !onUnsubmitStage) return;
    setIsUnsubmitting(true);
    try {
      const res = await onUnsubmitStage(currentStudent.number, selectedTopic.id);
      if (res?.ok) {
        setIsSubmissionAccepted(false);
        setIsRecalled(true);
        showToast('제출을 회수했습니다. 자유롭게 고친 뒤 다시 제출해 주세요!');
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
          }
        }, 50);
      } else {
        showToast(res?.error || '제출을 회수하지 못했습니다.');
      }
    } finally {
      setIsUnsubmitting(false);
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
            const isTopicFinal = isFinalWritingStatus(stData?.status);
            const meta = STAGE_META[stData?.status] || STAGE_META.STAGE_1_WRITING;
            const hasFeedback =
              Boolean(stData?.teacherNote) || (stData?.feedbackItems || []).length > 0;

            return (
              <div
                key={tp.id}
                onClick={() => setOpenedTopicId(tp.id)}
                className={`sketch-card sketch-card-hover p-6 flex flex-col justify-between cursor-pointer transition relative overflow-hidden ${
                  isTopicFinal
                    ? 'bg-[#F2F9F5] border-2 border-[#52B788]'
                    : tp.isActive
                    ? 'bg-white border-2 border-[#1B4332]'
                    : 'bg-[#FBFBF9] border-[#CBD5E1]'
                }`}
              >
                {/* 왼쪽 공책 제본 띠 장식 */}
                <div
                  className={`absolute left-0 top-0 bottom-0 w-2.5 ${
                    isTopicFinal ? 'bg-[#52B788]' : tp.isActive ? 'bg-[#1B4332]' : 'bg-[#94A3B8]'
                  }`}
                />

                <div className="pl-3 space-y-3">
                  {/* 상단 배지 줄 */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {isTopicFinal ? (
                        <span className="px-2.5 py-0.5 rounded-full bg-[#D8F3DC] border border-[#2D6A4F] text-[#1B4332] text-xs font-bold flex items-center gap-1">
                          <span>🎉</span>
                          <span>최종 완성 (수고했어요!)</span>
                        </span>
                      ) : tp.isActive ? (
                        <span className="px-2.5 py-0.5 rounded-full bg-[#1B4332] text-white text-xs font-bold">
                          오늘의 글쓰기 주제
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full bg-white border border-[#CBD5E1] text-[#64748B] text-xs font-semibold">
                          지난 공책 · {tp.createdAt}
                        </span>
                      )}
                      {hasFeedback && !isTopicFinal && (
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
                    <span>{isTopicFinal ? '완성된 작품 감상하기' : '이 공책 펼치기'}</span>
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
  const isClassLocked = Boolean(selectedTopic?.classLocked);
  const isFinalCompleted = isFinalWritingStatus(topicStudentData?.status);
  const isTeacherLocked = (Boolean(topicStudentData?.locked) || isSubmissionAccepted) && !isRecalled && !(isFinalCompleted && isEditingCompleted);
  const isReadOnly =
    isTeacherPreview ||
    (isClassLocked && !(isFinalCompleted && isEditingCompleted)) ||
    (isFinalCompleted && !isEditingCompleted) ||
    isTeacherLocked;
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
              else if (draft.flush()) setOpenedTopicId(null);
              else showToast('아직 기기에 저장되지 않았어요. 지금 글을 먼저 복사하거나 파일로 보관해 주세요.');
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

        <div className="flex flex-wrap items-center gap-2.5">
          {isTeacherPreview && (
            <span className="px-3 py-1.5 rounded-xl bg-[#FEF3C7] border border-[#F59E0B] text-xs font-bold text-[#92400E] flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5" />
              교사 읽기 전용
            </span>
          )}
          {!isTeacherPreview && <button type="button" disabled={isSubmitting} onClick={() => { draft.flush('recovery-open'); setRecoveryData(draft.recovery()); }} className="sketch-btn-secondary min-h-11 px-3 py-2 text-xs sm:text-sm font-bold flex items-center gap-2"><History className="h-4 w-4" aria-hidden="true" />이전 글 복구</button>}
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

      {draft.error && !isTeacherPreview && <div role="alert" className="rounded-2xl border border-[#FCA5A5] bg-[#FEF2F2] p-4 text-sm text-[#991B1B] space-y-3"><p className="font-bold">{draft.error}</p><div className="flex flex-wrap gap-2"><button type="button" onClick={copyCurrentDraft} className="sketch-btn-secondary min-h-11 px-3 py-2 font-bold flex items-center gap-2"><Copy className="h-4 w-4" aria-hidden="true" />지금 글 복사</button><button type="button" onClick={downloadCurrentDraft} className="sketch-btn-secondary min-h-11 px-3 py-2 font-bold flex items-center gap-2"><Download className="h-4 w-4" aria-hidden="true" />글 파일로 보관</button><button type="button" onClick={draft.retry} className="min-h-11 px-3 py-2 font-bold underline cursor-pointer">저장 다시 시도</button></div></div>}

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

                {lastSavedTime && !isReadOnly && viewingPageIdx === null && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F0FDF4] border border-[#BBF7D0] text-xs font-bold text-[#166534]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E] animate-pulse"></span>
                    기기에 저장됨 ({lastSavedTime})
                  </span>
                )}

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

            {restoredBannerMsg && (
              <div className="mb-3 px-4 py-2.5 rounded-xl bg-[#ECFDF5] border border-[#6EE7B7] text-xs font-bold text-[#065F46] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#059669] shrink-0" />
                  <span>{restoredBannerMsg}</span>
                </div>
                <button
                  type="button"
                  onClick={draft.dismissNotice}
                  className="text-[#065F46] hover:text-[#047857] text-xs underline cursor-pointer shrink-0"
                >
                  확인
                </button>
              </div>
            )}

            {isFinalCompleted && (
              <div className="mb-3.5 p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-[#D8F3DC] via-[#E8F5E9] to-[#D8F3DC] border-2 border-[#52B788] shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3.5">
                <div className="flex items-start sm:items-center gap-3.5">
                  <div className="w-11 h-11 rounded-2xl bg-[#1B4332] text-white flex items-center justify-center shrink-0 shadow-sm text-2xl">
                    🎉
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-full bg-[#1B4332] text-white text-xs font-bold">
                        글쓰기 최종 완성
                      </span>
                      <h3 className="text-base sm:text-lg font-bold text-[#1B4332]">
                        선생님이 글을 최종 확인했어요! 글 쓰느라 정말 수고 많았어요 👏
                      </h3>
                    </div>
                    <p className="text-xs sm:text-sm text-[#2D6A4F] mt-1 leading-relaxed font-medium">
                      처음 생각부터 고쳐 쓰기까지 정성을 다해 나만의 멋진 글을 완성했어요. 스스로를 많이 칭찬해 주세요!
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => setIsDiffModalOpen(true)}
                    className="sketch-btn-primary px-3.5 py-2 text-xs font-bold flex items-center gap-1.5"
                  >
                    <HandDrawnDiffIcon size={15} color="#FFFFFF" />
                    <span>처음 글과 비교하기</span>
                  </button>
                  {!isTeacherPreview && !isEditingCompleted && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingCompleted(true);
                        setViewingPageIdx(null);
                        setTimeout(() => textareaRef.current?.focus(), 50);
                      }}
                      className="sketch-btn-secondary px-3.5 py-2 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <HandDrawnPencilIcon size={14} color="#1B4332" />
                      <span>글 더 다듬기</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {isEditingCompleted && (
              <div className="mb-3 px-4 py-3 rounded-2xl bg-[#FEF9C3] border border-[#FACC15] text-xs sm:text-sm font-bold text-[#854D0E] flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <HandDrawnPencilIcon size={16} color="#854D0E" />
                  <span>완성본을 자유롭게 더 다듬고 있어요. 저장만 하면 선생님께 첨삭을 요청하지 않아요.</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEditingCompleted(false)}
                  className="text-xs text-[#854D0E] underline hover:text-[#713F12] cursor-pointer shrink-0"
                >
                  수정 취소하고 완성본 보기
                </button>
              </div>
            )}

            {isRecalled && (
              <div className="mb-3 px-4 py-3 rounded-2xl bg-[#E0F2FE] border border-[#7DD3FC] text-xs sm:text-sm font-bold text-[#0369A1] flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <CornerDownLeft className="w-4 h-4 text-[#0284C7]" />
                  <span>제출을 회수하여 수정 모드로 돌아왔어요. 오타나 생각을 고친 뒤 아래 [수정 완료! 다시 제출하기]를 눌러주세요.</span>
                </div>
              </div>
            )}

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
                  disabled={isSubmitting}
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
                  disabled={isReadOnly || isSubmitting}
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
            ) : isFinalCompleted && !isEditingCompleted ? (
              <div className="flex items-center gap-3 flex-wrap">
                <div className="py-3.5 px-6 rounded-2xl bg-[#D8F3DC] border-2 border-[#1B4332] text-sm font-bold text-[#1B4332] flex items-center justify-center sm:justify-start gap-3 shadow-2xs">
                  <span className="text-2xl">🏅</span>
                  <div>
                    <div className="text-xs text-[#2D6A4F] font-semibold">글쓰기 여정 완료</div>
                    <div>선생님이 최종 완성본으로 확인했어요! 글 쓰느라 정말 수고 많았어요 👏</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingCompleted(true);
                    setViewingPageIdx(null);
                    setTimeout(() => textareaRef.current?.focus(), 50);
                  }}
                  className="sketch-btn-secondary px-5 py-3.5 text-sm font-bold flex items-center gap-2 cursor-pointer hover:bg-[#D8F3DC]"
                >
                  <HandDrawnPencilIcon size={16} color="#1B4332" />
                  <span>이어서 더 고쳐 쓰기</span>
                </button>
              </div>
            ) : isTeacherLocked ? (
              <div className="flex items-center gap-3 flex-wrap">
                <div className="py-3.5 px-5 rounded-2xl bg-[#F2F9F5] border border-[#52B788] text-sm font-bold text-[#1B4332] flex items-center gap-2">
                  <HandDrawnCheckIcon size={18} color="#1B4332" />
                  <span>
                    {topicStudentData?.status === 'STAGE_1_SUBMITTED'
                      ? '1차 글을 제출했어요. 선생님의 확인을 기다리고 있어요.'
                      : '최신 수정본을 제출했어요. 선생님의 확인을 기다리고 있어요.'}
                  </span>
                </div>
                {!isClassLocked && (
                  <button
                    type="button"
                    onClick={handleUnsubmitStage}
                    disabled={isUnsubmitting}
                    className="sketch-btn-secondary px-4 py-3.5 text-sm font-bold flex items-center gap-1.5 cursor-pointer hover:bg-[#FEF2F2] hover:border-[#EF4444] hover:text-[#B91C1C] transition"
                  >
                    <CornerDownLeft className="w-4 h-4" />
                    <span>{isUnsubmitting ? '회수하는 중...' : '제출 회수하고 더 고쳐 쓰기'}</span>
                  </button>
                )}
              </div>
            ) : isEditingCompleted ? (
              <div className="w-full sm:w-auto flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => handleStageSubmit(false)}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto min-w-[240px] h-14 px-7 sketch-btn-primary text-base font-bold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <HandDrawnCheckIcon size={20} color="#FFFFFF" />
                  <span>{isSubmitting ? '안전하게 저장하고 있어요...' : '수정한 내용 저장하기'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleStageSubmit(true)}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto min-w-[220px] h-14 px-6 sketch-btn-secondary text-base font-bold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <HandDrawnPencilIcon size={18} color="#1B4332" />
                  <span>{isSubmitting ? '처리하고 있어요...' : '선생님에게 첨삭 요청'}</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleStageSubmit(false)}
                disabled={isSubmitting}
                className="w-full sm:w-auto min-w-[260px] h-14 px-8 sketch-btn-primary text-base font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                <HandDrawnCheckIcon size={20} color="#FFFFFF" />
                <span>
                  {isSubmitting
                    ? '안전하게 제출하고 있어요...'
                    : isRecalled
                    ? '수정 완료! 다시 제출하기'
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

            {isFinalCompleted && (
              <div className="p-4 rounded-2xl bg-[#D8F3DC] border-2 border-[#52B788] text-[#1B4332] flex items-center gap-3">
                <span className="text-2xl shrink-0">🏆</span>
                <div>
                  <div className="text-xs font-bold text-[#2D6A4F]">최종 완료 도장 쾅!</div>
                  <div className="text-sm font-bold">
                    선생님이 최종 확인을 마쳤어요. 멋진 글을 짓느라 애썼어요!
                  </div>
                </div>
              </div>
            )}

            {!topicStudentData?.teacherNote && feedbackItems.length === 0 ? (
              isFinalCompleted ? (
                <div className="py-12 px-6 text-center rounded-2xl bg-white border border-[#CBD5E1] space-y-2">
                  <p className="text-base font-bold text-[#1B4332]">
                    훌륭하게 글쓰기를 마쳤어요!
                  </p>
                  <p className="text-sm text-[#475569] leading-relaxed">
                    선생님이 최종 완성본으로 인정해 주셨어요.<br />
                    내가 쓴 글을 다시 읽어보거나, 위의 [처음 글과 비교하기]를 눌러보세요.
                  </p>
                </div>
              ) : (
                <div className="py-16 px-6 text-center rounded-2xl bg-white border border-[#E2E8F0] space-y-2">
                  <p className="text-base font-bold text-[#475569]">
                    아직 도착한 첨삭이 없어요
                  </p>
                  <p className="text-sm text-[#64748B] leading-relaxed">
                    왼쪽 공책에 글을 쓰고 [제출하기]를 누르면, 선생님이 내 글을 읽고 여기에 다정한 조언을 적어 주실 거예요!
                  </p>
                </div>
              )
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
      {recoveryData && <DraftRecoveryDialog topicTitle={selectedTopic.title} currentDraft={{ pieceTitle, text: editorText }} items={recoveryData.items} legacy={recoveryData.legacy} canRestore={!isSubmitting && !isTeacherPreview && ((!isClassLocked && !isTeacherLocked) || isFinalCompleted)} onClose={() => setRecoveryData(null)} onRestore={(snapshot) => {
        const allowCompleted = isFinalCompleted;
        if (!draft.restore(snapshot, allowCompleted)) return false;
        if (allowCompleted) setIsEditingCompleted(true);
        setHighlightedQuote(''); setShowGreenText(false); setViewingPageIdx(null); setRecoveryData(null);
        return true;
      }} />}

      <GrowthDiffModal
        isOpen={isDiffModalOpen}
        onClose={() => setIsDiffModalOpen(false)}
        student={topicStudentData}
        topicTitle={selectedTopic.title}
      />
    </div>
  );
}
