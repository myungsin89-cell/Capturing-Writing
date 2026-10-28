import React, { useState, useEffect, useRef } from 'react';
import useStudentDraft from '../hooks/useStudentDraft';
import useStudentFeedbackPanel from '../hooks/useStudentFeedbackPanel';
import { getDraftBase, getDraftOwner } from '../utils/studentDraftStorage';
import DraftRecoveryDialog from './DraftRecoveryDialog';
import FriendNotebooks from './FriendNotebooks';
import {
  HandDrawnNotebookLogo,
  HandDrawnPencilIcon,
  HandDrawnDiffIcon,
  HandDrawnArrowRightIcon
} from './HandDrawnIcons';
import { GrowthDiffModal } from './GrowthDiffView';
import {
  STAGE_META,
  renderTextWithHighlight,
  renderTextWithGreenAdditions,
  getStudentDraftPages,
  getStudentFeedbackPages,
  isFinalWritingStatus,
  isSubmittedWritingStatus
} from '../utils/diffHelper';
import {
  Send,
  LogOut,
  AlertCircle,
  BookOpen,
  CornerDownLeft,
  ArrowLeft,
  History,
  Copy,
  Download,
  Check,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  MoreHorizontal,
  X
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
  onAddQuestion,
  onLoadCompletedWritings
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
  const [friendsTopicId, setFriendsTopicId] = useState(null);
  const isFriendsOpen = Boolean(openedTopicId && friendsTopicId === openedTopicId);

  // 오른쪽 첨삭 메모 클릭 시 왼쪽 본문에서 형광펜으로 보여줄 문장
  const [highlightedQuote, setHighlightedQuote] = useState('');
  // 대형 나란히 비교 모달 열림 상태
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);

  const [questionInput, setQuestionInput] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [showGreenText, setShowGreenText] = useState(false);
  const [viewingPageIdx, setViewingPageIdx] = useState(null); // null이면 현재 작성·수정 공책, 숫자면 해당 차수 글 보기
  const [selectedFeedbackRound, setSelectedFeedbackRound] = useState(null);
  const [recoveryData, setRecoveryData] = useState(null);
  const [isQuestionOpen, setIsQuestionOpen] = useState(false);
  const [focusQuestionRequested, setFocusQuestionRequested] = useState(false);
  const textareaRef = useRef(null);
  const questionSubmittingRef = useRef(false);
  const questionInputRef = useRef(null);
  const toolsRef = useRef(null);
  const feedbackToggleRef = useRef(null);

  const currentStudent =
    students.find((s) => String(s.number) === String(activeStudent?.number)) ||
    activeStudent;

  // 학생은 책장부터, 교사 미리보기는 선택한 주제 공책부터 바로 보여줍니다.
  useEffect(() => {
    setOpenedTopicId(isTeacherPreview && initialTopicId ? initialTopicId : null);
    setFriendsTopicId(null);
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
  const feedbackPages = getStudentFeedbackPages(topicStudentData);
  const activeFeedbackPage =
    feedbackPages.find((page) => page.round === selectedFeedbackRound) ||
    feedbackPages[feedbackPages.length - 1] ||
    null;
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

  const feedbackItems = activeFeedbackPage?.feedbackItems || [];
  const feedbackTeacherNote = activeFeedbackPage?.teacherNote || '';
  const [isFeedbackOpen, setFeedbackOpen] = useStudentFeedbackPanel(
    getDraftOwner({ spreadsheetId: config.spreadsheetId || '', classId: config.activeClassId || '', student: currentStudent, topicId: openedTopicId }),
    topicStudentData?.status === 'FEEDBACK_DONE' && feedbackPages.length > 0
  );

  useEffect(() => {
    setIsQuestionOpen(false);
    setFocusQuestionRequested(false);
    if (toolsRef.current) toolsRef.current.open = false;
  }, [openedTopicId, currentStudent?.classId, currentStudent?.number, currentStudent?.name]);

  useEffect(() => {
    if (!isFeedbackOpen || !isQuestionOpen || !focusQuestionRequested) return;
    questionInputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    questionInputRef.current?.focus({ preventScroll: true });
    setFocusQuestionRequested(false);
  }, [isFeedbackOpen, isQuestionOpen, focusQuestionRequested]);

  useEffect(() => {
    const closeOutside = (event) => {
      if (toolsRef.current?.open && !toolsRef.current.contains(event.target)) toolsRef.current.open = false;
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && toolsRef.current?.open) {
        toolsRef.current.open = false;
        toolsRef.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  // Grow the editor instead of letting a scrollbar narrow the writing surface.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    let active = true;
    resize();
    document.fonts?.ready.then(() => { if (active) resize(); });
    document.fonts?.addEventListener('loadingdone', resize);
    window.addEventListener('resize', resize);
    return () => {
      active = false;
      document.fonts?.removeEventListener('loadingdone', resize);
      window.removeEventListener('resize', resize);
    };
  }, [editorText, openedTopicId, viewingPageIdx, highlightedQuote, showGreenText, isFriendsOpen]);

  const currentWritingStage = Math.max(1, draftPages.length + 1);

  // 제출본/공책이 바뀔 때만 보기 상태를 초기화합니다. 입력 내용은 전용 저장 훅에서 복원합니다.
  useEffect(() => {
    if (!topicStudentData) return;
    setHighlightedQuote('');
    setShowGreenText(false);
    setViewingPageIdx(null);
    setSelectedFeedbackRound(null);
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
                          <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>최종 완성</span>
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

                    {!isTopicFinal && <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${meta.badgeBg} ${meta.badgeBorder} ${meta.badgeText}`}
                    >
                      {meta.shortLabel}
                    </span>}
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
                {!isTeacherPreview && <button type="button" className="student-action-button mt-3 ml-3" onClick={(event) => {
                  event.stopPropagation();
                  setFriendsTopicId(tp.id);
                  setOpenedTopicId(tp.id);
                }}><BookOpen className="w-4 h-4" aria-hidden="true" />친구 완성 글 보기</button>}
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
  if (isFriendsOpen) return <FriendNotebooks key={selectedTopic.id} topic={selectedTopic}
    onLoad={onLoadCompletedWritings} onClose={() => setFriendsTopicId(null)} />;
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
  const isViewingText = Boolean(highlightedQuote || showGreenText || viewingPageIdx !== null);
  const visibleTitle = viewingPageIdx !== null
    ? draftPages[viewingPageIdx]?.pieceTitle || displayPieceTitle
    : displayPieceTitle;

  const runTool = (action) => {
    if (toolsRef.current) toolsRef.current.open = false;
    action();
  };
  const resumeWriting = () => {
    setHighlightedQuote('');
    setShowGreenText(false);
    setViewingPageIdx(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };
  const startCompletedRevision = () => {
    setIsEditingCompleted(true);
    resumeWriting();
  };
  const closeFeedback = () => {
    setFeedbackOpen(false);
    setHighlightedQuote('');
    setIsQuestionOpen(false);
    feedbackToggleRef.current?.focus();
  };
  const openQuestion = () => {
    setFeedbackOpen(true);
    setIsQuestionOpen(true);
    setFocusQuestionRequested(true);
  };
  const openFriendNotebooks = () => {
    if (draft.flush()) setFriendsTopicId(selectedTopic.id);
    else showToast('아직 기기에 저장되지 않았어요. 지금 글을 먼저 복사하거나 파일로 보관해 주세요.');
  };
  const waitingForFeedback = isSubmissionAccepted || isSubmittedWritingStatus(topicStudentData?.status);
  const writingStatus = isFinalCompleted ? '최종 완성' : isRecalled ? '회수 후 수정 중'
    : waitingForFeedback ? '첨삭 요청 · 선생님 확인 대기'
    : isClassLocked ? '글쓰기 마감' : topicStudentData?.status === 'FEEDBACK_DONE' ? '첨삭 도착 · 고쳐 쓰는 중' : '글 쓰는 중';

  return (
    <div className="student-quiet notebook-workspace flex-1 w-full px-6 lg:px-10 py-5 flex flex-col gap-5">
      {toastMsg && (
        <div role="status" className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-[#1B4332] text-white px-5 py-3 shadow-lg flex items-center gap-2 text-sm">
          <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{toastMsg}</span>
        </div>
      )}

      <header className="student-notebook-toolbar">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <button
            type="button"
            onClick={() => {
              if (isTeacherPreview) onLogoutStudent();
              else if (draft.flush()) setOpenedTopicId(null);
              else showToast('아직 기기에 저장되지 않았어요. 지금 글을 먼저 복사하거나 파일로 보관해 주세요.');
            }}
            className="student-text-button"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            {isTeacherPreview ? '선생님 관리로' : '책장으로'}
          </button>
          <h1 className="text-base font-semibold text-[#334155]">{selectedTopic.title}</h1>
          <span className="text-xs text-[#64748B]">{currentStudent.number}번 {currentStudent.name}</span>
          {isTeacherPreview && <span className="text-xs text-[#64748B]">교사 읽기 전용</span>}
        </div>

        <div className="student-toolbar-actions">
          <details ref={toolsRef} className="student-tools">
            <summary className="student-text-button">
              <MoreHorizontal className="w-4 h-4" aria-hidden="true" />글 도구
            </summary>
            <div className="student-tools-menu">
              {prevComparisonText && prevComparisonText.trim() !== activeDisplayText.trim() && (
                <button type="button" aria-pressed={showGreenText} onClick={() => runTool(() => {
                  setHighlightedQuote('');
                  setShowGreenText((prev) => !prev);
                })}>
                  <Check className={'w-4 h-4 ' + (showGreenText ? '' : 'opacity-0')} aria-hidden="true" />
                  고친 표현 초록 글씨로 보기
                </button>
              )}
              {!isTeacherPreview && (
                <button type="button" disabled={isSubmitting} onClick={() => runTool(() => {
                  draft.flush('recovery-open');
                  setRecoveryData(draft.recovery());
                })}>
                  <History className="w-4 h-4" aria-hidden="true" />이전 글 복구
                </button>
              )}
              {!isReadOnly && !isViewingText && (
                <button type="button" onClick={() => runTool(handleInsertParagraph)}>
                  <CornerDownLeft className="w-4 h-4" aria-hidden="true" />새 문단 나누기
                </button>
              )}
            </div>
          </details>
          {!isTeacherPreview && (
            <button type="button" onClick={openQuestion} className="student-text-button">선생님께 질문</button>
          )}
          <button
            ref={feedbackToggleRef}
            type="button"
            aria-expanded={isFeedbackOpen}
            aria-controls="student-feedback-panel"
            onClick={() => isFeedbackOpen ? closeFeedback() : setFeedbackOpen(true)}
            className="student-action-button"
          >
            {isFeedbackOpen
              ? <PanelRightClose className="w-4 h-4" aria-hidden="true" />
              : <PanelRightOpen className="w-4 h-4" aria-hidden="true" />}
            {isFeedbackOpen ? '첨삭 닫기' : '첨삭 보기'}
          </button>
        </div>
      </header>

      <section aria-label="글쓰기 안내와 상태" className="student-learning-guide" data-state={isFinalCompleted ? 'complete' : waitingForFeedback && !isRecalled ? 'waiting' : 'writing'}>
        <div role="status" className="student-writing-status">
          {isFinalCompleted && <Check className="w-5 h-5 shrink-0" aria-hidden="true" />}
          <span>{writingStatus}{isFinalCompleted && isEditingCompleted ? ' · 더 다듬는 중' : ''}</span>
        </div>
        {isFinalCompleted ? <div className="space-y-1.5">
          <h2 className="text-lg sm:text-xl font-bold text-[#1B4332]">{currentStudent.name} 학생, 나만의 작품을 완성했어요!</h2>
          <p className="text-sm sm:text-base leading-relaxed text-[#475569]">끝까지 글을 쓰고 다듬은 노력이 멋져요. 처음 쓴 글과 비교하며 달라진 점을 찾아보고, 친구들의 작품도 감상해 보세요.</p>
        </div> : <p className="text-sm leading-relaxed text-[#475569]">{isRecalled ? '글을 고친 뒤 다시 제출해 주세요.'
          : waitingForFeedback ? '글을 잘 제출했어요. 선생님의 조언을 기다리는 동안 친구들의 완성 글도 읽어 보세요.'
          : isClassLocked ? '이 주제의 글쓰기가 마감되었어요. 쓴 글을 읽거나 친구들의 작품을 감상할 수 있어요.'
          : topicStudentData?.status === 'FEEDBACK_DONE' ? '첨삭 보기에서 선생님의 조언을 읽고, 글을 한 번 더 다듬어 보세요.'
          : '선생님의 안내를 읽고, 나의 생각을 글로 표현해 보세요.'}</p>}
        {selectedTopic.prompt && <section className="student-writing-guide" aria-label="선생님의 글쓰기 안내">
          <h2 className="font-bold text-[#1B4332] flex items-center gap-2"><BookOpen className="w-4 h-4 shrink-0" aria-hidden="true" />선생님의 글쓰기 안내</h2>
          <p className="whitespace-pre-wrap leading-relaxed break-words">{selectedTopic.prompt}</p>
        </section>}
        <div className="flex flex-wrap items-center gap-3">
          {!isTeacherPreview && <button type="button" className="student-action-button" onClick={openFriendNotebooks}><BookOpen className="w-4 h-4" aria-hidden="true" />친구 완성 글 보기</button>}
          <button type="button" className="student-action-button" disabled={!hasRevision} onClick={() => setIsDiffModalOpen(true)}><HandDrawnDiffIcon size={16} color="#475569" />처음 글과 비교하기</button>
          {!hasRevision && <span className="text-xs text-[#64748B]">두 번째 글을 제출하면 처음 글과 비교할 수 있어요.</span>}
        </div>
      </section>

      {draft.error && !isTeacherPreview && (
        <div role="alert" className="rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] p-4 text-sm text-[#991B1B] space-y-3">
          <p className="font-semibold">{draft.error}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copyCurrentDraft} className="student-action-button"><Copy className="w-4 h-4" aria-hidden="true" />지금 글 복사</button>
            <button type="button" onClick={downloadCurrentDraft} className="student-action-button"><Download className="w-4 h-4" aria-hidden="true" />글 파일로 보관</button>
            <button type="button" onClick={draft.retry} className="student-text-button">저장 다시 시도</button>
          </div>
        </div>
      )}

      <div className={'student-notebook-layout flex-1 ' + (isFeedbackOpen ? '' : 'is-feedback-closed')}>
        <section aria-label="내 글 공책" className="notebook-card sketch-card bg-white flex flex-col">
          <div className="student-paper-toolbar">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-sm font-semibold text-[#475569]">{viewingPageIdx === null ? '내 글' : draftPages[viewingPageIdx]?.label}</h2>
              <span className="text-xs text-[#64748B]">{paragraphCount}개 문단 · {activeDisplayText.trim().length}자</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {lastSavedTime && !isReadOnly && viewingPageIdx === null && (
                <span className="text-xs text-[#64748B]" title={'마지막 저장: ' + lastSavedTime}>기기에 저장됨</span>
              )}
              {draftPages.length > 0 && (
                <label className="flex items-center gap-2 text-xs text-[#64748B]">
                  이전 글
                  <select
                    aria-label="이전 글 보기"
                    className="student-select"
                    value={viewingPageIdx === null ? 'current' : String(viewingPageIdx)}
                    onChange={(event) => {
                      setHighlightedQuote('');
                      setShowGreenText(false);
                      setViewingPageIdx(event.target.value === 'current' ? null : Number(event.target.value));
                    }}
                  >
                    <option value="current">{isReadOnly ? '현재 글' : '쓰고 있는 글'}</option>
                    {draftPages.map((page, idx) => <option key={page.round} value={String(idx)}>{page.label}</option>)}
                  </select>
                </label>
              )}
            </div>
          </div>

          {restoredBannerMsg && (
            <div className="student-inline-notice">
              <span>{restoredBannerMsg}</span>
              <button type="button" onClick={draft.dismissNotice} className="student-text-button shrink-0">확인</button>
            </div>
          )}
          {isEditingCompleted && (
            <div className="student-inline-notice">
              <span>저장만 하면 선생님께 첨삭을 요청하지 않아요.</span>
              <button type="button" onClick={() => setIsEditingCompleted(false)} className="student-text-button shrink-0">수정 취소</button>
            </div>
          )}
          {isRecalled && <p className="mb-3 text-xs leading-relaxed text-[#64748B]">제출을 회수했어요. 글을 고친 뒤 다시 제출해 주세요.</p>}
          {isViewingText && (
            <div className="student-view-hint">
              <span>{highlightedQuote ? '첨삭받은 문장에 형광펜을 켰어요.' : showGreenText ? '고친 표현을 초록 글씨로 보고 있어요.' : '이전에 제출한 글을 보고 있어요.'}</span>
              <button type="button" className="student-text-button shrink-0" onClick={resumeWriting}>{isReadOnly ? '현재 글 보기' : '이어서 쓰기'}</button>
            </div>
          )}

          <div className="manuscript-paper lined-paper rounded-2xl border border-[#CBD5E1] text-[#1E293B]">
            {!isReadOnly && !isViewingText ? (
              <input
                type="text"
                value={pieceTitle}
                onChange={(event) => setPieceTitle(event.target.value)}
                maxLength={50}
                aria-label="작품 제목"
                disabled={isSubmitting}
                placeholder="제목을 써주세요"
                className="manuscript-title bg-transparent border-0 border-b border-dashed border-[#CBD5E1] text-[#1E293B] placeholder:text-[#94A3B8]/70 placeholder:font-normal focus:outline-none focus:border-[#64748B]"
              />
            ) : (
              <h3 className={'manuscript-title ' + (visibleTitle ? 'text-[#1E293B]' : 'text-[#94A3B8]')}>{visibleTitle || '제목을 써주세요'}</h3>
            )}
            <div className="manuscript-name text-[#475569]">{currentStudent.name}</div>
            {isViewingText ? (
              <div className="manuscript-body">
                {showGreenText
                  ? renderTextWithGreenAdditions(prevComparisonText, activeDisplayText, highlightedQuote)
                  : renderTextWithHighlight(activeDisplayText, highlightedQuote)}
              </div>
            ) : (
              <textarea
                ref={textareaRef}
                value={editorText}
                onChange={(event) => setEditorText(event.target.value)}
                disabled={isReadOnly || isSubmitting}
                aria-label="글 본문"
                placeholder="여기에 글을 시작해 주세요."
                className="manuscript-body bg-transparent focus:outline-none text-[#1E293B] disabled:opacity-100 disabled:cursor-not-allowed"
              />
            )}
          </div>

          <footer className="student-paper-footer">
            {isTeacherPreview ? (
              <p className="flex items-center gap-2 text-xs text-[#64748B]"><BookOpen className="w-4 h-4" aria-hidden="true" />교사 미리보기에서는 읽기만 할 수 있어요.</p>
            ) : isFinalCompleted && !isEditingCompleted ? (
              <button type="button" onClick={startCompletedRevision} className="student-action-button">
                <HandDrawnPencilIcon size={16} color="#475569" />더 다듬기
              </button>
            ) : isTeacherLocked ? (
              <div className="flex items-center justify-between gap-3 flex-wrap w-full">
                <p className="flex items-center gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4" aria-hidden="true" />제출했어요. 선생님의 확인을 기다리고 있어요.</p>
                {!isClassLocked && (
                  <button type="button" onClick={handleUnsubmitStage} disabled={isUnsubmitting} className="student-text-button">
                    <CornerDownLeft className="w-4 h-4" aria-hidden="true" />{isUnsubmitting ? '회수하는 중...' : '회수하고 고쳐 쓰기'}
                  </button>
                )}
              </div>
            ) : isEditingCompleted ? (
              <div className="flex items-center gap-3 flex-wrap">
                <button type="button" onClick={() => handleStageSubmit(false)} disabled={isSubmitting} className="student-primary-button">
                  {isSubmitting ? '저장하고 있어요...' : '수정한 내용 저장하기'}
                </button>
                <button type="button" onClick={() => handleStageSubmit(true)} disabled={isSubmitting} className="student-text-button">
                  선생님에게 첨삭 요청
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => handleStageSubmit(false)} disabled={isSubmitting} className="student-primary-button">
                {isSubmitting ? '제출하고 있어요...' : isRecalled ? '수정한 글 다시 제출하기' : '선생님께 제출하기'}
              </button>
            )}
          </footer>
        </section>

        <aside id="student-feedback-panel" aria-label="선생님 첨삭" hidden={!isFeedbackOpen} className="student-feedback-panel sketch-card bg-white p-6 sm:p-7 space-y-6">
          <header className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-semibold text-[#334155]"><MessageSquare className="w-4 h-4" aria-hidden="true" />선생님 첨삭</h2>
            <button type="button" onClick={closeFeedback} className="student-text-button" aria-label="첨삭 패널 닫기"><X className="w-4 h-4" aria-hidden="true" /></button>
          </header>

          {feedbackPages.length > 1 ? (
            <label className="flex items-center gap-3 text-sm text-[#64748B]">
              지난 피드백
              <select aria-label="지난 피드백 보기" className="student-select" value={String(activeFeedbackPage.round)} onChange={(event) => {
                setSelectedFeedbackRound(Number(event.target.value));
                setHighlightedQuote('');
              }}>
                {feedbackPages.map((page, idx) => <option key={page.round} value={String(page.round)}>{page.round}차 피드백{idx === feedbackPages.length - 1 ? ' · 최근' : ''}</option>)}
              </select>
            </label>
          ) : activeFeedbackPage && <p className="text-xs text-[#64748B]">{activeFeedbackPage.round}차 글에 받은 피드백</p>}

          {!activeFeedbackPage ? (
            <div className="py-6 space-y-2">
              <p className="text-sm font-medium text-[#475569]">아직 받은 첨삭이 없어요.</p>
              <p className="text-sm leading-relaxed text-[#64748B]">선생님이 보내 주신 조언은 여기에 모아 둘게요.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {feedbackTeacherNote && <div className="student-feedback-note whitespace-pre-wrap text-sm sm:text-[15px] text-[#334155] leading-7">{feedbackTeacherNote}</div>}
              {feedbackItems.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-medium text-[#64748B]">문장별 조언 · 누르면 글에서 확인할 수 있어요</h3>
                  {feedbackItems.map((item, idx) => {
                    const isHighlighted = Boolean(highlightedQuote && highlightedQuote === item.quote);
                    return (
                      <button key={item.id || idx} type="button" aria-pressed={isHighlighted} onClick={() => {
                        if (!item.quote) return;
                        setHighlightedQuote(isHighlighted ? '' : item.quote);
                      }} className={'student-feedback-item ' + (isHighlighted ? 'is-selected' : '')}>
                        <span className="text-xs text-[#64748B]">문장 조언 {idx + 1}</span>
                        {item.quote && <blockquote className="text-sm text-[#475569] leading-relaxed">{item.quote}</blockquote>}
                        <span className="block text-sm text-[#334155] leading-relaxed whitespace-pre-wrap">{item.comment}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <details className="student-questions" open={isQuestionOpen} onToggle={(event) => setIsQuestionOpen(event.currentTarget.open)}>
            <summary className="text-sm font-medium text-[#475569]">선생님께 질문{myQuestions.length > 0 ? ' · ' + myQuestions.length : ''}</summary>
            <div className="pt-4 space-y-4">
              {myQuestions.length > 0 && (
                <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                  {myQuestions.map((question) => (
                    <div key={question.id} className="text-sm space-y-1.5 pb-3 border-b border-[#E2E8F0]">
                      <div className="text-[#334155]">나: {question.question}</div>
                      {question.reply
                        ? <div className="text-[#2D6A4F]">선생님: {question.reply}</div>
                        : <div className="text-xs text-[#64748B]">답변을 기다리고 있어요.</div>}
                    </div>
                  ))}
                </div>
              )}
              {!isTeacherPreview && (
                <form onSubmit={handleQuestionSubmit} className="flex gap-2">
                  <input ref={questionInputRef} type="text" value={questionInput} onChange={(event) => setQuestionInput(event.target.value)} aria-label="질문 내용" placeholder="궁금한 점을 적어 보세요" className="min-w-0 flex-1 px-3 py-2.5 rounded-lg border border-[#CBD5E1] bg-white text-sm focus:outline-none focus:border-[#64748B]" />
                  <button type="submit" disabled={isQuestionSubmitting} className="student-action-button shrink-0"><Send className="w-4 h-4" aria-hidden="true" />{isQuestionSubmitting ? '보내는 중' : '보내기'}</button>
                </form>
              )}
            </div>
          </details>
        </aside>
      </div>

      {recoveryData && <DraftRecoveryDialog topicTitle={selectedTopic.title} currentDraft={{ pieceTitle, text: editorText }} items={recoveryData.items} legacy={recoveryData.legacy} canRestore={!isSubmitting && !isTeacherPreview && ((!isClassLocked && !isTeacherLocked) || isFinalCompleted)} onClose={() => setRecoveryData(null)} onRestore={(snapshot) => {
        const allowCompleted = isFinalCompleted;
        if (!draft.restore(snapshot, allowCompleted)) return false;
        if (allowCompleted) setIsEditingCompleted(true);
        resumeWriting();
        setRecoveryData(null);
        return true;
      }} />}

      <GrowthDiffModal isOpen={isDiffModalOpen} onClose={() => setIsDiffModalOpen(false)} student={topicStudentData} topicTitle={selectedTopic.title} />
    </div>
  );
}
