import React, { useState, useEffect } from 'react';
import {
  HandDrawnDocIcon,
  HandDrawnDiffIcon,
  HandDrawnLockIcon,
  HandDrawnSparkleIcon,
  HandDrawnCheckIcon,
  HandDrawnChatIcon,
  HandDrawnArrowRightIcon,
  HandDrawnNotebookLogo,
  HandDrawnPencilIcon
} from './HandDrawnIcons';
import { GrowthDiffModal } from './GrowthDiffView';
import StudentShareModal from './StudentShareModal';
import {
  STAGE_META,
  renderTextWithHighlight,
  renderTextWithGreenAdditions,
  getStudentDraftPages
} from '../utils/diffHelper';
import { translateBriskTextToKorean } from '../services/googleDriveService';
import {
  ExternalLink,
  X,
  FolderPlus,
  Plus,
  Trash2,
  Eye,
  BookOpen,
  Share2,
  Check,
  ArrowLeft,
  ClipboardPaste,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Users,
  QrCode,
  UserPlus,
  LogOut
} from 'lucide-react';

const DEFAULT_BRISK_PROMPT =
  '초등학생이 쓴 글입니다. 다정하고 따뜻한 초등 교사 말투로 [잘한 점 (칭찬해요)] 2가지와 [더 자랄 점 (이렇게 고쳐 볼까요?)] 2가지를 학생 눈높이에 맞게 정리해 주세요.';

export default function TeacherDashboard({
  teacherStep: propTeacherStep,
  onChangeTeacherStep,
  classes = [],
  onSelectClass,
  onCreateClass,
  onDeleteClass,
  topics,
  selectedTopicId,
  onSelectTopic,
  openedTopicId: propOpenedTopicId,
  onChangeOpenedTopicId,
  onCreateNewTopic,
  onDeleteTopic,
  onManageStudents,
  students,
  allStudents = students,
  questions,
  allTopics = topics,
  config,
  googleAuth,
  googleClientId = '',
  onSaveGoogleClientId,
  onTeacherGoogleLogin,
  onTeacherLogout,
  gasUrl = '',
  classAccessKey = '',
  onOpenGasSetup,
  onEnsureStudentDoc,
  onUpdateStudentStatus,
  onBatchDeadline,
  onReplyQuestion,
  onPullFeedbackFromDoc,
  onPreviewAsStudent
}) {
  // 교사 진입 단계: 'login'(구글 로그인) -> 'classSelect'(내 학급 선택·전담 다학급 지원) -> 'bookshelf'(주제 책장 및 관리)
  const [localTeacherStep, setLocalTeacherStep] = useState('login');
  const teacherStep = propTeacherStep || localTeacherStep;
  const setTeacherStep = (step) => {
    setLocalTeacherStep(step);
    onChangeTeacherStep?.(step);
  };
  const [showCreateClassModal, setShowCreateClassModal] = useState(false);
  const [isLoggingInGoogle, setIsLoggingInGoogle] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);

  // 학급 또는 글쓰기 주제 삭제 확인 모달 상태 ({ type: 'class' | 'topic', id, title, studentCount, topicCount } | null)
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState(null);
  const [isDeletingTarget, setIsDeletingTarget] = useState(false);

  // 학급 생성 / 학생 관리 상태
  const [setupClassName, setSetupClassName] = useState('');
  const [setupRosterText, setSetupRosterText] = useState('');
  const [isStudentManageOpen, setIsStudentManageOpen] = useState(false);
  const [newStNumber, setNewStNumber] = useState('');
  const [newStName, setNewStName] = useState('');
  const [bulkAddText, setBulkAddText] = useState('');

  // 학생 입장 링크 · QR · 15개 PDF 모달 열림 여부
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  // null이면 [우리 반 글쓰기 주제 책장] 화면, 값이 있으면 해당 [주제의 학생 첨삭 관리실] 화면!
  const [localOpenedTopicId, setLocalOpenedTopicId] = useState(null);
  const openedTopicId =
    propOpenedTopicId === undefined ? localOpenedTopicId : propOpenedTopicId;
  const setOpenedTopicId = (topicId) => {
    setLocalOpenedTopicId(topicId);
    onChangeOpenedTopicId?.(topicId);
  };

  const [selectedStudentNumber, setSelectedStudentNumber] = useState(
    () => students[0]?.number || '1'
  );
  // 오른쪽 첨삭 메모 클릭 또는 본문 드래그 시 가운데 학생 본문에 형광펜 표시할 문장
  const [highlightedQuote, setHighlightedQuote] = useState('');
  // 대형 나란히 비교 모달 열림 여부
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);
  // 특정 학생이 쓴 모든 주제별 글 모아보기 모달
  const [portfolioStudent, setPortfolioStudent] = useState(null);

  // [핵심] 큰 칸으로 들어가는 종합 첨삭 노트 (Brisk 복사·붙여넣기용)
  const [feedbackNote, setFeedbackNote] = useState('');
  // 선생님이 본문 문장을 드래그했을 때만 나타나는 부분 첨삭 상태
  const [modalFeedbackItems, setModalFeedbackItems] = useState([]);
  const [draggedQuote, setDraggedQuote] = useState('');
  const [newFbComment, setNewFbComment] = useState('');
  const [replyTexts, setReplyTexts] = useState({});
  const [showResolvedQuestions, setShowResolvedQuestions] = useState(false);
  const [editingReplyId, setEditingReplyId] = useState(null);
  const [editingReplyText, setEditingReplyText] = useState('');

  // 다회차(1차·2차·3차·4차...) 페이지 넘김 인덱스 & 초록 글씨 표시 토글 (기본값: 순수 완성본 보기)
  const [activePageIdx, setActivePageIdx] = useState(0);
  const [showGreenText, setShowGreenText] = useState(false);

  // 좌측 학생 명단 정렬 방식: 'priority' (질문·첨삭 대기 우선 상단 배치) | 'number' (출석번호순)
  const [studentSortMode, setStudentSortMode] = useState('priority');

  // 새 글쓰기 주제 & 학생 명단 생성 모달
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [rosterText, setRosterText] = useState('6, 강민준\n7, 윤서아\n8, 장하준');

  const [linkCopied, setLinkCopied] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [isPullingDoc, setIsPullingDoc] = useState(false);
  const [waitingDocReturn, setWaitingDocReturn] = useState(false);

  const currentTopic = topics.find((t) => t.id === openedTopicId) || null;

  const rawSelectedStudent =
    students.find((s) => String(s.number) === String(selectedStudentNumber)) ||
    students[0];

  const getStudentTopicData = (rawSt, topic) => {
    if (!rawSt || !topic) return null;
    if (topic.id === (config.activeTopicId || 'TOPIC_1')) return rawSt;
    const past = rawSt.historyByTopic?.[topic.id];
    return {
      ...rawSt,
      status: past?.status || 'STAGE_1_WRITING',
      pieceTitle: past?.pieceTitle || '',
      draft1: past?.draft1 || '',
      draft2: past?.draft2 || '',
      draft3: past?.draft3 || '',
      draft4: past?.draft4 || '',
      draftHistory: past?.draftHistory || [],
      teacherNote: past?.teacherNote || '',
      feedbackItems: past?.feedbackItems || [],
      docId: past?.docId || '',
      docUrl: past?.docUrl || '',
      locked: Boolean(past?.locked) || Boolean(topic.classLocked)
    };
  };

  const selectedStudent = getStudentTopicData(rawSelectedStudent, currentTopic);
  const draftPages = getStudentDraftPages(selectedStudent);

  useEffect(() => {
    if (!selectedStudent || !currentTopic) return;
    const pages = getStudentDraftPages(selectedStudent);
    setHighlightedQuote('');
    setDraggedQuote('');
    setNewFbComment('');
    setWaitingDocReturn(false);
    setShowResolvedQuestions(false);
    setEditingReplyId(null);
    setActivePageIdx(Math.max(0, pages.length - 1));
    setFeedbackNote(selectedStudent.teacherNote || '');
    setModalFeedbackItems(selectedStudent.feedbackItems || []);
  }, [selectedStudent?.number, currentTopic?.id, draftPages.length]);

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3200);
  };

  // [핵심] 구글 독스에서 Brisk로 넣은 첨삭(표/문단/댓글)을 자동으로 읽어와 채워주는 함수
  const handlePullFromDoc = async (isAutoFocus = false) => {
    if (!selectedStudent || !onPullFeedbackFromDoc || isPullingDoc) return;
    setIsPullingDoc(true);
    try {
      const res = await onPullFeedbackFromDoc(selectedStudent.number, currentTopic?.id);
      if (res && res.ok) {
        if (res.pulledNote && res.pulledNote.trim()) {
          setFeedbackNote(translateBriskTextToKorean(res.pulledNote.trim()));
        }
        if (Array.isArray(res.pulledComments) && res.pulledComments.length > 0) {
          setModalFeedbackItems(res.pulledComments);
        }
        setWaitingDocReturn(false);
        showToast(
          isAutoFocus
            ? '구글 독스 탭에서 돌아오신 것을 감지해 첨삭 내용을 한국어로 자동 변환해 가져왔습니다!'
            : '학생 구글 독스에서 첨삭 내용(GLOW·GROW·WONDERING 한국어 변환)을 자동으로 가져왔습니다!'
        );
      }
    } finally {
      setIsPullingDoc(false);
    }
  };

  // 선생님이 [학생 독스 열기]를 눌러 새 탭에 갔다가 다시 쓰담 탭으로 돌아오면(focus) 자동으로 독스 첨삭 동기화!
  useEffect(() => {
    if (!waitingDocReturn || !selectedStudent) return;
    const onWindowFocus = () => {
      handlePullFromDoc(true);
    };
    window.addEventListener('focus', onWindowFocus);
    return () => window.removeEventListener('focus', onWindowFocus);
  }, [waitingDocReturn, selectedStudent?.number]);

  const handleCopyStudentLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
      showToast('학생 입장 링크가 복사되었습니다! 학급 게시판에 안내해 주세요.');
    } catch (e) {}
  };

  // 해당 학생의 전용 구글 독스로 바로 연결 (아직 독스가 없으면 내 드라이브에 자동 생성!) + Brisk 프롬프트 자동 복사 + 탭 복귀 대기 활성화
  const handleOpenDocWithBrisk = async (st) => {
    setWaitingDocReturn(true);
    try {
      await navigator.clipboard.writeText(DEFAULT_BRISK_PROMPT);
    } catch (e) {}

    let targetDocId = st.docId;
    let targetDocUrl = st.docUrl;

    if (onEnsureStudentDoc) {
      showToast(`${st.name} 학생 구글 독스에 최신 본문을 동기화하고 있습니다...`);
      const ensured = await onEnsureStudentDoc(st, currentTopic);
      if (ensured && ensured.docId) {
        targetDocId = ensured.docId;
        targetDocUrl = ensured.docUrl;
      }
    }

    showToast(
      `${st.name} 학생 독스를 열었습니다! 독스에서 Brisk로 첨삭(Insert) 후 이 창으로 돌아오면 자동으로 가져옵니다.`
    );

    const targetUrl =
      targetDocId && !String(targetDocId).startsWith('DEMO_')
        ? `https://docs.google.com/document/d/${targetDocId}/edit`
        : targetDocUrl || 'https://docs.google.com/document/u/0/';
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  // 클립보드에서 종합 첨삭 바로 붙여넣기 도우미 (GLOW / GROW / WONDERING 자동 한국어 변환 포함)
  const handlePasteFromClipboard = async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText && clipText.trim()) {
        const translated = translateBriskTextToKorean(clipText.trim());
        setFeedbackNote((prev) =>
          prev.trim() ? `${prev}\n\n${translated}` : translated
        );
        showToast('클립보드의 첨삭 내용을 한국어 제목으로 변환해 붙여넣었습니다!');
      } else {
        showToast('클립보드가 비어 있습니다. 독스에서 첨삭을 복사한 뒤 눌러주세요.');
      }
    } catch (e) {
      showToast('입력창을 클릭하고 Ctrl+V를 눌러 붙여넣어 주세요.');
    }
  };

  // 선생님이 본문에서 드래그한 문장에 대한 부분 첨삭 추가
  const handleAddDraggedFeedback = () => {
    if (!draggedQuote.trim() || !newFbComment.trim()) return;
    const addedQuote = draggedQuote.trim();
    setModalFeedbackItems((prev) => [
      ...prev,
      {
        id: 'FB_' + Date.now(),
        quote: addedQuote,
        comment: newFbComment.trim()
      }
    ]);
    setHighlightedQuote(addedQuote);
    setDraggedQuote('');
    setNewFbComment('');
    showToast('선택한 문장에 부분 첨삭 메모가 추가되었습니다!');
  };

  const handleConfirmFeedbackDone = (e) => {
    e.preventDefault();
    if (!selectedStudent) return;
    onUpdateStudentStatus({
      number: selectedStudent.number,
      topicId: currentTopic?.id || '',
      status: 'FEEDBACK_DONE',
      locked: false,
      teacherNote: feedbackNote,
      feedbackItems: modalFeedbackItems
    });
    showToast(`${selectedStudent.name} 학생 공책으로 첨삭을 보내고 수정 모드를 열었습니다!`);
  };

  const parseRosterLines = (txt = '') =>
    txt
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+)\s*[번.,\t\s]*\s*(.+)$/);
        if (match) {
          return {
            number: match[1].trim(),
            name: match[2].trim()
          };
        }
        const parts = line.split(/[,\t\s]+/);
        return {
          number: parts[0]?.replace(/[^0-9]/g, '') || '',
          name: parts.slice(1).join(' ').trim() || parts[0]
        };
      })
      .filter((s) => s.number && s.name);

  const handleGoogleLogin = async () => {
    if (isLoggingInGoogle) return;
    setIsLoggingInGoogle(true);
    try {
      if (onTeacherGoogleLogin) {
        const res = await onTeacherGoogleLogin();
        if (res && res.mode === 'google') {
          showToast(
            res.isNewSheet
              ? '구글 로그인 완료! 내 드라이브에 [쓰담] 시트와 학생 연결이 자동 준비되었습니다!'
              : '구글 로그인 완료! 내 구글 드라이브의 [쓰담] 시트 데이터를 불러왔습니다!'
          );
        }
      }
      localStorage.setItem('sseudam_teacher_step_v2', 'classSelect');
      setTeacherStep('classSelect');
    } catch (err) {
      showToast(`구글 로그인 안내: ${err.message || '권한 허용 및 승인된 원본 주소를 확인해 주세요.'}`);
    } finally {
      setIsLoggingInGoogle(false);
    }
  };

  const handleCompleteClassSetup = async (e) => {
    e.preventDefault();
    const parsed = parseRosterLines(setupRosterText);
    const cleanName = setupClassName.trim() || '새 학급';
    if (onCreateClass) {
      await onCreateClass({
        className: cleanName,
        addList: parsed
      });
    } else if (onManageStudents) {
      await onManageStudents({
        className: cleanName,
        addList: parsed
      });
    }
    setSetupClassName('');
    setShowCreateClassModal(false);
    localStorage.setItem('sseudam_teacher_step_v2', 'bookshelf');
    setTeacherStep('bookshelf');
    showToast(`[${cleanName}] 학급과 학생 명단이 생성되었습니다!`);
  };

  const handleAddSingleStudent = (e) => {
    e.preventDefault();
    if (!newStNumber.trim() || !newStName.trim()) return;
    onManageStudents?.({
      className: setupClassName,
      addList: [{ number: newStNumber.trim(), name: newStName.trim() }]
    });
    setNewStNumber('');
    setNewStName('');
    showToast('학생이 추가되었습니다!');
  };

  const handleAddBulkStudents = () => {
    const parsed = parseRosterLines(bulkAddText);
    if (parsed.length === 0) return;
    onManageStudents?.({
      className: setupClassName,
      addList: parsed
    });
    setBulkAddText('');
    showToast(`${parsed.length}명의 학생이 일괄 추가되었습니다!`);
  };

  const handleCreateTopicSubmit = (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    onCreateNewTopic({
      title: newTitle.trim(),
      prompt:
        newPrompt.trim() ||
        '내 생각과 느낌이 잘 드러나도록 시작·가운데·끝 문단을 나누어 글을 써 보세요.'
    });
    setNewTitle('');
    setNewPrompt('');
    setShowCreateModal(false);
    showToast(`새 글쓰기 주제 공책이 생성되어 우리 반 학생 ${students.length}명에게 자동 연결되었습니다!`);
  };

  // 학급 또는 글쓰기 주제 삭제 실행 (deleteDriveFiles: false=목록만 삭제 / true=구글 독스 및 관련 자료 모두 삭제)
  const handleExecuteDelete = async (deleteDriveFiles = false) => {
    if (!deleteConfirmTarget || isDeletingTarget) return;
    setIsDeletingTarget(true);
    try {
      const { type, id, title } = deleteConfirmTarget;
      if (type === 'class') {
        const res = await onDeleteClass?.(id, { deleteDriveFiles });
        setDeleteConfirmTarget(null);
        showToast(
          deleteDriveFiles
            ? `[${title}] 학급과 관련 시트 기록·구글 독스 문서(${res?.deletedCount || 0}개)를 모두 삭제했습니다.`
            : `[${title}] 학급을 목록에서 삭제했습니다. (구글 드라이브 문서는 유지됨)`
        );
      } else if (type === 'topic') {
        const res = await onDeleteTopic?.(id, { deleteDriveFiles });
        if (String(openedTopicId) === String(id)) {
          setOpenedTopicId(null);
        }
        setDeleteConfirmTarget(null);
        showToast(
          deleteDriveFiles
            ? `[${title}] 주제와 관련 시트 기록·구글 독스 문서(${res?.deletedCount || 0}개)를 모두 삭제했습니다.`
            : `[${title}] 주제를 목록에서 삭제했습니다. (구글 드라이브 문서는 유지됨)`
        );
      }
    } finally {
      setIsDeletingTarget(false);
    }
  };

  const renderDeleteConfirmModal = () => {
    if (!deleteConfirmTarget) return null;
    const isClass = deleteConfirmTarget.type === 'class';
    const targetTitle = deleteConfirmTarget.title || (isClass ? '이 학급' : '이 주제');

    return (
      <div
        className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4"
        onClick={() => !isDeletingTarget && setDeleteConfirmTarget(null)}
      >
        <div
          className="w-full max-w-lg sketch-card bg-white p-6 sm:p-7 space-y-5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E2E8F0]">
            <div>
              <span className="inline-block px-2.5 py-0.5 rounded-full bg-[#FEF2F2] border border-[#FECACA] text-[11px] font-bold text-[#DC2626] mb-1.5">
                {isClass ? '학급 삭제 확인' : '글쓰기 주제 삭제 확인'}
              </span>
              <h3 className="text-lg font-bold text-[#1E293B]">
                [{targetTitle}] {isClass ? '학급을' : '주제를'} 삭제하시겠어요?
              </h3>
            </div>
            <button
              type="button"
              disabled={isDeletingTarget}
              onClick={() => setDeleteConfirmTarget(null)}
              className="p-1 rounded-lg text-[#64748B] hover:text-[#1E293B] cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <p className="text-xs sm:text-sm text-[#475569] leading-relaxed">
            아래 두 가지 삭제 방식 중 원하는 방식을 선택해 주세요.
          </p>

          <div className="space-y-3">
            {/* 선택지 1: 목록에서만 삭제 (드라이브 문서 보관) */}
            <button
              type="button"
              disabled={isDeletingTarget}
              onClick={() => handleExecuteDelete(false)}
              className="w-full text-left p-4 rounded-2xl bg-[#FBFBF9] hover:bg-[#F2F9F5] border-2 border-[#CBD5E1] hover:border-[#1B4332] transition cursor-pointer space-y-1 disabled:opacity-60"
            >
              <div className="text-sm font-bold text-[#1B4332] flex items-center justify-between">
                <span>1. 목록에서만 삭제하기 (구글 독스 파일 보관)</span>
                <span className="text-xs px-2 py-0.5 rounded-lg bg-white border border-[#CBD5E1] text-[#475569]">
                  문서 유지
                </span>
              </div>
              <p className="text-xs text-[#64748B] leading-relaxed">
                쓰담 화면 목록에서는 삭제하지만, 내 구글 드라이브에 이미 생성된 학생별 구글 독스 파일들은 지우지 않고 남겨둡니다.
              </p>
            </button>

            {/* 선택지 2: 관련 시트 기록 + 구글 독스 파일까지 모두 삭제 */}
            <button
              type="button"
              disabled={isDeletingTarget}
              onClick={() => handleExecuteDelete(true)}
              className="w-full text-left p-4 rounded-2xl bg-[#FEF2F2]/70 hover:bg-[#FEF2F2] border-2 border-[#FECACA] hover:border-[#DC2626] transition cursor-pointer space-y-1 disabled:opacity-60"
            >
              <div className="text-sm font-bold text-[#DC2626] flex items-center justify-between">
                <span>
                  {isDeletingTarget
                    ? '관련 구글 독스 및 시트 데이터 삭제 중...'
                    : '2. 관련 자료 모두 삭제하기 (시트 기록 + 구글 독스 삭제)'}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-lg bg-[#DC2626] text-white">
                  완전 삭제
                </span>
              </div>
              <p className="text-xs text-[#991B1B] leading-relaxed">
                쓰담 시트의 관련 기록을 비우고, 내 구글 드라이브에 생성된 관련 학생 구글 독스 문서들도 함께 휴지통으로 삭제합니다.
              </p>
            </button>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              disabled={isDeletingTarget}
              onClick={() => setDeleteConfirmTarget(null)}
              className="sketch-btn-secondary px-5 py-2 text-xs sm:text-sm font-bold"
            >
              취소
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderPrivacyModal = () => {
    if (!showPrivacyModal) return null;
    return (
      <div
        className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4"
        onClick={() => setShowPrivacyModal(false)}
      >
        <div
          className="w-full max-w-lg max-h-[88vh] flex flex-col sketch-card bg-white p-6 sm:p-7 space-y-4 animate-in fade-in zoom-in-95 duration-150 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 헤더 */}
          <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0] shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-[#F2F9F5] text-[#1B4332] border border-[#B7E4C7]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
              </span>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-[#1B4332]">
                  개인정보 처리방침 및 데이터 안전 안내
                </h3>
                <p className="text-xs text-[#64748B]">
                  '쓰담'은 학교 현장과 학생들의 개인정보를 가장 소중히 여깁니다.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowPrivacyModal(false)}
              className="p-1.5 rounded-lg text-[#64748B] hover:text-[#1B4332] hover:bg-[#F2F9F5] transition cursor-pointer"
              title="닫기"
            >
              ✕
            </button>
          </div>

          {/* 본문 스크롤 영역 */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs sm:text-sm text-[#334155] leading-relaxed">
            <div className="p-3.5 rounded-xl bg-[#F8FAF9] border border-[#E2E8F0] space-y-1">
              <div className="font-bold text-[#1B4332] flex items-center gap-1.5">
                <span>1. 외부 중앙 서버 없는 100% 교사 드라이브 저장</span>
              </div>
              <p className="text-xs text-[#64748B] leading-relaxed break-keep">
                '쓰담'은 외부 데이터베이스나 별도의 회원 서버를 운영하지 않습니다. 학생들의 이름, 번호, 작성한 글, 교사 첨삭 등 모든 교육 활동 데이터는 <b>오직 로그인하신 선생님 본인의 구글 드라이브(Google Sheets & Docs)에만 직접 보관</b>됩니다.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-[#F8FAF9] border border-[#E2E8F0] space-y-1">
              <div className="font-bold text-[#1B4332] flex items-center gap-1.5">
                <span>2. 구글 계정 권한(OAuth)의 최소 사용</span>
              </div>
              <p className="text-xs text-[#64748B] leading-relaxed break-keep">
                구글 로그인 시 요청하는 권한은 오직 선생님 드라이브 내 <b>[쓰담] 전용 폴더 및 관련 시트·독스 파일의 생성과 수정에만 국한</b>됩니다. 선생님의 다른 개인 문서, 이메일, 개인 사진 등에는 일체 접근하지 못하며 조회 권한도 없습니다.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-[#F8FAF9] border border-[#E2E8F0] space-y-1">
              <div className="font-bold text-[#1B4332] flex items-center gap-1.5">
                <span>3. 학생 개인정보 수집 및 회원가입 제로</span>
              </div>
              <p className="text-xs text-[#64748B] leading-relaxed break-keep">
                학생들은 별도의 회원가입이나 계정 생성 없이, 선생님이 발급한 번호와 이름으로만 참여합니다. 학생의 주민번호, 연락처, 기기 식별값 등 어떠한 민감 개인정보도 수집하지 않습니다.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-[#F8FAF9] border border-[#E2E8F0] space-y-1">
              <div className="font-bold text-[#1B4332] flex items-center gap-1.5">
                <span>4. 제3자 제공 및 외부 유출 차단</span>
              </div>
              <p className="text-xs text-[#64748B] leading-relaxed break-keep">
                서비스 개발자나 제3자는 선생님 학급의 데이터에 기술적으로 접근할 수 없습니다. 모든 데이터의 소유권과 관리 권한은 전적으로 담당 선생님에게 있으며, 언제든 구글 드라이브에서 직접 백업하거나 완전히 삭제하실 수 있습니다.
              </p>
            </div>
          </div>

          {/* 하단 닫기 버튼 */}
          <div className="pt-2 border-t border-[#E2E8F0] flex justify-end shrink-0">
            <button
              type="button"
              onClick={() => setShowPrivacyModal(false)}
              className="sketch-btn px-5 py-2 text-xs sm:text-sm font-bold bg-[#1B4332] text-white rounded-xl cursor-pointer hover:bg-[#2D6A4F] transition"
            >
              확인했습니다
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================================
  // 단계 1: 교사 구글 로그인 화면 (구글 로그인 1번으로 내 드라이브에 시트·폴더 자동 생성!)
  // ============================================================================
  if (teacherStep === 'login') {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        {toastMsg && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-2xl bg-[#1B4332] text-white px-5 py-3 shadow-lg flex items-center gap-2 text-sm font-bold">
            <HandDrawnCheckIcon size={18} color="#52B788" />
            <span>{toastMsg}</span>
          </div>
        )}

        {renderPrivacyModal()}

        <div className="w-full max-w-md sketch-card bg-white p-7 sm:p-9 space-y-5 text-center">
          <div className="flex flex-col items-center">
            <HandDrawnNotebookLogo size={60} isOpen={true} />
            <span className="mt-3 px-3 py-1 rounded-full bg-[#F2F9F5] border border-[#B7E4C7] text-xs font-bold text-[#1B4332]">
              다정한 글쓰기 스튜디오
            </span>
            <h1 className="mt-2 text-2xl sm:text-3xl font-bold text-[#1B4332] font-editorial-serif tracking-tight">
              쓰담
            </h1>

            {/* 쓰담의 이름 뜻과 감성 소개 */}
            <div className="mt-3">
              <p className="text-sm sm:text-base font-bold text-[#1B4332] font-editorial-serif leading-snug break-keep">
                “아이들이 쓴 소중한 마음을 담고,<br />서툰 생각도 다정하게 쓰담쓰담”
              </p>
            </div>
          </div>

          <div className="w-full h-px bg-[#E2E8F0] my-1" />

          {/* 구글 로그인 버튼 */}
          <button
            type="button"
            disabled={isLoggingInGoogle}
            onClick={handleGoogleLogin}
            className="w-full h-13 rounded-2xl bg-white hover:bg-[#F2F9F5] border-2 border-[#1B4332] shadow-xs flex items-center justify-center gap-3 text-sm sm:text-base font-bold text-[#1E293B] cursor-pointer transition disabled:opacity-60"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.13-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
              />
            </svg>
            <span>
              {isLoggingInGoogle
                ? '내 구글 드라이브에 시트 자동 생성 중...'
                : 'Google 계정으로 시작하기'}
            </span>
          </button>

          {/* 로그인 버튼 아래: 드라이브 시트/폴더 자동 생성 안내 */}
          <div className="p-3.5 rounded-xl bg-[#F2F9F5] border border-[#B7E4C7] text-left space-y-1">
            <div className="text-xs font-bold text-[#1B4332] flex items-center gap-1.5">
              <span>첫 시작 안내</span>
            </div>
            <p className="text-xs text-[#4A5568] leading-relaxed break-keep">
              구글 계정으로 연결하면 <b>선생님 구글 드라이브</b>에 우리 반 전용 <b>[쓰담] 기록 시트와 독스 폴더가 자동 생성</b>되어, 별도의 번거로운 설정 없이 바로 수업을 시작할 수 있습니다.
            </p>
          </div>

          {/* 개인정보 처리방침 링크 */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowPrivacyModal(true)}
              className="text-xs text-[#64748B] hover:text-[#1B4332] underline underline-offset-4 inline-flex items-center gap-1.5 transition cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <span>개인정보 처리방침 및 데이터 안전 안내</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // 단계 2: 내 학급 선택 화면 (담임 및 전담 교사 다학급 선택 + 새 학급 생성)
  // ============================================================================
  if (teacherStep === 'classSelect') {
    return (
      <div className="flex-1 w-full px-6 lg:px-12 py-8 space-y-6">
        {toastMsg && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-2xl bg-[#1B4332] text-white px-5 py-3 shadow-lg flex items-center gap-2 text-sm font-bold">
            <HandDrawnCheckIcon size={18} color="#52B788" />
            <span>{toastMsg}</span>
          </div>
        )}

        <div className="sketch-card bg-white px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <HandDrawnNotebookLogo size={48} isOpen={true} />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold text-[#1B4332] font-editorial-serif">
                  내 학급 선택
                </h1>
                <span className="px-2.5 py-0.5 rounded-full bg-[#F2F9F5] border border-[#B7E4C7] text-xs font-bold text-[#1B4332]">
                  {googleAuth?.user?.email
                    ? `${googleAuth.user.email} · 구글 시트 자동 연동됨`
                    : '구글 드라이브 · 시트 자동 연동됨'}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">
                오늘 수업을 진행할 학급을 선택해 주세요.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {config.spreadsheetUrl && (
              <a
                href={config.spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="sketch-btn-secondary px-4 py-2.5 text-xs sm:text-sm font-bold flex items-center gap-1.5"
              >
                <ExternalLink className="w-4 h-4 text-[#1B4332]" />
                <span>자동 생성된 내 구글 시트 열기</span>
              </a>
            )}

            <button
              type="button"
              onClick={onOpenGasSetup}
              className="sketch-btn-secondary px-4 py-2.5 text-xs sm:text-sm font-bold flex items-center gap-1.5"
            >
              <RefreshCw className="w-4 h-4" />
              <span>학생 제출 연결</span>
            </button>

            <button
              type="button"
              onClick={() => onTeacherLogout?.()}
              className="sketch-btn-secondary px-4 py-2.5 text-xs sm:text-sm font-bold flex items-center gap-1.5"
            >
              <LogOut className="w-4 h-4" />
              <span>로그아웃</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSetupClassName('');
                setShowCreateClassModal(true);
              }}
              className="sketch-btn-primary px-5 py-2.5 text-xs sm:text-sm font-bold flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>새 학급 만들기</span>
            </button>
          </div>
        </div>

        {/* 학급 카드 그리드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {classes.map((cls) => {
            const isCurrent = cls.className === config.className;
            const legacyId = classes[0]?.id || config.activeClassId || '';
            const classStudentCount = allStudents.filter(
              (student) => String(student.classId || legacyId) === String(cls.id)
            ).length;
            const classTopicCount = allTopics.filter(
              (topic) => String(topic.classId || legacyId) === String(cls.id)
            ).length;
            return (
              <div
                key={cls.id}
                onClick={() => {
                  onSelectClass?.(cls);
                  localStorage.setItem('sseudam_teacher_step_v2', 'bookshelf');
                  setTeacherStep('bookshelf');
                }}
                className={`sketch-card sketch-card-hover p-6 flex flex-col justify-between cursor-pointer transition relative overflow-hidden min-h-[200px] ${
                  isCurrent
                    ? 'bg-white border-2 border-[#1B4332]'
                    : 'bg-[#FBFBF9] border-[#CBD5E1]'
                }`}
              >
                <div className="absolute left-0 top-0 bottom-0 w-2.5 bg-[#1B4332]" />

                <div className="pl-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2.5 py-0.5 rounded-full bg-[#F2F9F5] border border-[#B7E4C7] text-xs font-bold text-[#1B4332]">
                      담당 학급
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#64748B]">
                        개설일: {cls.createdAt}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmTarget({
                            type: 'class',
                            id: cls.id,
                            title: cls.className,
                            studentCount: classStudentCount,
                            topicCount: classTopicCount
                          });
                        }}
                        title="학급 삭제"
                        className="w-7 h-7 rounded-lg bg-white border border-[#CBD5E1] text-[#64748B] hover:text-[#DC2626] hover:border-[#DC2626] hover:bg-[#FEF2F2] flex items-center justify-center transition cursor-pointer shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <h2 className="text-xl sm:text-2xl font-bold text-[#1B4332] font-editorial-serif">
                      {cls.className}
                    </h2>
                    <p className="text-xs sm:text-sm text-[#475569] mt-1">
                      등록 학생 {classStudentCount}명 · 글쓰기 주제 {classTopicCount}개
                    </p>
                  </div>
                </div>

                <div className="pl-3 mt-5 pt-3.5 border-t border-[#E2E8F0] flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#2D6A4F]">
                    구글 시트 · 독스 연동됨
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-[#1B4332] inline-flex items-center gap-1.5">
                    <span>이 학급 책장 열기</span>
                    <HandDrawnArrowRightIcon size={15} color="#1B4332" />
                  </span>
                </div>
              </div>
            );
          })}

          {/* 새 학급 만들기 카드 */}
          <button
            type="button"
            onClick={() => {
              setSetupClassName('');
              setShowCreateClassModal(true);
            }}
            className="sketch-card bg-[#F2F9F5]/60 hover:bg-[#F2F9F5] border-2 border-dashed border-[#52B788] p-6 flex flex-col items-center justify-center text-center gap-3 min-h-[200px] cursor-pointer transition group"
          >
            <div className="w-13 h-13 rounded-2xl bg-white border border-[#52B788] flex items-center justify-center text-[#1B4332] group-hover:scale-105 transition">
              <Plus className="w-6 h-6" />
            </div>
            <div>
              <div className="text-base sm:text-lg font-bold text-[#1B4332]">
                새 학급 만들기
              </div>
              <p className="text-xs text-[#2D6A4F] mt-1">
                새 학급 이름과 학생 명단을 등록합니다
              </p>
            </div>
          </button>
        </div>

        {/* 새 학급 생성 모달 */}
        {showCreateClassModal && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4">
            <div className="w-full max-w-lg sketch-card bg-white p-6 sm:p-8 space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
                <h3 className="text-lg font-bold text-[#1B4332]">
                  새 학급 생성 및 학생 명단 등록
                </h3>
                <button
                  type="button"
                  onClick={() => setShowCreateClassModal(false)}
                  className="p-1 rounded-lg text-[#64748B] hover:text-[#1E293B] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCompleteClassSetup} className="space-y-4">
                <div>
                  <label className="block text-xs sm:text-sm font-bold text-[#1B4332] mb-1.5">
                    1. 학급 이름
                  </label>
                  <input
                    type="text"
                    value={setupClassName}
                    onChange={(e) => setSetupClassName(e.target.value)}
                    placeholder="예: 3학년 2반"
                    className="w-full h-12 px-4 rounded-xl border border-[#CBD5E1] bg-[#FBFBF9] text-sm sm:text-base font-bold text-[#1E293B]"
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs sm:text-sm font-bold text-[#1B4332]">
                      2. 학생 명단 등록 (번호 이름)
                    </label>
                    <span className="text-xs text-[#2D6A4F] font-semibold">
                      * 나중에 [학생 관리]에서 언제든 추가 가능
                    </span>
                  </div>
                  <textarea
                    rows={6}
                    value={setupRosterText}
                    onChange={(e) => setSetupRosterText(e.target.value)}
                    placeholder={"1 김소미\n2 이도윤\n3 박지우\n4 최예은\n5 정시우"}
                    className="w-full p-3.5 rounded-xl border border-[#CBD5E1] bg-[#FBFBF9] text-sm font-mono leading-relaxed"
                    required
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateClassModal(false)}
                    className="sketch-btn-secondary px-4 py-2.5 text-xs sm:text-sm font-bold"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    className="sketch-btn-primary px-6 py-2.5 text-xs sm:text-sm font-bold flex items-center gap-1.5"
                  >
                    <HandDrawnCheckIcon size={16} color="#FFFFFF" />
                    <span>학급 생성하고 책장 열기</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {renderDeleteConfirmModal()}
      </div>
    );
  }

  // ============================================================================
  // 단계 3: 선택한 학급의 『글쓰기 주제 책장』
  // ============================================================================
  if (!currentTopic) {
    return (
      <div className="flex-1 w-full px-6 lg:px-12 py-8 space-y-6">
        {toastMsg && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-2xl bg-[#1B4332] text-white px-5 py-3 shadow-lg flex items-center gap-2 text-sm font-bold">
            <HandDrawnCheckIcon size={18} color="#52B788" />
            <span>{toastMsg}</span>
          </div>
        )}

        <div className="sketch-card bg-white px-6 py-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 flex-wrap">
            <button
              type="button"
              onClick={() => {
                localStorage.setItem('sseudam_teacher_step_v2', 'classSelect');
                setTeacherStep('classSelect');
              }}
              className="sketch-btn-secondary px-3.5 py-2 text-xs sm:text-sm font-bold flex items-center gap-1.5 shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>내 학급 선택</span>
            </button>

            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold text-[#1B4332] font-editorial-serif">
                  글쓰기 주제 책장
                </h1>
                <span className="px-2.5 py-0.5 rounded-full bg-[#1B4332] text-white text-xs font-bold">
                  {config.className || '3학년 2반'}
                </span>
                <span className="px-2.5 py-0.5 rounded-full bg-[#F2F9F5] border border-[#B7E4C7] text-xs font-bold text-[#1B4332]">
                  총 {topics.length}개의 주제 · 학생 {students.length}명
                </span>
              </div>
              <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">
                주제를 선택해 학생 글을 첨삭하거나, 새 글쓰기 주제를 만들면 우리 반 학생({students.length}명)에게 자동으로 배부됩니다.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={onOpenGasSetup}
              className="sketch-btn-secondary px-4 py-2.5 text-xs sm:text-sm font-bold flex items-center gap-1.5"
            >
              <RefreshCw className="w-4 h-4 text-[#1B4332]" />
              <span>{gasUrl ? '학생 제출 연결됨' : '학생 제출 연결'}</span>
            </button>

            {/* 1. 학생 링크 · QR · 15개 PDF 안내 모달 버튼 */}
            <button
              type="button"
              onClick={() => setIsShareModalOpen(true)}
              className="sketch-btn-secondary px-4 py-2.5 text-xs sm:text-sm font-bold flex items-center gap-1.5"
            >
              <QrCode className="w-4 h-4 text-[#1B4332]" />
              <span>학생 링크 · QR 안내</span>
            </button>

            {/* 2. 우리 반 학생 관리 (학생 추가·수정) 버튼 */}
            <button
              type="button"
              onClick={() => setIsStudentManageOpen(true)}
              className="sketch-btn-secondary px-4 py-2.5 text-xs sm:text-sm font-bold flex items-center gap-1.5"
            >
              <Users className="w-4 h-4 text-[#1B4332]" />
              <span>학생 관리 ({students.length}명)</span>
            </button>

            {/* 3. 새 글쓰기 주제 공책 만들기 버튼 */}
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="sketch-btn-primary px-5 py-2.5 text-xs sm:text-sm font-bold flex items-center gap-1.5"
            >
              <FolderPlus className="w-4 h-4" />
              <span>새 글쓰기 주제 공책 만들기</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="sketch-card bg-[#F2F9F5]/60 hover:bg-[#F2F9F5] border-2 border-dashed border-[#52B788] p-6 flex flex-col items-center justify-center text-center gap-3 min-h-[240px] cursor-pointer transition group"
          >
            <div className="w-14 h-14 rounded-2xl bg-white border border-[#52B788] flex items-center justify-center text-[#1B4332] group-hover:scale-105 transition">
              <Plus className="w-7 h-7" />
            </div>
            <div>
              <div className="text-base sm:text-lg font-bold text-[#1B4332]">
                새 글쓰기 주제 공책 만들기
              </div>
              <p className="text-xs sm:text-sm text-[#2D6A4F] mt-1">
                우리 반 학생 {students.length}명의 공책이 자동으로 함께 생성됩니다
              </p>
            </div>
          </button>

          {topics.map((tp) => {
            const submittedCount = students.filter((rawSt) => {
              const stData = getStudentTopicData(rawSt, tp);
              return Boolean((stData?.draft1 || stData?.draft2 || stData?.draft3)?.trim());
            }).length;

            const waitingFeedbackCount = students.filter((rawSt) => {
              const stData = getStudentTopicData(rawSt, tp);
              return (
                stData?.status === 'STAGE_1_SUBMITTED' ||
                stData?.status === 'STAGE_2_SUBMITTED'
              );
            }).length;

            return (
              <div
                key={tp.id}
                onClick={() => {
                  onSelectTopic(tp.id);
                  setOpenedTopicId(tp.id);
                }}
                className={`sketch-card sketch-card-hover p-6 flex flex-col justify-between cursor-pointer transition relative overflow-hidden ${
                  tp.isActive
                    ? 'bg-white border-2 border-[#1B4332]'
                    : 'bg-[#FBFBF9] border-[#CBD5E1]'
                }`}
              >
                <div
                  className={`absolute left-0 top-0 bottom-0 w-2.5 ${
                    tp.isActive ? 'bg-[#1B4332]' : 'bg-[#52B788]'
                  }`}
                />

                <div className="pl-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    {tp.isActive ? (
                      <span className="px-2.5 py-0.5 rounded-full bg-[#1B4332] text-white text-xs font-bold">
                        현재 진행중인 주제
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full bg-white border border-[#CBD5E1] text-[#64748B] text-xs font-semibold">
                        지난 주제 · {tp.createdAt}
                      </span>
                    )}

                    <div className="flex items-center gap-1.5">
                      {waitingFeedbackCount > 0 && (
                        <span className="px-2.5 py-0.5 rounded-full bg-[#FEF3C7] border border-[#F59E0B] text-[#92400E] text-xs font-bold">
                          첨삭 대기 {waitingFeedbackCount}명
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmTarget({
                            type: 'topic',
                            id: tp.id,
                            title: tp.title
                          });
                        }}
                        title="주제 삭제"
                        className="w-7 h-7 rounded-lg bg-white border border-[#CBD5E1] text-[#64748B] hover:text-[#DC2626] hover:border-[#DC2626] hover:bg-[#FEF2F2] flex items-center justify-center transition cursor-pointer shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <h2 className="text-lg sm:text-xl font-bold text-[#1B4332] font-editorial-serif leading-snug">
                      {tp.title}
                    </h2>
                    <p className="text-xs sm:text-sm text-[#475569] mt-1.5 line-clamp-2 leading-relaxed">
                      {tp.prompt}
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#F2F9F5] border border-[#D8F3DC] flex items-center justify-between text-xs sm:text-sm">
                    <span className="font-semibold text-[#2D6A4F]">우리 반 작성 현황</span>
                    <span className="font-bold text-[#1B4332]">
                      {students.length}명 중 {submittedCount}명 작성됨
                    </span>
                  </div>
                </div>

                <div className="pl-3 mt-5 pt-3.5 border-t border-[#E2E8F0] flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#64748B]">
                    등록일: {tp.createdAt}
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-[#1B4332] inline-flex items-center gap-1.5">
                    <span>이 주제 관리실 열기</span>
                    <HandDrawnArrowRightIcon size={15} color="#1B4332" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* 모달 1: 새 글쓰기 주제 공책 만들기 (학생 명단은 학급에서 자동 연결!) */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4">
            <div className="w-full max-w-md sketch-card bg-white p-6">
              <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
                <h3 className="text-base font-bold text-[#1B4332]">
                  새 글쓰기 주제 공책 만들기
                </h3>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="p-1 rounded-lg text-[#64748B] hover:text-[#1E293B] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateTopicSubmit} className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-[#1B4332] mb-1">
                    새 글쓰기 주제 제목
                  </label>
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="예: 현장체험학습에서 가장 기억에 남는 일"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#CBD5E1] bg-[#FBFBF9] text-sm font-semibold"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#1B4332] mb-1">
                    학생 글쓰기 안내문
                  </label>
                  <textarea
                    rows={3}
                    value={newPrompt}
                    onChange={(e) => setNewPrompt(e.target.value)}
                    placeholder="예: 1문단(시작), 2문단(기억에 남는 장면), 3문단(느낀 점)으로 문단을 나누어 써 보세요."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#CBD5E1] bg-[#FBFBF9] text-sm"
                  />
                </div>

                <div className="p-3 rounded-xl bg-[#F2F9F5] border border-[#B7E4C7] text-xs font-semibold text-[#1B4332] flex items-center justify-between">
                  <span>자동 배부 대상 학생</span>
                  <span className="font-bold">우리 반 학생 전체 ({students.length}명)</span>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="sketch-btn-secondary px-4 py-2 text-xs font-bold"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    className="sketch-btn-primary px-5 py-2 text-xs font-bold"
                  >
                    새 주제 생성하기
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 모달 2: 우리 반 학생 관리 (학생 추가·삭제·학급명 수정) */}
        {isStudentManageOpen && (
          <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4 overflow-y-auto">
            <div className="w-full max-w-xl sketch-card bg-[#FBFBF9] p-6 sm:p-7 my-6 space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-[#CBD5E1]">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-[#1B4332]" />
                  <h3 className="text-lg font-bold text-[#1B4332]">
                    우리 반 학급 · 학생 명단 관리 ({students.length}명)
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsStudentManageOpen(false)}
                  className="p-1 rounded-lg text-[#64748B] hover:text-[#1E293B] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 학급 이름 변경 */}
              <div className="sketch-card bg-white p-4 space-y-2">
                <label className="block text-xs font-bold text-[#1B4332]">
                  우리 반 학급 이름
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={setupClassName}
                    onChange={(e) => setSetupClassName(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl border border-[#CBD5E1] bg-[#FBFBF9] text-sm font-bold"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      onManageStudents?.({ className: setupClassName, addList: [] });
                      showToast('학급 이름이 저장되었습니다!');
                    }}
                    className="sketch-btn-secondary px-3.5 py-2 text-xs font-bold"
                  >
                    이름 변경
                  </button>
                </div>
              </div>

              {/* 학생 1명 빠른 추가 */}
              <form
                onSubmit={handleAddSingleStudent}
                className="sketch-card bg-white p-4 space-y-2.5"
              >
                <div className="text-xs font-bold text-[#1B4332] flex items-center gap-1.5">
                  <UserPlus className="w-4 h-4" />
                  <span>전입생 · 새 학생 추가하기</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    max="99"
                    value={newStNumber}
                    onChange={(e) => setNewStNumber(e.target.value)}
                    placeholder="번호 (예: 6)"
                    className="w-28 px-3 py-2 rounded-xl border border-[#CBD5E1] bg-[#FBFBF9] text-xs font-bold"
                    required
                  />
                  <input
                    type="text"
                    value={newStName}
                    onChange={(e) => setNewStName(e.target.value)}
                    placeholder="학생 이름 (예: 강민준)"
                    className="flex-1 px-3 py-2 rounded-xl border border-[#CBD5E1] bg-[#FBFBF9] text-xs font-bold"
                    required
                  />
                  <button
                    type="submit"
                    className="sketch-btn-primary px-4 py-2 text-xs font-bold whitespace-nowrap"
                  >
                    + 학생 추가
                  </button>
                </div>
              </form>

              {/* 여러 명 한 번에 추가 */}
              <div className="sketch-card bg-white p-4 space-y-2">
                <div className="text-xs font-bold text-[#1B4332]">
                  여러 명 한 번에 추가 (번호 이름)
                </div>
                <div className="flex gap-2">
                  <textarea
                    rows={2}
                    value={bulkAddText}
                    onChange={(e) => setBulkAddText(e.target.value)}
                    placeholder={"6 강민준\n7 윤서아"}
                    className="flex-1 px-3 py-2 rounded-xl border border-[#CBD5E1] bg-[#FBFBF9] text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleAddBulkStudents}
                    className="sketch-btn-secondary px-3.5 py-2 text-xs font-bold whitespace-nowrap"
                  >
                    일괄 등록
                  </button>
                </div>
              </div>

              {/* 현재 등록된 학생 목록 */}
              <div className="sketch-card bg-white p-4 space-y-2">
                <div className="text-xs font-bold text-[#1B4332]">
                  현재 등록된 우리 반 학생 ({students.length}명)
                </div>
                <div className="max-h-48 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-2 pr-1">
                  {students.map((st) => (
                    <div
                      key={st.number}
                      className="px-3 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-between text-xs font-bold text-[#1E293B]"
                    >
                      <span>
                        {st.number}번 {st.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onManageStudents?.({
                            className: setupClassName,
                            addList: [],
                            removeNumber: st.number
                          });
                          showToast(`${st.name} 학생이 명단에서 삭제되었습니다.`);
                        }}
                        className="text-[#94A3B8] hover:text-[#DC2626] cursor-pointer"
                        title="학생 삭제"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsStudentManageOpen(false);
                    setTeacherStep('login');
                  }}
                  className="text-xs font-bold text-[#64748B] hover:text-[#1E293B] flex items-center gap-1 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>교사 로그인·학급 초기설정 화면 보기</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsStudentManageOpen(false)}
                  className="sketch-btn-primary px-5 py-2 text-xs font-bold"
                >
                  완료
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 모달 3: 학생 입장 링크 · QR · QR 이미지 다운로드 · 15개 PDF 다운로드 */}
        <StudentShareModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          className={config.className}
          spreadsheetId={config.spreadsheetId || ''}
          gasUrl={gasUrl}
          classId={config.activeClassId || ''}
          classAccessKey={classAccessKey}
          onOpenGasSetup={onOpenGasSetup}
        />

        {renderDeleteConfirmModal()}
      </div>
    );
  }

  // ============================================================================
  // 화면 2: 선택한 주제의 『3단 와이드 학생 글 · 첨삭 관리실』
  // ============================================================================
  const studentQuestions = questions.filter(
    (q) =>
      String(q.number) === String(selectedStudent?.number) &&
      (!currentTopic?.id || !q.topicId || q.topicId === currentTopic.id)
  );
  const unresolvedQuestions = studentQuestions.filter(
    (q) => !q.resolved && q.resolved !== 'TRUE'
  );
  const resolvedQuestions = studentQuestions.filter(
    (q) => q.resolved || q.resolved === 'TRUE'
  );

  const safePageIdx = Math.min(activePageIdx, Math.max(0, draftPages.length - 1));
  const currentDraftPage = draftPages[safePageIdx] || {
    round: 1,
    label: '1차 글',
    text: ''
  };
  const prevDraftPage = safePageIdx > 0 ? draftPages[safePageIdx - 1] : null;
  const currentStudentText = currentDraftPage.text || '';

  const paragraphCount = currentStudentText
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n|\n/)
    .filter((p) => p.trim().length > 0).length;

  return (
    <div className="flex-1 w-full px-6 lg:px-10 py-5 flex flex-col gap-5">
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-2xl bg-[#1B4332] text-white px-5 py-3 shadow-lg flex items-center gap-2 text-sm font-bold">
          <HandDrawnCheckIcon size={18} color="#52B788" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 상단 바: [← 주제 책장으로] + 현재 열린 주제 제목 + [학급 전체 마감] */}
      <div className="w-full bg-white border border-[#CBD5E1] rounded-2xl px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <button
            type="button"
            onClick={() => setOpenedTopicId(null)}
            className="sketch-btn-secondary px-3.5 py-2 text-xs sm:text-sm font-bold flex items-center gap-1.5 shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>주제 책장으로</span>
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-xl font-bold text-[#1B4332] truncate font-editorial-serif">
                {currentTopic.title}
              </h1>
              <span className="text-xs text-[#64748B] hidden md:inline">
                ({currentTopic.createdAt})
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setIsShareModalOpen(true)}
            className="sketch-btn-secondary px-3.5 py-2 text-xs sm:text-sm font-bold flex items-center gap-1.5"
          >
            <QrCode className="w-4 h-4 text-[#1B4332]" />
            <span>학생 링크 · QR 안내</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const nextLock = !Boolean(currentTopic.classLocked);
              onBatchDeadline({ lockAll: nextLock, topicId: currentTopic.id });
              showToast(
                nextLock
                  ? '전체 학생 공책을 제출 마감(잠금)했습니다.'
                  : '전체 학생 공책의 잠금을 해제했습니다.'
              );
            }}
            className={`px-3.5 py-2 text-xs sm:text-sm font-bold flex items-center gap-1.5 ${
              currentTopic.classLocked ? 'sketch-btn-coral' : 'sketch-btn-secondary'
            }`}
          >
            <HandDrawnLockIcon
              size={15}
              locked={Boolean(currentTopic.classLocked)}
              color={currentTopic.classLocked ? '#DC2626' : '#1B4332'}
            />
            <span>{currentTopic.classLocked ? '전체 마감 해제' : '이 주제 전체 마감'}</span>
          </button>
        </div>
      </div>

      {/* 2. 3단 와이드 데스크톱 워크스페이스 (좌측 명단 3 : 가운데 학생 글 5 : 우측 첨삭 패널 4) */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* [좌측 3칸] 우리 반 학생 명단 사이드바 (26명 이상이어도 독립 스크롤 고정 + 질문·첨삭 대기 상단 배치) */}
        <div className="lg:col-span-3 sketch-card bg-white p-5 flex flex-col max-h-[420px] lg:max-h-[calc(100dvh-165px)] lg:sticky lg:top-20 overflow-hidden">
          {(() => {
            const enrichedList = students.map((rawSt) => {
              const st = getStudentTopicData(rawSt, currentTopic);
              const unresolvedCount = questions.filter(
                (q) =>
                  String(q.number) === String(st.number) &&
                  !q.resolved &&
                  q.resolved !== 'TRUE'
              ).length;
              const isWaitingFeedback =
                st.status === 'STAGE_1_SUBMITTED' || st.status === 'STAGE_2_SUBMITTED';
              const priorityScore =
                (unresolvedCount > 0 ? 200 : 0) + (isWaitingFeedback ? 100 : 0);

              return {
                rawSt,
                st,
                unresolvedCount,
                isWaitingFeedback,
                needsAction: unresolvedCount > 0 || isWaitingFeedback,
                priorityScore
              };
            });

            const actionNeededList = enrichedList
              .filter((item) => item.needsAction)
              .sort(
                (a, b) =>
                  b.priorityScore - a.priorityScore ||
                  Number(a.st.number) - Number(b.st.number)
              );

            const normalList = enrichedList
              .filter((item) => !item.needsAction)
              .sort((a, b) => Number(a.st.number) - Number(b.st.number));

            const numberSortedList = [...enrichedList].sort(
              (a, b) => Number(a.st.number) - Number(b.st.number)
            );

            const renderStudentRow = ({ rawSt, st, unresolvedCount, needsAction }) => {
              const isSelected = String(st.number) === String(selectedStudent?.number);
              const meta = STAGE_META[st.status] || STAGE_META.STAGE_1_WRITING;
              const textLen = (
                st.draft4 ||
                st.draft3 ||
                st.draft2 ||
                st.draft1 ||
                ''
              ).trim().length;

              return (
                <div
                  key={st.number}
                  className={`relative w-full text-left p-3 rounded-2xl border transition flex items-center justify-between gap-2 cursor-pointer ${
                    isSelected
                      ? 'bg-[#F2F9F5] border-2 border-[#1B4332] shadow-xs'
                      : needsAction
                      ? 'bg-[#FFFBEB]/70 border-[#FDE68A] hover:bg-white hover:border-[#1B4332]'
                      : 'bg-[#FBFBF9] border-[#E2E8F0] hover:bg-white hover:border-[#52B788]'
                  }`}
                >
                  {/* 카카오톡 알림처럼 오른쪽 위 모서리에 걸치는 빨간색 질문 배지 */}
                  {unresolvedCount > 0 && (
                    <span className="absolute -top-2 -right-1.5 z-10 px-2 py-0.5 min-w-[22px] h-[22px] rounded-full bg-[#EF4444] text-white text-[11px] font-extrabold flex items-center justify-center gap-0.5 shadow-sm ring-2 ring-white">
                      <span>질문 {unresolvedCount}</span>
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => setSelectedStudentNumber(st.number)}
                    className="flex-1 min-w-0 flex items-center justify-between gap-2 text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 ${
                          isSelected
                            ? 'bg-[#1B4332] text-white'
                            : 'bg-white border border-[#CBD5E1] text-[#1B4332]'
                        }`}
                      >
                        {st.number}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-[#1E293B] truncate">
                          {st.name}
                        </div>
                        <div className="text-[11px] text-[#64748B] truncate">
                          {textLen > 0 ? `${textLen}자 작성됨` : '작성 전'}
                        </div>
                      </div>
                    </div>

                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${meta.badgeBg} ${meta.badgeBorder} ${meta.badgeText}`}
                    >
                      {meta.shortLabel}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onPreviewAsStudent(rawSt, currentTopic?.id)}
                    className="relative z-10 p-1.5 rounded-lg bg-white border border-[#CBD5E1] text-[#475569] hover:text-[#1B4332] hover:border-[#1B4332] cursor-pointer shrink-0"
                    title={`${st.name} 학생 공책 바로 보기`}
                    aria-label={`${st.name} 학생 공책 바로 보기`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            };

            return (
              <>
                <div className="flex items-center justify-between gap-2 pb-3 mb-2 border-b border-[#E2E8F0] shrink-0">
                  <h2 className="text-sm sm:text-base font-bold text-[#1B4332] whitespace-nowrap">
                    우리 반 학생 ({students.length}명)
                  </h2>

                  <div className="inline-flex rounded-xl bg-[#F8FAFC] border border-[#CBD5E1] p-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setStudentSortMode('priority')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                        studentSortMode === 'priority'
                          ? 'bg-[#1B4332] text-white'
                          : 'text-[#475569] hover:text-[#1B4332]'
                      }`}
                    >
                      할 일 우선
                      {actionNeededList.length > 0 ? ` (${actionNeededList.length})` : ''}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStudentSortMode('number')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                        studentSortMode === 'number'
                          ? 'bg-[#1B4332] text-white'
                          : 'text-[#475569] hover:text-[#1B4332]'
                      }`}
                    >
                      번호순
                    </button>
                  </div>
                </div>

                <div className="space-y-2.5 flex-1 overflow-y-auto pt-2 pr-1.5">
                  {studentSortMode === 'priority' && actionNeededList.length > 0 ? (
                    <>
                      <div className="px-2 py-1 rounded-lg bg-[#FEF3C7]/80 border border-[#FDE68A] text-[11px] font-bold text-[#92400E] flex items-center justify-between">
                        <span>첨삭 · 답변 대기 학생</span>
                        <span>{actionNeededList.length}명</span>
                      </div>
                      <div className="space-y-2.5">
                        {actionNeededList.map(renderStudentRow)}
                      </div>

                      {normalList.length > 0 && (
                        <>
                          <div className="pt-2 px-1 text-[11px] font-bold text-[#64748B] flex items-center justify-between border-t border-dashed border-[#CBD5E1]">
                            <span>작성 중 · 첨삭 완료 학생</span>
                            <span>{normalList.length}명</span>
                          </div>
                          <div className="space-y-2.5">
                            {normalList.map(renderStudentRow)}
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    numberSortedList.map(renderStudentRow)
                  )}
                </div>
              </>
            );
          })()}
        </div>

        {/* [가운데 5칸] 선택한 학생의 글 (완성본 기본 표시 + 다회차 페이지 넘김 + 초록 글씨 토글) */}
        {selectedStudent && (
          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="flex-1 sketch-card bg-white p-6 flex flex-col">
              <div className="flex items-center justify-between gap-2 pb-3 mb-3 border-b border-[#E2E8F0] flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-1 rounded-lg bg-[#1B4332] text-white text-xs font-bold">
                    {selectedStudent.number}번 {selectedStudent.name}
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-[#F8FAFC] border border-[#CBD5E1] text-xs font-bold text-[#475569]">
                    {paragraphCount}개 문단 · {currentStudentText.trim().length}자
                  </span>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setIsDiffModalOpen(true)}
                    className="sketch-btn-secondary px-3 py-1.5 text-xs font-bold flex items-center gap-1.5"
                  >
                    <HandDrawnDiffIcon size={14} color="#1B4332" />
                    <span>나란히 크게 비교</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPortfolioStudent(rawSelectedStudent)}
                    className="px-2.5 py-1.5 rounded-xl bg-[#F2F9F5] border border-[#52B788] text-xs font-bold text-[#1B4332] hover:bg-[#D8F3DC] flex items-center gap-1 cursor-pointer"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>주제별 모음</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onPreviewAsStudent(rawSelectedStudent, currentTopic?.id)}
                    className="px-2.5 py-1.5 rounded-xl bg-[#FBFBF9] border border-[#CBD5E1] text-xs font-bold text-[#475569] hover:text-[#1B4332] flex items-center gap-1 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>학생 공책 바로 보기</span>
                  </button>
                </div>
              </div>

              {/* 왼쪽: 초록 글씨 표시 버튼 / 오른쪽: 다회차(1차·2차·3차·4차...) 공책 페이지 넘김 바 */}
              <div className="flex items-center justify-between gap-2 bg-[#F2F9F5] border border-[#B7E4C7] px-3.5 py-2 rounded-xl mb-3 flex-wrap">
                <div className="flex items-center gap-2">
                  {prevDraftPage ? (
                    <button
                      type="button"
                      onClick={() => setShowGreenText((prev) => !prev)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
                        showGreenText
                          ? 'bg-[#15803D] text-white border-[#15803D]'
                          : 'bg-white text-[#15803D] border-[#86EFAC] hover:border-[#15803D]'
                      }`}
                    >
                      {showGreenText
                        ? '초록 글씨 표시: 켜짐'
                        : '고친 표현 초록 글씨로 보기'}
                    </button>
                  ) : (
                    <span className="text-xs font-bold text-[#1B4332]">
                      현재 1차 초안 (문장 드래그 시 부분 첨삭 가능)
                    </span>
                  )}
                </div>

                {draftPages.length > 1 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      disabled={safePageIdx <= 0}
                      onClick={() => setActivePageIdx((p) => Math.max(0, p - 1))}
                      className="p-1 rounded-lg bg-white border border-[#CBD5E1] text-[#1B4332] disabled:opacity-35 cursor-pointer"
                      title="이전 차수 글 보기"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>

                    <div className="inline-flex items-center gap-1">
                      {draftPages.map((pg, idx) => (
                        <button
                          key={pg.round}
                          type="button"
                          onClick={() => setActivePageIdx(idx)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                            idx === safePageIdx
                              ? 'bg-[#1B4332] text-white'
                              : 'bg-white text-[#1B4332] border border-[#CBD5E1] hover:bg-[#D8F3DC]'
                          }`}
                        >
                          {pg.label}
                          {idx === draftPages.length - 1 ? ' (완성본)' : ''}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      disabled={safePageIdx >= draftPages.length - 1}
                      onClick={() =>
                        setActivePageIdx((p) => Math.min(draftPages.length - 1, p + 1))
                      }
                      className="p-1 rounded-lg bg-white border border-[#CBD5E1] text-[#1B4332] disabled:opacity-35 cursor-pointer"
                      title="다음 차수 글 보기"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* 학생 공책과 100% 동일한 글씨 크기(19.5px)로 시원하게 표시 */}
              <div
                onMouseUp={() => {
                  const sel = window.getSelection()?.toString().trim();
                  if (sel && sel.length >= 2) {
                    setDraggedQuote(sel);
                    setHighlightedQuote(sel);
                  }
                }}
                className="flex-1 min-h-[420px] lined-paper p-5 sm:p-6 rounded-2xl border border-[#CBD5E1] font-editorial-serif text-lg sm:text-[19.5px] text-[#1E293B] whitespace-pre-wrap leading-8 select-text cursor-text"
              >
                <div className="mb-8">
                  <h3 className="text-center text-xl sm:text-2xl font-bold text-[#1E293B]">
                    {selectedStudent.pieceTitle || currentTopic.title}
                  </h3>
                  <div className="mt-3 text-right text-sm sm:text-base font-semibold text-[#475569]">
                    {selectedStudent.name}
                  </div>
                </div>
                {currentStudentText ? (
                  showGreenText && prevDraftPage ? (
                    renderTextWithGreenAdditions(
                      prevDraftPage.text,
                      currentStudentText,
                      highlightedQuote
                    )
                  ) : (
                    renderTextWithHighlight(currentStudentText, highlightedQuote)
                  )
                ) : (
                  <span className="text-[#94A3B8]">아직 제출된 글이 없습니다.</span>
                )}
              </div>
            </div>

            {/* [미답변 질문] 답변 대기 중인 질문만 노란 카드로 표시! 답변 완료하면 즉시 사라져 자리를 차지하지 않음 */}
            {unresolvedQuestions.length > 0 && (
              <div className="sketch-card bg-[#FFFBEB] border-[#F59E0B] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#92400E]">
                    <HandDrawnChatIcon size={15} color="#92400E" />
                    <span>
                      {selectedStudent.name} 학생의 새 질문 ({unresolvedQuestions.length}건)
                    </span>
                  </div>
                  <span className="text-[11px] text-[#B45309]">
                    답변 등록 시 이 창은 자동으로 닫힙니다
                  </span>
                </div>

                <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                  {unresolvedQuestions.map((q, idx) => (
                    <div
                      key={q.id}
                      className="space-y-2 bg-white p-3 rounded-xl border border-[#FCD34D]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-full bg-[#EF4444] text-white text-[10px] font-bold shrink-0">
                          질문 {idx + 1}
                        </span>
                        <div className="text-xs sm:text-sm font-bold text-[#1E293B]">
                          "{q.question}"
                        </div>
                      </div>

                      {q.quote && (
                        <button
                          type="button"
                          onClick={() => setHighlightedQuote(q.quote)}
                          className="text-left text-[11px] font-semibold text-[#92400E] bg-[#FEF9C3] px-2.5 py-1 rounded-lg hover:underline cursor-pointer"
                        >
                          관련 문장 형광펜 보기: "{q.quote}"
                        </button>
                      )}

                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={replyTexts[q.id] || ''}
                          onChange={(e) =>
                            setReplyTexts({ ...replyTexts, [q.id]: e.target.value })
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (!replyTexts[q.id]?.trim()) return;
                              onReplyQuestion(q.id, replyTexts[q.id].trim());
                              showToast('질문에 답변을 보냈습니다!');
                            }
                          }}
                          placeholder="학생에게 답변을 적고 등록을 누르면 완료 처리됩니다"
                          className="flex-1 px-3 py-1.5 rounded-xl border border-[#CBD5E1] bg-[#FBFBF9] text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!replyTexts[q.id]?.trim()) return;
                            onReplyQuestion(q.id, replyTexts[q.id].trim());
                            showToast('질문에 답변을 보냈습니다!');
                          }}
                          className="sketch-btn-primary px-3.5 py-1.5 text-xs font-bold whitespace-nowrap"
                        >
                          답변 등록
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* [답변 완료된 질문] 평소에는 자리를 차지하지 않도록 한 줄 버튼으로 접어두고, 펼치면 [답변 수정] 가능! */}
            {resolvedQuestions.length > 0 && (
              <div className="text-xs">
                <button
                  type="button"
                  onClick={() => setShowResolvedQuestions((prev) => !prev)}
                  className="px-3 py-1.5 rounded-xl bg-white border border-[#CBD5E1] text-[#64748B] hover:text-[#1B4332] font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <HandDrawnCheckIcon size={13} color="#2D6A4F" />
                  <span>
                    {showResolvedQuestions
                      ? `답변 완료한 질문 접기 (${resolvedQuestions.length}건)`
                      : `답변 완료한 지난 질문 보기 · 수정 (${resolvedQuestions.length}건)`}
                  </span>
                </button>

                {showResolvedQuestions && (
                  <div className="mt-2 space-y-2 p-3 rounded-2xl bg-white border border-[#E2E8F0]">
                    {resolvedQuestions.map((q, idx) => {
                      const isEditing = editingReplyId === q.id;
                      return (
                        <div
                          key={q.id}
                          className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-bold text-[#475569]">
                              질문 {idx + 1}: "{q.question}"
                            </div>
                            {!isEditing && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingReplyId(q.id);
                                  setEditingReplyText(q.reply || '');
                                }}
                                className="px-2 py-0.5 rounded-lg bg-white border border-[#CBD5E1] hover:border-[#1B4332] text-[11px] font-bold text-[#1B4332] flex items-center gap-1 shrink-0 cursor-pointer"
                              >
                                <Pencil className="w-3 h-3" />
                                <span>답변 수정</span>
                              </button>
                            )}
                          </div>

                          {isEditing ? (
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={editingReplyText}
                                onChange={(e) => setEditingReplyText(e.target.value)}
                                className="flex-1 px-3 py-1.5 rounded-xl border border-[#1B4332] bg-white text-xs"
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (!editingReplyText.trim()) return;
                                  onReplyQuestion(q.id, editingReplyText.trim());
                                  setEditingReplyId(null);
                                  showToast('답변을 수정했습니다!');
                                }}
                                className="sketch-btn-primary px-3 py-1.5 text-xs font-bold whitespace-nowrap"
                              >
                                수정 저장
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingReplyId(null)}
                                className="sketch-btn-secondary px-2.5 py-1.5 text-xs font-bold whitespace-nowrap"
                              >
                                취소
                              </button>
                            </div>
                          ) : (
                            <div className="text-[#1B4332] font-bold">
                              ↳ 선생님 답변: {q.reply}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* [우측 4칸] 큰 칸의 종합 첨삭 노트 기본 + 문장 드래그 시에만 나타나는 부분 첨삭 */}
        {selectedStudent && (
          <form
            onSubmit={handleConfirmFeedbackDone}
            className="lg:col-span-4 sketch-card bg-[#FBFBF9] p-6 flex flex-col justify-between gap-5"
          >
            <div className="space-y-4 flex-1 flex flex-col">
              {/* 상단: 학생 구글 독스 바로 열기 (Brisk 실행용) + 독스 첨삭 자동 가져오기 */}
              <div className="p-3.5 rounded-2xl bg-[#F2F9F5] border border-[#B7E4C7] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-bold text-[#1B4332]">
                      {selectedStudent.name} 학생 전용 구글 독스 연동
                    </div>
                    <div className="text-[11px] text-[#2D6A4F]">
                      독스에서 Brisk로 첨삭(Insert) 후 돌아오면 자동으로 읽어옵니다
                    </div>
                  </div>
                  {waitingDocReturn && (
                    <span className="px-2 py-0.5 rounded-full bg-[#FEF3C7] border border-[#F59E0B] text-[#92400E] text-[10px] font-bold shrink-0">
                      독스 복귀 대기중
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenDocWithBrisk(selectedStudent)}
                    className="sketch-btn-primary px-3 py-2 text-xs font-bold flex items-center justify-center gap-1.5"
                  >
                    <HandDrawnDocIcon size={14} color="#FFFFFF" />
                    <span>1. 학생 독스 열기</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handlePullFromDoc(false)}
                    disabled={isPullingDoc}
                    className={`px-3 py-2 text-xs font-bold flex items-center justify-center gap-1.5 rounded-xl border transition cursor-pointer ${
                      waitingDocReturn
                        ? 'bg-[#FEF9C3] border-2 border-[#F59E0B] text-[#92400E] shadow-xs'
                        : 'sketch-btn-secondary'
                    }`}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isPullingDoc ? 'animate-spin' : ''}`} />
                    <span>
                      {isPullingDoc ? '가져오는 중...' : '2. 독스 첨삭 자동 가져오기'}
                    </span>
                  </button>
                </div>
              </div>

              {/* [핵심 1] 선생님이 가운데 본문에서 문장을 드래그했을 때만 스르륵 나타나는 부분 첨삭 입력창! */}
              {draggedQuote && (
                <div className="p-4 rounded-2xl bg-[#FEF9C3] border-2 border-[#F59E0B] space-y-2.5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#92400E] flex items-center gap-1">
                      <HandDrawnPencilIcon size={14} color="#92400E" />
                      <span>드래그한 문장에 부분 첨삭 달기</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setDraggedQuote('');
                        setHighlightedQuote('');
                      }}
                      className="text-xs font-bold text-[#92400E] hover:underline cursor-pointer"
                    >
                      닫기
                    </button>
                  </div>

                  <div className="px-3 py-1.5 rounded-xl bg-white/90 text-xs font-bold text-[#78350F] font-editorial-serif">
                    "{draggedQuote}"
                  </div>

                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={newFbComment}
                      onChange={(e) => setNewFbComment(e.target.value)}
                      placeholder="이 문장을 어떻게 고치면 좋을지 적어주세요"
                      className="flex-1 px-3 py-2 rounded-xl border border-[#F59E0B] bg-white text-xs sm:text-sm focus:outline-none"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={handleAddDraggedFeedback}
                      className="sketch-btn-primary px-3.5 py-2 text-xs font-bold flex items-center gap-1 whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>추가</span>
                    </button>
                  </div>
                </div>
              )}

              {/* [핵심 2] 큼직하고 넓은 『선생님의 종합 첨삭 노트』 (Brisk 복사·붙여넣기 메인 영역!) */}
              <div className="flex-1 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-bold text-[#1B4332] flex items-center gap-1.5">
                    <HandDrawnSparkleIcon size={17} color="#1B4332" />
                    <span>선생님의 종합 첨삭 노트</span>
                  </label>
                  <button
                    type="button"
                    onClick={handlePasteFromClipboard}
                    className="px-2.5 py-1 rounded-lg bg-white border border-[#CBD5E1] hover:border-[#1B4332] text-xs font-bold text-[#1B4332] flex items-center gap-1 cursor-pointer"
                    title="독스(Brisk)에서 복사한 첨삭을 한 번에 붙여넣습니다"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" />
                    <span>복사한 첨삭 붙여넣기</span>
                  </button>
                </div>

                <textarea
                  rows={10}
                  value={feedbackNote}
                  onChange={(e) => setFeedbackNote(e.target.value)}
                  placeholder="학생 독스에서 Brisk로 생성한 첨삭(칭찬할 점, 보완할 점 등)을 여기에 그대로 붙여넣거나(Ctrl+V), 학생에게 해주고 싶은 종합 조언을 자유롭게 작성해 보세요."
                  className="flex-1 min-h-[240px] w-full p-4 rounded-2xl border border-[#CBD5E1] bg-white text-sm text-[#1E293B] leading-relaxed focus:outline-none focus:border-[#1B4332] resize-y"
                />
              </div>

              {/* 드래그해서 추가한 문장별 부분 첨삭이 있을 때만 깔끔하게 표시 */}
              {modalFeedbackItems.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-[#E2E8F0]">
                  <div className="flex items-center justify-between text-xs font-bold text-[#2D6A4F]">
                    <span>드래그하여 추가한 문장별 첨삭 ({modalFeedbackItems.length}건)</span>
                    <span className="text-[11px] font-normal text-[#64748B]">
                      클릭 시 본문 형광펜 표시
                    </span>
                  </div>

                  <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                    {modalFeedbackItems.map((item) => {
                      const isHighlighted =
                        highlightedQuote && highlightedQuote === item.quote;

                      return (
                        <div
                          key={item.id}
                          onClick={() => {
                            if (!item.quote) return;
                            setHighlightedQuote(isHighlighted ? '' : item.quote);
                          }}
                          className={`p-2.5 rounded-xl bg-white border transition flex items-start justify-between gap-2 text-xs cursor-pointer ${
                            isHighlighted
                              ? 'border-2 border-[#F59E0B] shadow-2xs'
                              : 'border-[#CBD5E1] hover:border-[#1B4332]'
                          }`}
                        >
                          <div className="space-y-1.5 min-w-0 flex-1">
                            {item.quote && (
                              <div className="inline-block font-bold text-[#92400E] bg-[#FEF08A]/85 px-2 py-0.5 rounded font-editorial-serif">
                                "{item.quote}"
                              </div>
                            )}
                            <div className="text-[#1E293B] bg-white pt-0.5">
                              → {item.comment}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setModalFeedbackItems((prev) =>
                                prev.filter((x) => x.id !== item.id)
                              );
                            }}
                            className="p-1 text-[#94A3B8] hover:text-[#DC2626] cursor-pointer shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {(() => {
              const hasUnsentFeedback =
                feedbackNote.trim() !== (selectedStudent?.teacherNote || '').trim() ||
                JSON.stringify(modalFeedbackItems) !==
                  JSON.stringify(selectedStudent?.feedbackItems || []);

              return (
                <div className="space-y-1.5">
                  {hasUnsentFeedback && (
                    <div className="text-center text-xs font-bold text-[#B45309] bg-[#FEF3C7] border border-[#FCD34D] rounded-xl py-1.5 px-3">
                      새로 작성·수정한 첨삭이 있습니다. 아래 버튼을 눌러 전송해 주세요!
                    </div>
                  )}
                  <button
                    type="submit"
                    className={`w-full h-13 text-sm sm:text-base font-bold flex items-center justify-center gap-2 rounded-2xl transition cursor-pointer ${
                      hasUnsentFeedback
                        ? 'bg-[#D97706] hover:bg-[#B45309] text-white border-2 border-[#92400E] shadow-md'
                        : 'sketch-btn-primary'
                    }`}
                  >
                    <HandDrawnCheckIcon size={18} color="#FFFFFF" />
                    <span>학생 공책으로 첨삭 보내기</span>
                  </button>
                </div>
              );
            })()}
          </form>
        )}
      </div>

      {/* [처음 글 · 고쳐 쓴 글 크게 비교하기] 초대형 모달 */}
      <GrowthDiffModal
        isOpen={isDiffModalOpen}
        onClose={() => setIsDiffModalOpen(false)}
        student={selectedStudent}
        topicTitle={currentTopic.title}
      />

      {/* 특정 학생이 쓴 모든 주제별 글 모아보기 모달 */}
      {portfolioStudent && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <div className="w-full max-w-5xl sketch-card bg-[#FBFBF9] p-6 sm:p-8 my-6 max-h-[90dvh] overflow-y-auto space-y-5">
            <div className="flex items-center justify-between pb-4 border-b border-[#CBD5E1]">
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-xl bg-[#1B4332] text-white text-sm font-bold">
                  {portfolioStudent.number}번 {portfolioStudent.name}
                </span>
                <h3 className="text-lg sm:text-xl font-bold text-[#1B4332]">
                  주제별 쓴 글 전체 모아보기 ({topics.length}편)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPortfolioStudent(null)}
                className="px-3 py-1.5 rounded-xl bg-white border border-[#CBD5E1] text-xs font-bold text-[#475569] hover:text-[#1E293B] flex items-center gap-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
                <span>닫기</span>
              </button>
            </div>

            <div className="space-y-4">
              {topics.map((tp) => {
                const stData = getStudentTopicData(portfolioStudent, tp);
                const finalTxt = (stData?.draft3 || stData?.draft2 || stData?.draft1 || '').trim();
                return (
                  <div
                    key={tp.id}
                    className="sketch-card bg-white p-5 sm:p-6 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-[#E2E8F0] pb-2.5">
                      <div>
                        <div className="font-bold text-base text-[#1B4332] font-editorial-serif">
                          {stData?.pieceTitle || tp.title}
                        </div>
                        {stData?.pieceTitle && (
                          <div className="mt-0.5 text-[11px] text-[#64748B]">주제: {tp.title}</div>
                        )}
                      </div>
                      <span className="text-xs text-[#64748B]">
                        {tp.createdAt} · {finalTxt.length}자
                      </span>
                    </div>
                    {finalTxt ? (
                      <div className="lined-paper p-4 rounded-xl border border-[#E2E8F0] font-editorial-serif text-base text-[#1E293B] whitespace-pre-wrap leading-8">
                        <div className="mb-7">
                          <div className="text-center text-lg font-bold">
                            {stData?.pieceTitle || tp.title}
                          </div>
                          <div className="mt-2 text-right text-sm font-semibold text-[#475569]">
                            {portfolioStudent.name}
                          </div>
                        </div>
                        {finalTxt}
                      </div>
                    ) : (
                      <p className="text-xs text-[#94A3B8] py-4 text-center">
                        작성된 글이 없습니다.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 학생 입장 링크 · QR · QR 이미지 다운로드 · 15개 PDF 시트 다운로드 모달 */}
      <StudentShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        className={config.className}
        spreadsheetId={config.spreadsheetId || ''}
        gasUrl={gasUrl}
        classId={config.activeClassId || ''}
        classAccessKey={classAccessKey}
        onOpenGasSetup={onOpenGasSetup}
      />
    </div>
  );
}
