import React, { useState, useEffect, useCallback, useRef } from 'react';
import { HandDrawnNotebookLogo } from './components/HandDrawnIcons';
import StudentStudio from './components/StudentStudio';
import TeacherDashboard from './components/TeacherDashboard';
import GasSetupModal from './components/GasSetupModal';
import {
  DEFAULT_GOOGLE_CLIENT_ID,
  loginTeacherWithGoogle,
  refreshTeacherGoogleToken,
  ensureTeacherSpreadsheet,
  deployStudentRelayWebApp,
  loadFullStateFromSpreadsheet,
  saveFullStateToSpreadsheet,
  callDirectSheetStudentApi,
  ensureAndSyncStudentGoogleDoc,
  resetGoogleDocWithStudentText,
  pullBriskFeedbackFromGoogleDoc,
  deleteGoogleDriveFiles
} from './services/googleDriveService';
import { GraduationCap, Users } from 'lucide-react';
import {
  migrateLegacyDemoStorage,
  removeLegacyDemoState
} from './utils/legacyDemoMigration';
import { shouldAutoSaveTeacherState } from './utils/syncPolicy';
import { getFeedbackTopicRecord, isMatchingSubmission, normalizeFeedbackCriteria, wasBatchFeedbackDelivered } from './utils/batchFeedback';

const STORAGE_KEYS = {
  GAS_URL: 'sseudam_gas_url_v5',
  GOOGLE_CLIENT_ID: 'sseudam_google_client_id_v2',
  GOOGLE_AUTH: 'sseudam_google_auth_v1',
  TEACHER_STEP: 'sseudam_teacher_step_v4',
  CLASSES: 'sseudam_classes_v7',
  TOPICS: 'sseudam_topics_v7',
  STUDENTS: 'sseudam_students_v7',
  QUESTIONS: 'sseudam_questions_v7',
  CONFIG: 'sseudam_config_v7'
};

const STUDENT_SESSION_KEY = 'sseudam_student_session_v1';

function createClassAccessKey() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random()
    .toString(36)
    .slice(2)}`;
}

function mergeLatestByKey(localItems = [], remoteItems = [], keyOf) {
  const merged = new Map(localItems.map((item) => [keyOf(item), item]));
  let changed = false;
  remoteItems.forEach((remoteItem) => {
    const key = keyOf(remoteItem);
    const localItem = merged.get(key);
    const localTime = Date.parse(localItem?.updatedAtIso || localItem?.createdAtIso || '') || 0;
    const remoteTime = Date.parse(remoteItem?.updatedAtIso || remoteItem?.createdAtIso || '') || 0;
    if (!localItem || remoteTime > localTime) {
      merged.set(key, remoteItem);
      changed = true;
    }
  });
  return changed ? Array.from(merged.values()) : localItems;
}

function dedupeQuestions(items = []) {
  const seenIds = new Set();
  const recentByContent = new Map();
  return items.filter((question) => {
    const id = String(question?.id || '');
    if (id && seenIds.has(id)) return false;
    if (id) seenIds.add(id);

    const isResolved = question?.resolved === true || question?.resolved === 'TRUE';
    if (isResolved) return true;
    const signature = [
      question?.classId || '',
      question?.topicId || '',
      question?.number || '',
      String(question?.question || '').trim(),
      String(question?.quote || '').trim()
    ].join('::');
    const timestamp =
      Date.parse(question?.createdAtIso || question?.updatedAtIso || question?.createdAt || '') || 0;
    const previousTimestamp = recentByContent.get(signature);
    if (timestamp && previousTimestamp && Math.abs(timestamp - previousTimestamp) <= 30000) {
      return false;
    }
    if (timestamp) recentByContent.set(signature, timestamp);
    return true;
  });
}

function getDraftHistory(record = {}) {
  if (Array.isArray(record.draftHistory) && record.draftHistory.length > 0) {
    return record.draftHistory.filter((draft) => draft?.text && String(draft.text).trim());
  }

  const rawDrafts = [record.draft1, record.draft2, record.draft3, record.draft4, record.draft5]
    .filter((text) => text && String(text).trim());
  return rawDrafts.map((text, index) => ({
      round: index + 1,
      label: `${index + 1}차 글`,
      text,
      pieceTitle: record.pieceTitle || '',
      teacherNote: index === rawDrafts.length - 1 ? record.teacherNote || '' : '',
      feedbackItems: index === rawDrafts.length - 1 ? record.feedbackItems || [] : [],
      updatedAt: record.updatedAt || '',
      updatedAtIso: record.updatedAtIso || ''
  }));
}

function appendDraftRevision(record = {}, text, pieceTitle, updatedAt, updatedAtIso, options = {}) {
  const history = getDraftHistory(record);
  if (options.isRecallUpdate && history.length > 0) {
    const lastIndex = history.length - 1;
    const currentDraft = history[lastIndex];
    history[lastIndex] = {
      ...currentDraft,
      text,
      pieceTitle,
      updatedAt,
      updatedAtIso
    };
    const round = currentDraft.round || history.length;
    const nextRecord = {
      ...record,
      status: round === 1 ? 'STAGE_1_SUBMITTED' : 'REVISION_SUBMITTED',
      locked: true,
      pieceTitle,
      draftHistory: history,
      updatedAt,
      updatedAtIso
    };
    delete nextRecord.recalled;
    if (round <= 5) nextRecord[`draft${round}`] = text;
    return nextRecord;
  }

  if (history.length > 0 && (record.teacherNote || record.feedbackItems?.length)) {
    const lastIndex = history.length - 1;
    history[lastIndex] = {
      ...history[lastIndex],
      teacherNote: record.teacherNote || history[lastIndex].teacherNote || '',
      feedbackItems: record.feedbackItems || history[lastIndex].feedbackItems || []
    };
  }

  const round = history.length + 1;
  const nextRecord = {
    ...record,
    status: round === 1 ? 'STAGE_1_SUBMITTED' : 'REVISION_SUBMITTED',
    locked: true,
    pieceTitle,
    teacherNote: '',
    feedbackItems: [],
    draftHistory: [
      ...history,
      {
        round,
        label: `${round}차 글`,
        text,
        pieceTitle,
        teacherNote: '',
        feedbackItems: [],
        updatedAt,
        updatedAtIso
      }
    ],
    updatedAt,
    updatedAtIso
  };
  delete nextRecord.recalled;
  if (round <= 5) nextRecord[`draft${round}`] = text;
  return nextRecord;
}

function getLatestDraftText(record = {}) {
  const history = getDraftHistory(record);
  return history[history.length - 1]?.text || record.draft5 || record.draft4 || record.draft3 || record.draft2 || record.draft1 || '';
}

export default function App() {
  // URL 파라미터 확인 (?student=1&sheetId=... 로 접속한 학생 태블릿인지 판별)
  const urlParams =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isStudentUrlMode = urlParams?.get('student') === '1';
  const urlSheetId = urlParams?.get('sheetId') || '';
  const urlGasUrl = urlParams?.get('gasUrl') || '';
  const urlClassId = urlParams?.get('classId') || '';
  const urlAccessKey = urlParams?.get('accessKey') || '';

  const [legacyDemoStorageMigrated] = useState(() =>
    isStudentUrlMode ? false : migrateLegacyDemoStorage(localStorage, STORAGE_KEYS)
  );
  const legacyDemoReplacementPendingRef = useRef(legacyDemoStorageMigrated);

  // 기본 접속은 교사 화면('teacher'), 학생 전용 링크(?student=1)로 접속했을 때만 학생 화면('student')으로 시작!
  const [roleMode, setRoleMode] = useState(() => (isStudentUrlMode ? 'student' : 'teacher'));
  const [activeStudent, setActiveStudent] = useState(null);
  const [isTeacherPreview, setIsTeacherPreview] = useState(false);
  const [teacherPreviewTopicId, setTeacherPreviewTopicId] = useState('');
  const [teacherOpenedTopicId, setTeacherOpenedTopicId] = useState(null);
  const [teacherSelectedStudentNumber, setTeacherSelectedStudentNumber] = useState('');

  const [gasUrl, setGasUrl] = useState(
    () => urlGasUrl || localStorage.getItem(STORAGE_KEYS.GAS_URL) || ''
  );
  const [googleClientId, setGoogleClientId] = useState(
    () =>
      localStorage.getItem(STORAGE_KEYS.GOOGLE_CLIENT_ID) ||
      import.meta.env.VITE_GOOGLE_CLIENT_ID ||
      DEFAULT_GOOGLE_CLIENT_ID
  );
  const [googleAuth, setGoogleAuth] = useState(() => {
    // 학생 링크는 교사 화면과 같은 origin을 사용하므로 localStorage도 공유됩니다.
    // 학생 화면에서 교사 OAuth 토큰을 재사용하면 빈 학생 상태가 시트에 저장될 수 있습니다.
    if (isStudentUrlMode) return null;
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.GOOGLE_AUTH);
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      if (parsed.expiresAt && parsed.expiresAt > Date.now()) {
        return parsed;
      }
      localStorage.removeItem(STORAGE_KEYS.GOOGLE_AUTH);
      localStorage.removeItem(STORAGE_KEYS.TEACHER_STEP);
      return null;
    } catch {
      return null;
    }
  });

  // 교사 화면 단계: 'login'(로그인 전) -> 'classSelect'(내 학급 선택) -> 'bookshelf'(선택한 학급의 주제 책장)
  const [teacherStep, setTeacherStep] = useState(() => {
    const savedAuth = localStorage.getItem(STORAGE_KEYS.GOOGLE_AUTH);
    if (!savedAuth) return 'login';
    return localStorage.getItem(STORAGE_KEYS.TEACHER_STEP) || 'classSelect';
  });

  const [studentSession, setStudentSession] = useState(() => {
    try {
      const saved = sessionStorage.getItem(STUDENT_SESSION_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const handleChangeTeacherStep = (nextStep) => {
    setTeacherStep(nextStep);
    localStorage.setItem(STORAGE_KEYS.TEACHER_STEP, nextStep);
  };

  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const [classes, setClasses] = useState(() => {
    if (isStudentUrlMode) return [];
    const saved = localStorage.getItem(STORAGE_KEYS.CLASSES);
    return saved ? JSON.parse(saved) : [];
  });

  const [topics, setTopics] = useState(() => {
    if (isStudentUrlMode) return [];
    const saved = localStorage.getItem(STORAGE_KEYS.TOPICS);
    return saved ? JSON.parse(saved) : [];
  });

  const [config, setConfig] = useState(() => {
    if (isStudentUrlMode) {
      return {
        className: '',
        activeClassId: urlClassId,
        activeTopicId: '',
        assignmentTitle: '',
        assignmentPrompt: '',
        classLocked: false,
        spreadsheetId: urlSheetId
      };
    }
    const saved = localStorage.getItem(STORAGE_KEYS.CONFIG);
    return saved
      ? JSON.parse(saved)
      : {
          className: '',
          activeClassId: '',
          activeTopicId: '',
          assignmentTitle: '',
          assignmentPrompt: '',
          classLocked: false
        };
  });

  const [selectedTopicId, setSelectedTopicId] = useState(
    () => config.activeTopicId || ''
  );

  const [students, setStudents] = useState(() => {
    if (isStudentUrlMode) return [];
    const saved = localStorage.getItem(STORAGE_KEYS.STUDENTS);
    return saved ? JSON.parse(saved) : [];
  });

  const [questions, setQuestions] = useState(() => {
    if (isStudentUrlMode) return [];
    const saved = localStorage.getItem(STORAGE_KEYS.QUESTIONS);
    return saved ? dedupeQuestions(JSON.parse(saved)) : [];
  });

  const legacyClassId = classes[0]?.id || config.activeClassId || '';
  const activeClassId = isStudentUrlMode
    ? urlClassId || config.activeClassId || legacyClassId
    : config.activeClassId || legacyClassId;
  const belongsToActiveClass = (item) =>
    String(item?.classId || legacyClassId) === String(activeClassId);

  const visibleStudents = students.filter(belongsToActiveClass);
  const visibleTopics = topics.filter(belongsToActiveClass);
  const visibleQuestions = questions.filter(belongsToActiveClass);
  const feedbackStateRef = useRef(null);
  feedbackStateRef.current = { classes, topics, students, questions, config, googleAuth };

  useEffect(() => {
    if (isStudentUrlMode) return;
    localStorage.setItem(STORAGE_KEYS.CLASSES, JSON.stringify(classes));
  }, [classes, isStudentUrlMode]);

  useEffect(() => {
    if (isStudentUrlMode) return;
    localStorage.setItem(STORAGE_KEYS.TOPICS, JSON.stringify(topics));
  }, [topics, isStudentUrlMode]);

  useEffect(() => {
    if (isStudentUrlMode) return;
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(config));
  }, [config, isStudentUrlMode]);

  useEffect(() => {
    if (isStudentUrlMode) return;
    localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(students));
  }, [students, isStudentUrlMode]);

  useEffect(() => {
    if (isStudentUrlMode) return;
    localStorage.setItem(STORAGE_KEYS.QUESTIONS, JSON.stringify(questions));
  }, [questions, isStudentUrlMode]);

  useEffect(() => {
    if (!studentSession) {
      sessionStorage.removeItem(STUDENT_SESSION_KEY);
      return;
    }
    sessionStorage.setItem(STUDENT_SESSION_KEY, JSON.stringify(studentSession));
  }, [studentSession]);

  // 기존 학급에도 학생 입장용 비밀 키를 한 번 생성해 저장합니다.
  useEffect(() => {
    if (isStudentUrlMode || !config.activeClassId) return;
    if (config.classAccessKeys?.[config.activeClassId]) return;
    setConfig((prev) => ({
      ...prev,
      classAccessKeys: {
        ...(prev.classAccessKeys || {}),
        [prev.activeClassId]: createClassAccessKey()
      }
    }));
  }, [isStudentUrlMode, config.activeClassId, config.classAccessKeys]);

  // 학생 QR 접속 시에는 GAS 또는 구글 시트 직결 엔진에서 학급명·주제 같은 공개 범위만 받습니다.
  useEffect(() => {
    if (!isStudentUrlMode || !urlSheetId || !urlClassId) return;
    let cancelled = false;
    const runBootstrap = async () => {
      try {
        let data = null;
        if (urlGasUrl) {
          try {
            const res = await fetch(urlGasUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: JSON.stringify({
                action: 'studentBootstrap',
                spreadsheetId: urlSheetId,
                classId: urlClassId,
                accessKey: urlAccessKey
              })
            });
            data = await res.json();
          } catch {
            data = null;
          }
        }
        if (!data?.ok) {
          data = await callDirectSheetStudentApi({
            action: 'studentBootstrap',
            spreadsheetId: urlSheetId,
            classId: urlClassId,
            accessKey: urlAccessKey
          });
        }
        if (cancelled || !data?.ok) return;
        if (Array.isArray(data.topics)) setTopics(data.topics);
        if (data.config) setConfig((prev) => ({ ...prev, ...data.config }));
      } catch (e) {
        console.warn('학생 학급 정보 조회 참고:', e);
      }
    };
    runBootstrap();
    return () => {
      cancelled = true;
    };
  }, [isStudentUrlMode, urlSheetId, urlGasUrl, urlClassId, urlAccessKey]);

  // 교사가 Google OAuth 로그인되어 있을 때 상태 변경 시 선생님의 자동 생성 구글 시트에 자동 저장 (디바운스)
  const syncTimeoutRef = useRef(null);
  useEffect(() => {
    if (
      !shouldAutoSaveTeacherState({
        isStudentUrlMode,
        accessToken: googleAuth?.accessToken,
        spreadsheetId: config?.spreadsheetId
      })
    ) {
      return;
    }
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);

    syncTimeoutRef.current = setTimeout(() => {
      const replaceRemoteRecords = legacyDemoReplacementPendingRef.current;
      saveFullStateToSpreadsheet(googleAuth.accessToken, config.spreadsheetId, {
        classes,
        topics,
        students,
        questions,
        config,
        replaceRemoteRecords
      })
        .then(() => {
          if (replaceRemoteRecords) legacyDemoReplacementPendingRef.current = false;
        })
        .catch((e) => console.warn('구글 시트 자동 저장 참고:', e));
    }, 900);

    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, [
    classes,
    topics,
    students,
    questions,
    config,
    googleAuth?.accessToken,
    isStudentUrlMode
  ]);

  // 교사 화면은 학생 제출 결과를 주기적으로 읽되, 더 최신인 로컬 첨삭은 덮어쓰지 않습니다.
  useEffect(() => {
    if (isStudentUrlMode || !googleAuth?.accessToken || !config?.spreadsheetId) return;
    let cancelled = false;
    let timer = null;
    const refreshTeacherState = async () => {
      try {
        const remote = await loadFullStateFromSpreadsheet(
          googleAuth.accessToken,
          config.spreadsheetId
        );
        if (cancelled) return;
        const remoteLegacyClassId =
          remote.config?.activeClassId || remote.classes?.[0]?.id || legacyClassId;
        const remoteStudents = (remote.students || []).map((student) => ({
          ...student,
          classId: student.classId || remoteLegacyClassId
        }));
        const remoteQuestions = (remote.questions || []).map((question) => ({
          ...question,
          classId: question.classId || remoteLegacyClassId
        }));
        setStudents((prev) =>
          mergeLatestByKey(
            prev,
            remoteStudents,
            (student) => `${student.classId || remoteLegacyClassId}::${student.number}`
          )
        );
        setQuestions((prev) =>
          dedupeQuestions(
            mergeLatestByKey(prev, remoteQuestions, (question) => String(question.id))
          )
        );
      } catch (e) {
        console.warn('학생 제출 자동 확인 참고:', e);
      }
      if (!cancelled) timer = setTimeout(refreshTeacherState, 12000);
    };
    timer = setTimeout(refreshTeacherState, 12000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isStudentUrlMode, googleAuth?.accessToken, config?.spreadsheetId, legacyClassId]);

  // 교사 화면 켜짐 및 활동 시 구글 토큰 자동 연장 (1시간 만료 방지)
  const isRefreshingAuthRef = useRef(false);
  const handleAutoRefreshToken = useCallback(
    async (forced = false) => {
      if (isStudentUrlMode || !googleAuth?.accessToken || isRefreshingAuthRef.current) return;
      const targetClientId = (googleClientId || '').trim();
      if (!targetClientId) return;

      const remainingMs = (googleAuth.expiresAt || 0) - Date.now();
      // 만료 15분 전이거나 강제 갱신 요청일 때 백그라운드 갱신
      if (!forced && remainingMs > 15 * 60 * 1000) return;

      isRefreshingAuthRef.current = true;
      try {
        const refreshed = await refreshTeacherGoogleToken(targetClientId, googleAuth);
        if (refreshed?.accessToken) {
          setGoogleAuth(refreshed);
          localStorage.setItem(STORAGE_KEYS.GOOGLE_AUTH, JSON.stringify(refreshed));

          // 학생 제출용 브릿지 토큰을 구글 시트에도 즉시 동기화
          if (config?.spreadsheetId) {
            saveFullStateToSpreadsheet(refreshed.accessToken, config.spreadsheetId, {
              classes,
              topics,
              students,
              questions,
              config,
              replaceRemoteRecords: false
            }).catch((err) => console.warn('교사 토큰 자동 갱신 시트 반영 참고:', err));
          }
        }
      } catch (err) {
        console.warn('구글 세션 백그라운드 연장 참고:', err);
      } finally {
        isRefreshingAuthRef.current = false;
      }
    },
    [isStudentUrlMode, googleAuth, googleClientId, config, classes, topics, students, questions]
  );

  useEffect(() => {
    if (isStudentUrlMode || !googleAuth?.accessToken) return;

    // 1) 3분마다 토큰 만료 잔여 시간 점검
    const intervalTimer = setInterval(() => {
      handleAutoRefreshToken(false);
    }, 3 * 60 * 1000);

    // 2) 교사가 탭을 다시 보거나(창 전환) 화면 클릭 시 점검
    const handleActivity = () => {
      handleAutoRefreshToken(false);
    };

    window.addEventListener('focus', handleActivity);
    window.addEventListener('visibilitychange', handleActivity);
    window.addEventListener('click', handleActivity);

    return () => {
      clearInterval(intervalTimer);
      window.removeEventListener('focus', handleActivity);
      window.removeEventListener('visibilitychange', handleActivity);
      window.removeEventListener('click', handleActivity);
    };
  }, [isStudentUrlMode, googleAuth?.accessToken, handleAutoRefreshToken]);

  // 교사 Google OAuth 원클릭 로그인 + 내 구글 드라이브에 구글 시트 & 폴더 자동 생성!
  const handleTeacherGoogleLogin = async (customClientId) => {
    const targetClientId = (customClientId ?? googleClientId ?? '').trim();
    if (customClientId !== undefined) {
      setGoogleClientId(targetClientId);
      localStorage.setItem(STORAGE_KEYS.GOOGLE_CLIENT_ID, targetClientId);
    }

    if (!targetClientId) {
      // 아직 Google Cloud Client ID를 넣지 않은 경우에도 즉시 체험 모드로 학급 선택 화면 진입 가능
      return { ok: true, mode: 'demo' };
    }

    setIsSyncing(true);
    try {
      const auth = await loginTeacherWithGoogle(targetClientId);
      setGoogleAuth(auth);
      localStorage.setItem(STORAGE_KEYS.GOOGLE_AUTH, JSON.stringify(auth));

      // 로그인한 교사의 구글 드라이브에서 [쓰담] 데이터베이스 시트를 찾거나 없으면 즉시 자동 생성!
      const sheetInfo = await ensureTeacherSpreadsheet(auth.accessToken, {
        classes,
        topics,
        students,
        questions,
        config
      });

      let remoteGasUrl = '';
      if (!sheetInfo.isNew) {
        const rawLoaded = await loadFullStateFromSpreadsheet(
          auth.accessToken,
          sheetInfo.spreadsheetId
        );
        const migration = removeLegacyDemoState(rawLoaded);
        const loaded = migration.state;
        const loadedClasses = Array.isArray(loaded.classes) ? loaded.classes : [];
        const loadedLegacyClassId =
          loaded.config?.activeClassId || loadedClasses[0]?.id || '';
        const loadedTopics = (Array.isArray(loaded.topics) ? loaded.topics : []).map(
          (topic) => ({
            ...topic,
            classId: topic.classId || loadedLegacyClassId
          })
        );
        const loadedStudents = (Array.isArray(loaded.students) ? loaded.students : []).map(
          (student) => ({
            ...student,
            classId: student.classId || loadedLegacyClassId
          })
        );
        const loadedQuestions = (Array.isArray(loaded.questions) ? loaded.questions : []).map(
          (question) => ({
            ...question,
            classId: question.classId || loadedLegacyClassId,
            topicId: question.topicId || loaded.config?.activeTopicId || ''
          })
        );
        const loadedConfig = {
          ...(loaded.config || {}),
          spreadsheetId: sheetInfo.spreadsheetId,
          spreadsheetUrl: sheetInfo.spreadsheetUrl,
          driveFolderId: sheetInfo.folderId,
          teacherEmail: auth.user?.email || ''
        };

        setClasses(loadedClasses);
        setTopics(loadedTopics);
        setStudents(loadedStudents);
        const dedupedLoadedQuestions = dedupeQuestions(loadedQuestions);
        setQuestions(dedupedLoadedQuestions);
        remoteGasUrl = loaded.config?.gasUrl || '';
        if (remoteGasUrl) {
          setGasUrl(remoteGasUrl);
          localStorage.setItem(STORAGE_KEYS.GAS_URL, remoteGasUrl);
        }
        setConfig((prev) => ({ ...prev, ...loadedConfig }));

        await saveFullStateToSpreadsheet(auth.accessToken, sheetInfo.spreadsheetId, {
          classes: loadedClasses,
          topics: loadedTopics,
          students: loadedStudents,
          questions: dedupedLoadedQuestions,
          config: loadedConfig,
          replaceRemoteRecords: migration.migrated
        });
      } else {
        setConfig((prev) => ({
          ...prev,
          spreadsheetId: sheetInfo.spreadsheetId,
          spreadsheetUrl: sheetInfo.spreadsheetUrl,
          driveFolderId: sheetInfo.folderId,
          teacherEmail: auth.user?.email || ''
        }));
      }

      return {
        ok: true,
        mode: 'google',
        isNewSheet: sheetInfo.isNew,
        spreadsheetUrl: sheetInfo.spreadsheetUrl,
        user: auth.user
      };
    } finally {
      setIsSyncing(false);
    }
  };

  // 학생 제출 중계기 연결 보장 (수동 모달에서 요청 시에만 실행)
  const ensureStudentRelay = async (accessToken, spreadsheetId, remoteGasUrl = '') => {
    const existingUrl =
      gasUrl ||
      localStorage.getItem(STORAGE_KEYS.GAS_URL) ||
      remoteGasUrl ||
      config.gasUrl ||
      '';
    if (existingUrl) {
      if (existingUrl !== gasUrl) setGasUrl(existingUrl);
      localStorage.setItem(STORAGE_KEYS.GAS_URL, existingUrl);
      return { status: 'existing', gasUrl: existingUrl };
    }
    try {
      const { scriptId, gasUrl: createdUrl } = await deployStudentRelayWebApp(
        accessToken,
        spreadsheetId
      );
      setGasUrl(createdUrl);
      localStorage.setItem(STORAGE_KEYS.GAS_URL, createdUrl);
      setConfig((prev) => ({ ...prev, gasUrl: createdUrl, gasScriptId: scriptId }));
      return { status: 'created', gasUrl: createdUrl };
    } catch (err) {
      console.warn('학생 제출 중계기 자동 생성 실패:', err);
      return {
        status: String(err.message).startsWith('RELAY_') ? err.message : 'failed',
        detail: err.detail || String(err.message || '')
      };
    }
  };

  // GAS 설정 모달의 [자동으로 연결하기] 버튼
  const handleAutoSetupRelay = async () => {
    if (!googleAuth?.accessToken || !config.spreadsheetId) {
      return { status: 'failed' };
    }
    setIsSyncing(true);
    try {
      return await ensureStudentRelay(googleAuth.accessToken, config.spreadsheetId);
    } finally {
      setIsSyncing(false);
    }
  };

  const callGasApi = useCallback(
    async (payload) => {
      const targetSheetId = urlSheetId || config.spreadsheetId || '';
      const fullPayload = {
        ...payload,
        spreadsheetId: targetSheetId
      };
      setIsSyncing(true);
      try {
        if (gasUrl) {
          try {
            const res = await fetch(gasUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: JSON.stringify(fullPayload)
            });
            const data = await res.json();
            if (data) return data;
          } catch (e) {
            console.warn('GAS 통신 참고 (구글 시트 직결 엔진으로 전환합니다):', e);
          }
        }
        if (targetSheetId) {
          return await callDirectSheetStudentApi(fullPayload);
        }
        return null;
      } catch (e) {
        console.warn('학생 제출 통신 참고:', e);
        return null;
      } finally {
        setIsSyncing(false);
      }
    },
    [gasUrl, urlSheetId, config.spreadsheetId]
  );

  const handleSaveGasUrl = (newUrl) => {
    setGasUrl(newUrl);
    localStorage.setItem(STORAGE_KEYS.GAS_URL, newUrl);
    setIsSetupModalOpen(false);
  };

  const handleStudentLogin = async ({ number, name }) => {
    if (!isStudentUrlMode) {
      const found = students.find(
        (student) =>
          String(student.number).trim() === String(number).trim() &&
          String(student.name).trim() === String(name).trim()
      );
      if (!found) return { ok: false, error: '번호와 이름을 다시 확인해 주세요.' };
      setActiveStudent(found);
      return { ok: true, student: found };
    }

    if (!urlSheetId || !urlClassId) {
      return {
        ok: false,
        error: '학생 입장 링크 정보를 다시 확인해 주세요.'
      };
    }

    const data = await callGasApi({
      action: 'studentLogin',
      classId: urlClassId,
      accessKey: urlAccessKey,
      number,
      name
    });
    if (!data?.ok || !data.student || !data.sessionToken) {
      return { ok: false, error: data?.error || '번호와 이름을 다시 확인해 주세요.' };
    }

    const nextSession = {
      token: data.sessionToken,
      classId: urlClassId,
      number: String(data.student.number),
      name: data.student.name
    };
    setStudentSession(nextSession);
    setStudents([data.student]);
    setQuestions(dedupeQuestions(Array.isArray(data.questions) ? data.questions : []));
    if (Array.isArray(data.topics)) setTopics(data.topics);
    if (data.config) setConfig((prev) => ({ ...prev, ...data.config }));
    setActiveStudent(data.student);
    return { ok: true, student: data.student };
  };

  const handleStudentLogout = () => {
    setActiveStudent(null);
    setStudentSession(null);
    setStudents([]);
    setQuestions([]);
  };

  // 로그인한 학생 화면만 자신의 최신 글·첨삭·질문을 순차적으로 갱신합니다.
  useEffect(() => {
    if (!isStudentUrlMode || !studentSession?.token || !urlSheetId) return;
    let cancelled = false;
    let timer = null;
    const refresh = async () => {
      const data = await callGasApi({
        action: 'studentRefresh',
        sessionToken: studentSession.token
      });
      if (!cancelled && data?.ok && data.student) {
        setStudents([data.student]);
        setActiveStudent(data.student);
        setQuestions(dedupeQuestions(Array.isArray(data.questions) ? data.questions : []));
        if (Array.isArray(data.topics)) setTopics(data.topics);
        if (data.config) setConfig((prev) => ({ ...prev, ...data.config }));
      } else if (!cancelled && data && !data.ok) {
        setStudentSession(null);
        setActiveStudent(null);
        setStudents([]);
        setQuestions([]);
      }
      // 직결 모드(gasUrl 미등록)일 때는 시트 API 분당 60회 쿼터를 아끼기 위해 50초, 중계기(GAS)일 때는 25초 간격으로 조회
      const pollInterval = gasUrl ? 25000 : 50000;
      if (!cancelled) timer = setTimeout(refresh, pollInterval);
    };
    refresh();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isStudentUrlMode, studentSession?.token, gasUrl, urlSheetId, callGasApi]);

  // 학생 제출 (문단 구조 100% 보존하여 저장, 회수 시 현재 차수 업데이트 및 완료 후 추가 작성 지원)
  const handleSubmitStage = async (studentNumber, stage, text, topicId, pieceTitle, options = {}) => {
    const cleanPieceTitle = String(pieceTitle || '').trim();
    if (!cleanPieceTitle) {
      return { ok: false, error: '작품 제목을 먼저 지어 주세요.' };
    }
    if (cleanPieceTitle.length > 50) {
      return { ok: false, error: '작품 제목은 50자 이내로 작성해 주세요.' };
    }
    const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const nowIso = new Date().toISOString();
    const isActive = !topicId || topicId === (config.activeTopicId || 'TOPIC_1');

    const updateLocalStudent = () => setStudents((prev) =>
      prev.map((st) => {
        if (!belongsToActiveClass(st) || String(st.number) !== String(studentNumber)) return st;

        if (isActive) {
          return appendDraftRevision(st, text, cleanPieceTitle, `오늘 ${now}`, nowIso, options);
        }

        const prevTopicData = st.historyByTopic?.[topicId] || {};
        return {
          ...st,
          historyByTopic: {
            ...(st.historyByTopic || {}),
            [topicId]: appendDraftRevision(
              prevTopicData,
              text,
              cleanPieceTitle,
              `오늘 ${now}`,
              nowIso,
              options
            )
          },
          updatedAtIso: nowIso
        };
      })
    );

    if (isStudentUrlMode) {
      let data = await callGasApi({
        action: 'submitStage',
        sessionToken: studentSession?.token || '',
        topicId,
        stage,
        text,
        pieceTitle: cleanPieceTitle,
        isRecallUpdate: Boolean(options.isRecallUpdate),
        allowRevision: Boolean(options.allowRevision)
      });

      // 동시 제출 요청 몰림(429 또는 락 대기) 시 2초 대기 후 1회 자동 재시도
      if (
        !data?.ok &&
        data?.error &&
        (data.error.includes('동시에') ||
          data.error.includes('많습니다') ||
          data.error.includes('429') ||
          data.error.includes('한도'))
      ) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        data = await callGasApi({
          action: 'submitStage',
          sessionToken: studentSession?.token || '',
          topicId,
          stage,
          text,
          pieceTitle: cleanPieceTitle,
          isRecallUpdate: Boolean(options.isRecallUpdate),
          allowRevision: Boolean(options.allowRevision)
        });
      }

      if (!data?.ok || !data.student) {
        return { ok: false, error: data?.error || '제출에 실패했습니다. 다시 시도해 주세요.' };
      }
      setStudents([data.student]);
      setActiveStudent(data.student);
      return { ok: true };
    }

    updateLocalStudent();
    return { ok: true };
  };

  // 학생 제출 회수 (선생님 확인 전 오타나 고칠 점이 생각났을 때 스스로 회수하여 수정)
  const handleUnsubmitStage = async (studentNumber, topicId) => {
    const isActive = !topicId || topicId === (config.activeTopicId || 'TOPIC_1');

    if (isStudentUrlMode) {
      const data = await callGasApi({
        action: 'unsubmitStage',
        sessionToken: studentSession?.token || '',
        topicId
      });
      if (!data?.ok || !data.student) {
        return { ok: false, error: data?.error || '제출을 회수하지 못했습니다.' };
      }
      setStudents([data.student]);
      setActiveStudent(data.student);
      return { ok: true };
    }

    setStudents((prev) =>
      prev.map((st) => {
        if (!belongsToActiveClass(st) || String(st.number) !== String(studentNumber)) return st;

        if (isActive) {
          const nextStatus = st.status === 'STAGE_1_SUBMITTED' ? 'STAGE_1_WRITING' : 'FEEDBACK_DONE';
          return {
            ...st,
            locked: false,
            recalled: true,
            status: nextStatus,
            updatedAtIso: new Date().toISOString()
          };
        }

        const prevTopicData = st.historyByTopic?.[topicId] || {};
        const nextStatus = prevTopicData.status === 'STAGE_1_SUBMITTED' ? 'STAGE_1_WRITING' : 'FEEDBACK_DONE';
        return {
          ...st,
          historyByTopic: {
            ...(st.historyByTopic || {}),
            [topicId]: {
              ...prevTopicData,
              locked: false,
              recalled: true,
              status: nextStatus,
              updatedAtIso: new Date().toISOString()
            }
          },
          updatedAtIso: new Date().toISOString()
        };
      })
    );
    return { ok: true };
  };

  const handleAddQuestion = async (qPayload) => {
    const requestId =
      qPayload.requestId ||
      `Q_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const newQ = {
      id: requestId,
      classId: activeClassId,
      topicId: qPayload.topicId || config.activeTopicId || '',
      number: qPayload.number,
      name: qPayload.name,
      source: qPayload.source || '학생 질문',
      quote: qPayload.quote || '',
      question: qPayload.question,
      reply: '',
      resolved: false,
      createdAt: '방금 전',
      createdAtIso: new Date().toISOString(),
      updatedAtIso: new Date().toISOString()
    };
    if (isStudentUrlMode) {
      const data = await callGasApi({
        action: 'addQuestion',
        sessionToken: studentSession?.token || '',
        topicId: qPayload.topicId || config.activeTopicId || '',
        question: qPayload.question,
        quote: qPayload.quote || '',
        requestId
      });
      if (!data?.ok) {
        return { ok: false, error: data?.error || '질문 전송에 실패했습니다.' };
      }
      if (Array.isArray(data.questions)) setQuestions(dedupeQuestions(data.questions));
      return { ok: true };
    }

    setQuestions((prev) => [newQ, ...prev]);
    return { ok: true };
  };

  const handleUpdateStudentStatus = async ({
    number,
    topicId,
    status,
    locked,
    teacherNote,
    feedbackItems
  }) => {
    const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const nowIso = new Date().toISOString();
    const targetSt = students.find(
      (s) => belongsToActiveClass(s) && String(s.number) === String(number)
    );
    const targetTopicId = topicId || config.activeTopicId || '';
    const isActiveTopic = targetTopicId === (config.activeTopicId || 'TOPIC_1');
    const targetTopicData = isActiveTopic
      ? targetSt
      : { ...targetSt, ...(targetSt?.historyByTopic?.[targetTopicId] || {}) };

    setStudents((prev) =>
      prev.map((st) => {
        if (!belongsToActiveClass(st) || String(st.number) !== String(number)) return st;
        if (!isActiveTopic) {
          const previousTopicData = st.historyByTopic?.[targetTopicId] || {};
          return {
            ...st,
            historyByTopic: {
              ...(st.historyByTopic || {}),
              [targetTopicId]: {
                ...previousTopicData,
                status: status || previousTopicData.status,
                locked: locked !== undefined ? locked : previousTopicData.locked,
                teacherNote:
                  teacherNote !== undefined ? teacherNote : previousTopicData.teacherNote,
                feedbackItems:
                  feedbackItems !== undefined ? feedbackItems : previousTopicData.feedbackItems,
                updatedAtIso: nowIso
              }
            },
            updatedAtIso: nowIso
          };
        }
        return {
          ...st,
          status: status || st.status,
          locked: locked !== undefined ? locked : st.locked,
          teacherNote: teacherNote !== undefined ? teacherNote : st.teacherNote,
          feedbackItems: feedbackItems !== undefined ? feedbackItems : st.feedbackItems,
          updatedAt: `오늘 ${now}`,
          updatedAtIso: nowIso
        };
      })
    );

    // 교사가 [첨삭 완료 및 학생에게 전송] 시, 학생 구글 독스의 이전 Brisk 표/댓글을 자동으로 깨끗하게 청소!
    const targetDocId = targetTopicData?.docId || targetSt?.docId;
    if (status === 'FEEDBACK_DONE' && googleAuth?.accessToken && targetDocId) {
      const latestText = getLatestDraftText(targetTopicData);
      const targetTopicTitle = topics.find((topic) => topic.id === targetTopicId)?.title || '';
      resetGoogleDocWithStudentText(googleAuth.accessToken, targetDocId, latestText, {
        pieceTitle: targetTopicData?.pieceTitle || targetTopicTitle,
        authorName: targetSt.name || ''
      });
    }

  };

  const handleBatchDeadline = async ({ lockAll, topicId }) => {
    const nowIso = new Date().toISOString();
    const targetTopicId = topicId || selectedTopicId || config.activeTopicId;
    const isActiveTopic = targetTopicId === config.activeTopicId;
    if (isActiveTopic) {
      setConfig((prev) => ({ ...prev, classLocked: lockAll }));
    }
    setTopics((prev) =>
      prev.map((topic) =>
        topic.id === targetTopicId
          ? { ...topic, classLocked: lockAll }
          : topic
      )
    );
    setStudents((prev) =>
      prev.map((st) =>
        !belongsToActiveClass(st)
          ? st
          : isActiveTopic
          ? { ...st, locked: lockAll, updatedAtIso: nowIso }
          : {
              ...st,
              historyByTopic: {
                ...(st.historyByTopic || {}),
                [targetTopicId]: {
                  ...(st.historyByTopic?.[targetTopicId] || {}),
                  locked: lockAll,
                  updatedAtIso: nowIso
                }
              },
              updatedAtIso: nowIso
            }
      )
    );
  };

  // 교사: 새 학급 생성 (전담 교사 다학급 지원)
  const handleCreateClass = async ({ className, addList = [] }) => {
    const newClassId = 'CLASS_' + Date.now();
    const todayStr = new Date().toLocaleDateString('ko-KR');
    const cleanName = (className || '').trim() || '새 학급';

    setClasses((prev) => [
      ...prev,
      { id: newClassId, className: cleanName, createdAt: todayStr }
    ]);
    setConfig((prev) => ({
      ...prev,
      className: cleanName,
      activeClassId: newClassId,
      activeTopicId: '',
      assignmentTitle: '',
      assignmentPrompt: '',
      classLocked: false,
      classAccessKeys: {
        ...(prev.classAccessKeys || {}),
        [newClassId]: createClassAccessKey()
      }
    }));
    setSelectedTopicId('');
    await handleManageStudents({ className: cleanName, addList, classId: newClassId });
    return newClassId;
  };

  const handleSelectClass = (cls) => {
    if (!cls) return;
    setTeacherOpenedTopicId(null);
    setTeacherSelectedStudentNumber('');
    const classTopics = topics.filter(
      (topic) => String(topic.classId || legacyClassId) === String(cls.id)
    );
    const activeTopic = classTopics.find((topic) => topic.isActive) || classTopics[0] || null;
    setConfig((prev) => ({
      ...prev,
      className: cls.className,
      activeClassId: cls.id,
      activeTopicId: activeTopic?.id || '',
      assignmentTitle: activeTopic?.title || '',
      assignmentPrompt: activeTopic?.prompt || '',
      classLocked: Boolean(activeTopic?.classLocked),
      classAccessKeys: {
        ...(prev.classAccessKeys || {}),
        [cls.id]: prev.classAccessKeys?.[cls.id] || createClassAccessKey()
      }
    }));
    setSelectedTopicId(activeTopic?.id || '');
  };

  // 교사: 학급 생성 (학급명 + 학생 명단 초기 등록) 및 추후 학생 추가/관리
  const handleManageStudents = async ({
    className,
    addList = [],
    removeNumber = null,
    classId = activeClassId
  }) => {
    if (className && className.trim()) {
      setConfig((prev) => ({ ...prev, className: className.trim() }));
    }

    setStudents((prev) => {
      let next = [...prev];
      if (removeNumber !== null) {
        next = next.filter(
          (s) =>
            !(
              String(s.classId || legacyClassId) === String(classId) &&
              String(s.number) === String(removeNumber)
            )
        );
      }
      addList.forEach((item) => {
        const idx = next.findIndex(
          (s) =>
            String(s.classId || legacyClassId) === String(classId) &&
            String(s.number) === String(item.number)
        );
        if (idx >= 0) {
          next[idx] = { ...next[idx], name: item.name, classId };
        } else {
          next.push({
            classId,
            number: String(item.number),
            name: item.name,
            docId: 'DEMO_DOC_' + item.number,
            docUrl: 'https://docs.google.com/document/u/0/',
            status: 'STAGE_1_WRITING',
            locked: false,
            pieceTitle: '',
            draft1: '',
            draft2: '',
            draft3: '',
            draft4: '',
            teacherNote: '',
            feedbackItems: [],
            historyByTopic: {},
            updatedAt: '방금 등록됨',
            updatedAtIso: new Date().toISOString()
          });
        }
      });
      return next.sort((a, b) => {
        const classCompare = String(a.classId || legacyClassId).localeCompare(
          String(b.classId || legacyClassId)
        );
        return classCompare || Number(a.number) - Number(b.number);
      });
    });
  };

  // 교사: 새 글쓰기 주제 생성 (학급에 등록된 학생들을 자동으로 연결!)
  const handleCreateNewTopic = async ({ title, prompt }) => {
    const newTopicId = 'TOPIC_' + Date.now();
    const todayStr = new Date().toLocaleDateString('ko-KR');
    const prevActiveId = config.activeTopicId || 'TOPIC_1';

    setStudents((prev) =>
      prev.map((st) =>
        belongsToActiveClass(st)
          ? {
              ...st,
              classId: activeClassId,
              historyByTopic: {
                ...(st.historyByTopic || {}),
                ...(prevActiveId
                  ? {
                      [prevActiveId]: {
                        status: st.status,
                        pieceTitle: st.pieceTitle || '',
                        draft1: st.draft1,
                        draft2: st.draft2,
                        draft3: st.draft3,
                        draft4: st.draft4,
                        teacherNote: st.teacherNote,
                        feedbackItems: st.feedbackItems,
                        docId: st.docId,
                        docUrl: st.docUrl
                      }
                    }
                  : {})
              },
              status: 'STAGE_1_WRITING',
              locked: false,
              pieceTitle: '',
              draft1: '',
              draft2: '',
              draft3: '',
              draft4: '',
              teacherNote: '',
              feedbackItems: [],
              docId: 'DEMO_DOC_' + st.number,
              docUrl: 'https://docs.google.com/document/u/0/',
              updatedAtIso: new Date().toISOString()
            }
          : st
      )
    );

    setTopics((prev) => [
      {
        id: newTopicId,
        classId: activeClassId,
        title,
        prompt,
        createdAt: todayStr,
        classLocked: false,
        isActive: true
      },
      ...prev.map((t) =>
        String(t.classId || legacyClassId) === String(activeClassId)
          ? { ...t, classId: activeClassId, isActive: false }
          : t
      )
    ]);

    setConfig((prev) => ({
      ...prev,
      activeTopicId: newTopicId,
      assignmentTitle: title,
      assignmentPrompt: prompt,
      classLocked: false
    }));

    setSelectedTopicId(newTopicId);
  };

  // 교사: 기존 글쓰기 주제의 제목과 학생 안내문 수정
  const handleUpdateTopic = async ({ topicId, title, prompt }) => {
    const cleanTitle = String(title || '').trim();
    const cleanPrompt = String(prompt || '').trim();
    if (!topicId || !cleanTitle) return { ok: false };

    setTopics((prev) =>
      prev.map((topic) =>
        String(topic.id) === String(topicId)
          ? { ...topic, title: cleanTitle, prompt: cleanPrompt }
          : topic
      )
    );

    if (String(config.activeTopicId) === String(topicId)) {
      setConfig((prev) => ({
        ...prev,
        assignmentTitle: cleanTitle,
        assignmentPrompt: cleanPrompt
      }));
    }

    return { ok: true };
  };

  const handleSaveFeedbackCriteria = async (topicId, criteria) => {
    const current = feedbackStateRef.current;
    const nextTopics = current.topics.map((topic) => String(topic.id) === String(topicId)
      ? { ...topic, feedbackCriteria: normalizeFeedbackCriteria(criteria) } : topic);
    try {
      if (current.googleAuth?.accessToken && current.config.spreadsheetId) {
        await saveFullStateToSpreadsheet(current.googleAuth.accessToken, current.config.spreadsheetId, {
          ...current, topics: nextTopics
        });
      }
      setTopics((previous) => previous.map((topic) => String(topic.id) === String(topicId)
        ? { ...topic, feedbackCriteria: normalizeFeedbackCriteria(criteria) } : topic));
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  };

  const handleSendBatchFeedback = async ({ topicId, classId, entry }) => {
    const current = feedbackStateRef.current;
    if (!current.googleAuth?.accessToken || !current.config.spreadsheetId) {
      return { ok: false, error: '구글 로그인 상태를 확인한 뒤 다시 전송해 주세요.' };
    }
    const source = current.students.find((student) =>
      String(student.classId || legacyClassId) === String(classId) && String(student.number) === String(entry.number));
    const record = getFeedbackTopicRecord(source && { ...source, classId: source.classId || legacyClassId }, { id: topicId }, current.config.activeTopicId);
    if (!isMatchingSubmission(record, entry) && !wasBatchFeedbackDelivered(record, entry)) {
      return { ok: false, error: '학생의 제출 상태가 바뀌었습니다. 최신 제출본으로 준비해 주세요.' };
    }
    try {
      const result = await saveFullStateToSpreadsheet(current.googleAuth.accessToken, current.config.spreadsheetId, {
        ...current, reviewedFeedback: { topicId, classId, entry }
      });
      if (!result?.feedbackStudent) throw new Error('피드백 저장을 확인하지 못했습니다.');
      setStudents((previous) => mergeLatestByKey(previous, [result.feedbackStudent],
        (student) => `${student.classId || legacyClassId}::${student.number}`));
      return { ok: true };
    } catch (error) {
      if (error.student) setStudents((previous) => mergeLatestByKey(previous, [error.student],
        (student) => `${student.classId || legacyClassId}::${student.number}`));
      return { ok: false, error: error.message };
    }
  };

  // 교사: 학급 삭제 (목록만 삭제 vs 관련 시트 데이터 및 구글 독스 파일까지 모두 삭제)
  const handleDeleteClass = async (classId, { deleteDriveFiles = false } = {}) => {
    if (!classId) return { deletedCount: 0 };

    const targetStudents = students.filter(
      (st) => String(st.classId || legacyClassId) === String(classId)
    );

    let deletedCount = 0;
    if (deleteDriveFiles && googleAuth?.accessToken) {
      const docIds = [];
      targetStudents.forEach((st) => {
        if (st.docId) docIds.push(st.docId);
        Object.values(st.historyByTopic || {}).forEach((hist) => {
          if (hist?.docId) docIds.push(hist.docId);
        });
      });
      const res = await deleteGoogleDriveFiles(googleAuth.accessToken, docIds);
      deletedCount = res?.deletedCount || 0;
    }

    // 구글 시트 저장 시 원격 기록과 병합하지 않고 삭제된 상태로 덮어쓰도록 설정
    legacyDemoReplacementPendingRef.current = true;

    const remainingClasses = classes.filter((c) => String(c.id) !== String(classId));
    const nextClass = remainingClasses[0] || null;
    const remainingTopics = topics.filter(
      (t) => String(t.classId || legacyClassId) !== String(classId)
    );
    const nextClassTopics = nextClass
      ? remainingTopics.filter(
          (t) => String(t.classId || legacyClassId) === String(nextClass.id)
        )
      : [];
    const nextActiveTopic =
      nextClassTopics.find((t) => t.isActive) || nextClassTopics[0] || null;

    setClasses(remainingClasses);
    setTopics(remainingTopics);
    setStudents((prev) =>
      prev.filter((st) => String(st.classId || legacyClassId) !== String(classId))
    );
    setQuestions((prev) =>
      prev.filter((q) => String(q.classId || legacyClassId) !== String(classId))
    );

    setConfig((prev) => {
      const nextAccessKeys = { ...(prev.classAccessKeys || {}) };
      delete nextAccessKeys[classId];
      return {
        ...prev,
        className: nextClass?.className || '',
        activeClassId: nextClass?.id || '',
        activeTopicId: nextActiveTopic?.id || '',
        assignmentTitle: nextActiveTopic?.title || '',
        assignmentPrompt: nextActiveTopic?.prompt || '',
        classLocked: Boolean(nextActiveTopic?.classLocked),
        classAccessKeys: nextAccessKeys
      };
    });

    setSelectedTopicId(nextActiveTopic?.id || '');
    return { deletedCount };
  };

  // 교사: 글쓰기 주제 삭제 (목록만 삭제 vs 관련 시트 데이터 및 구글 독스 파일까지 모두 삭제)
  const handleDeleteTopic = async (topicId, { deleteDriveFiles = false } = {}) => {
    if (!topicId) return { deletedCount: 0 };

    const targetTopic = topics.find((t) => String(t.id) === String(topicId));
    const topicClassId = targetTopic?.classId || activeClassId;
    const wasActive = String(config.activeTopicId) === String(topicId);

    let deletedCount = 0;
    if (deleteDriveFiles && googleAuth?.accessToken) {
      const docIds = [];
      students.forEach((st) => {
        if (String(st.classId || legacyClassId) !== String(topicClassId)) return;
        if (wasActive && st.docId) docIds.push(st.docId);
        const histDocId = st.historyByTopic?.[topicId]?.docId;
        if (histDocId) docIds.push(histDocId);
      });
      const res = await deleteGoogleDriveFiles(googleAuth.accessToken, docIds);
      deletedCount = res?.deletedCount || 0;
    }

    // 구글 시트 저장 시 원격 기록과 병합하지 않고 삭제된 상태로 덮어쓰도록 설정
    legacyDemoReplacementPendingRef.current = true;

    const remainingTopics = topics.filter((t) => String(t.id) !== String(topicId));
    const classRemainingTopics = remainingTopics.filter(
      (t) => String(t.classId || legacyClassId) === String(topicClassId)
    );
    const nextActiveTopic = wasActive
      ? classRemainingTopics[0] || null
      : classRemainingTopics.find((t) => t.isActive) || classRemainingTopics[0] || null;

    setTopics(
      remainingTopics.map((t) => {
        if (String(t.classId || legacyClassId) !== String(topicClassId)) return t;
        return {
          ...t,
          isActive: Boolean(nextActiveTopic && String(t.id) === String(nextActiveTopic.id))
        };
      })
    );

    setQuestions((prev) => prev.filter((q) => String(q.topicId) !== String(topicId)));

    setStudents((prev) =>
      prev.map((st) => {
        if (String(st.classId || legacyClassId) !== String(topicClassId)) return st;
        const nextHistory = { ...(st.historyByTopic || {}) };
        delete nextHistory[topicId];

        if (!wasActive) {
          return {
            ...st,
            historyByTopic: nextHistory,
            updatedAtIso: new Date().toISOString()
          };
        }

        if (nextActiveTopic) {
          const restored = nextHistory[nextActiveTopic.id] || {};
          delete nextHistory[nextActiveTopic.id];
          return {
            ...st,
            historyByTopic: nextHistory,
            status: restored.status || 'STAGE_1_WRITING',
            locked: Boolean(nextActiveTopic.classLocked),
            pieceTitle: restored.pieceTitle || '',
            draft1: restored.draft1 || '',
            draft2: restored.draft2 || '',
            draft3: restored.draft3 || '',
            draft4: restored.draft4 || '',
            teacherNote: restored.teacherNote || '',
            feedbackItems: restored.feedbackItems || [],
            docId: restored.docId || 'DEMO_DOC_' + st.number,
            docUrl: restored.docUrl || 'https://docs.google.com/document/u/0/',
            updatedAtIso: new Date().toISOString()
          };
        }

        return {
          ...st,
          historyByTopic: nextHistory,
          status: 'STAGE_1_WRITING',
          locked: false,
          pieceTitle: '',
          draft1: '',
          draft2: '',
          draft3: '',
          draft4: '',
          teacherNote: '',
          feedbackItems: [],
          docId: 'DEMO_DOC_' + st.number,
          docUrl: 'https://docs.google.com/document/u/0/',
          updatedAtIso: new Date().toISOString()
        };
      })
    );

    if (wasActive) {
      setConfig((prev) => ({
        ...prev,
        activeTopicId: nextActiveTopic?.id || '',
        assignmentTitle: nextActiveTopic?.title || '',
        assignmentPrompt: nextActiveTopic?.prompt || '',
        classLocked: Boolean(nextActiveTopic?.classLocked)
      }));
      setSelectedTopicId(nextActiveTopic?.id || '');
    }

    return { deletedCount };
  };

  const handleReplyQuestion = async (id, reply) => {
    setQuestions((prev) =>
      prev.map((q) =>
        String(q.id) === String(id)
          ? { ...q, reply, resolved: true, updatedAtIso: new Date().toISOString() }
          : q
      )
    );

  };

  // 교사가 [1. 학생 독스 열기] 클릭 시: 아직 실제 구글 독스가 없으면 내 구글 드라이브에 자동 생성 후 최신 본문 동기화!
  const handleEnsureStudentDoc = useCallback(
    async (student, topic, explicitText, explicitTitle) => {
      if (!googleAuth?.accessToken || !student) return null;
      try {
        const res = await ensureAndSyncStudentGoogleDoc(googleAuth.accessToken, {
          student,
          className: config.className,
          topicTitle: explicitTitle || topic?.title || config.assignmentTitle,
          folderId: config.driveFolderId,
          studentText: explicitText,
          pieceTitle: explicitTitle
        });
        if (res && res.docId) {
          const targetTopicId = topic?.id || config.activeTopicId || '';
          const isActiveTopic = targetTopicId === (config.activeTopicId || 'TOPIC_1');
          setStudents((prev) =>
            prev.map((st) => {
              if (
                String(st.number) !== String(student.number) ||
                !belongsToActiveClass(st)
              ) {
                return st;
              }
              if (isActiveTopic) {
                return { ...st, docId: res.docId, docUrl: res.docUrl };
              }
              return {
                ...st,
                historyByTopic: {
                  ...(st.historyByTopic || {}),
                  [targetTopicId]: {
                    ...(st.historyByTopic?.[targetTopicId] || {}),
                    docId: res.docId,
                    docUrl: res.docUrl
                  }
                }
              };
            })
          );
          return res;
        }
      } catch (e) {
        console.warn('학생 구글 독스 자동 생성 참고:', e);
      }
      return null;
    },
    [
      googleAuth?.accessToken,
      config.className,
      config.assignmentTitle,
      config.activeTopicId,
      config.driveFolderId
    ]
  );

  // [핵심] 학생 구글 독스에서 Brisk로 넣은 종합 첨삭(표/문단)과 부분 첨삭(댓글)을 앱으로 자동 가져오기!
  const handlePullFeedbackFromDoc = useCallback(
    async (studentNumber, topicId, explicitDocId) => {
      const targetSt = students.find(
        (s) => belongsToActiveClass(s) && String(s.number) === String(studentNumber)
      );
      const targetTopicId = topicId || config.activeTopicId || '';
      const isActiveTopic = targetTopicId === (config.activeTopicId || 'TOPIC_1');
      const targetTopicData = isActiveTopic
        ? targetSt
        : { ...targetSt, ...(targetSt?.historyByTopic?.[targetTopicId] || {}) };
      const targetDocId =
        (explicitDocId && !String(explicitDocId).startsWith('DEMO_') ? explicitDocId : null) ||
        targetTopicData?.docId;

      // 1순위: 교사 Google OAuth 토큰으로 직접 내 구글 독스에서 Brisk 표/댓글 읽어오기!
      if (
        googleAuth?.accessToken &&
        targetDocId &&
        !String(targetDocId).startsWith('DEMO_')
      ) {
        try {
          const currentText = getLatestDraftText(targetTopicData);
          const directRes = await pullBriskFeedbackFromGoogleDoc(
            googleAuth.accessToken,
            targetDocId,
            currentText
          );
          if (directRes) {
            return {
              ok: true,
              mode: 'google',
              pulledNote: directRes.pulledNote || '',
              pulledComments: directRes.pulledComments || []
            };
          }
        } catch (e) {
          console.warn('Google Docs 직접 읽기 참고:', e);
        }
      }

      // 2순위: GAS 연동 시
      if (gasUrl) {
        const res = await callGasApi({
          action: 'pullFeedbackFromDoc',
          number: studentNumber,
          topicId: targetTopicId
        });
        if (res && res.ok) {
          return {
            ok: true,
            mode: 'gas',
            pulledNote: res.pulledNote || '',
            pulledComments: res.pulledComments || []
          };
        }
      }

      // 구글 로그인 상태인데 독스가 아직 없거나 읽어오지 못한 경우 (다른 학생 데모 데이터로 덮어쓰지 않음!)
      if (googleAuth?.accessToken) {
        return {
          ok: false,
          error: '학생 구글 독스가 아직 생성되지 않았거나 열리지 않았습니다. [1. 학생 독스 열기]를 먼저 눌러주세요.'
        };
      }

      // 3순위: 로그인하지 않은 순수 체험(데모) 모드일 때만 예시 안내 문구 제공
      const stName = targetSt?.name || '학생';
      const demoNote = `[칭찬해요 · 잘한 점]\n• ${stName} 학생이 겪은 일을 시작·가운데·끝 문단으로 나누어 차례대로 잘 정리했어요.\n• 자신의 솔직한 마음과 생각이 자연스럽게 드러나서 읽는 사람도 장면이 생생하게 떠올라요.\n\n[더 자랄 점 · 고쳐 볼 점]\n• 가장 기억에 남는 장면에서 그때 들렸던 소리나 표정을 한 문장 더 자세히 묘사해 볼까요?\n\n[궁금해요 · 더 생각해 볼 점]\n• 오늘 겪은 일을 통해 앞으로 어떤 다짐을 하게 되었는지 마지막 문단에 한 줄 더 들려줄래요?`;

      return {
        ok: true,
        mode: 'demo',
        pulledNote: demoNote,
        pulledComments: []
      };
    },
    [googleAuth?.accessToken, gasUrl, callGasApi, students, config.activeTopicId]
  );

  const handlePreviewAsStudent = (student, topicId = config.activeTopicId || '') => {
    setActiveStudent(student);
    setTeacherPreviewTopicId(topicId || config.activeTopicId || '');
    setIsTeacherPreview(true);
    setRoleMode('student');
  };

  const handleExitTeacherPreview = () => {
    setActiveStudent(null);
    setTeacherPreviewTopicId('');
    setIsTeacherPreview(false);
    setRoleMode('teacher');
  };

  const handleTeacherLogout = () => {
    setGoogleAuth(null);
    localStorage.removeItem(STORAGE_KEYS.GOOGLE_AUTH);
    localStorage.removeItem(STORAGE_KEYS.TEACHER_STEP);
    handleChangeTeacherStep('login');
  };

  const showHeaderClassBadge =
    Boolean(config.className) &&
    (roleMode === 'student' || teacherStep === 'bookshelf');

  const showRoleSwitcher =
    !isStudentUrlMode && !(roleMode === 'teacher' && teacherStep === 'login');

  return (
    <div className="min-h-dvh flex flex-col">
      {/* 와이드 상단 헤더 */}
      <header className="sticky top-0 z-30 bg-[#FBFBF9]/95 backdrop-blur-sm border-b border-[#E2E8F0]">
        <div className="w-full px-6 lg:px-10 h-16 flex items-center justify-between gap-4 flex-nowrap">
          <div className="flex items-center gap-3 min-w-0 flex-nowrap">
            <HandDrawnNotebookLogo size={42} />
            <div className="flex items-center gap-2.5 flex-nowrap">
              <div className="flex items-baseline gap-2">
                <span className="font-editorial-serif font-bold text-xl text-[#1B4332] whitespace-nowrap">
                  쓰담
                </span>
                <span className="text-xs font-semibold text-[#2D6A4F] hidden sm:inline whitespace-nowrap">
                  다정한 글쓰기
                </span>
              </div>
              {showHeaderClassBadge && (
                <span className="px-2.5 py-0.5 rounded-full bg-[#F2F9F5] border border-[#B7E4C7] text-xs font-bold text-[#1B4332] whitespace-nowrap">
                  {config.className}
                </span>
              )}
            </div>
          </div>

          {showRoleSwitcher && (
            <div className="flex items-center gap-2.5 shrink-0 flex-nowrap">
              <div className="inline-flex rounded-xl bg-white border border-[#1B4332] p-0.5">
                <button
                  type="button"
                  onClick={() => {
                    if (roleMode === 'student' && isTeacherPreview) return;
                    const selectedStudent =
                      visibleStudents.find(
                        (student) =>
                          String(student.number) === String(teacherSelectedStudentNumber)
                      ) || visibleStudents[0];
                    if (selectedStudent) {
                      handlePreviewAsStudent(
                        selectedStudent,
                        teacherOpenedTopicId || config.activeTopicId || ''
                      );
                    } else {
                      setActiveStudent(null);
                      setTeacherPreviewTopicId('');
                      setIsTeacherPreview(false);
                      setRoleMode('student');
                    }
                  }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer ${
                    roleMode === 'student'
                      ? 'bg-[#1B4332] text-white'
                      : 'text-[#1B4332] hover:bg-[#F2F9F5]'
                  }`}
                >
                  <GraduationCap className="w-4 h-4" />
                  <span>학생 공책</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== 'undefined' && window.location.search.includes('student=1')) {
                      window.history.replaceState({}, '', window.location.pathname);
                    }
                    if (isTeacherPreview) handleExitTeacherPreview();
                    else setRoleMode('teacher');
                  }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer ${
                    roleMode === 'teacher'
                      ? 'bg-[#1B4332] text-white'
                      : 'text-[#1B4332] hover:bg-[#F2F9F5]'
                  }`}
                >
                  <Users className="w-4 h-4" />
                  <span>선생님 관리</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        {roleMode === 'student' ? (
          <StudentStudio
            topics={visibleTopics}
            students={visibleStudents}
            questions={visibleQuestions}
            config={config}
            activeStudent={activeStudent}
            isTeacherPreview={isTeacherPreview}
            initialTopicId={teacherPreviewTopicId}
            onLoginStudent={handleStudentLogin}
            onLogoutStudent={
              isStudentUrlMode
                ? handleStudentLogout
                : isTeacherPreview
                ? handleExitTeacherPreview
                : () => setActiveStudent(null)
            }
            onSubmitStage={handleSubmitStage}
            onUnsubmitStage={handleUnsubmitStage}
            onAddQuestion={handleAddQuestion}
          />
        ) : (
          <TeacherDashboard
            teacherStep={teacherStep}
            onChangeTeacherStep={handleChangeTeacherStep}
            classes={classes}
            onSelectClass={handleSelectClass}
            onCreateClass={handleCreateClass}
            onDeleteClass={handleDeleteClass}
            topics={visibleTopics}
            selectedTopicId={selectedTopicId}
            onSelectTopic={setSelectedTopicId}
            openedTopicId={teacherOpenedTopicId}
            onChangeOpenedTopicId={setTeacherOpenedTopicId}
            selectedStudentNumber={teacherSelectedStudentNumber}
            onChangeSelectedStudentNumber={setTeacherSelectedStudentNumber}
            onCreateNewTopic={handleCreateNewTopic}
            onUpdateTopic={handleUpdateTopic}
            onSaveFeedbackCriteria={handleSaveFeedbackCriteria}
            onSendBatchFeedback={handleSendBatchFeedback}
            onDeleteTopic={handleDeleteTopic}
            onManageStudents={handleManageStudents}
            students={visibleStudents}
            allStudents={students}
            questions={visibleQuestions}
            allTopics={topics}
            config={config}
            googleAuth={googleAuth}
            googleClientId={googleClientId}
            onSaveGoogleClientId={(cid) => {
              setGoogleClientId(cid);
              localStorage.setItem(STORAGE_KEYS.GOOGLE_CLIENT_ID, cid);
            }}
            onTeacherGoogleLogin={handleTeacherGoogleLogin}
            onTeacherLogout={handleTeacherLogout}
            gasUrl={gasUrl}
            classAccessKey={config.classAccessKeys?.[activeClassId] || ''}
            onOpenGasSetup={() => setIsSetupModalOpen(true)}
            onEnsureStudentDoc={handleEnsureStudentDoc}
            onUpdateStudentStatus={handleUpdateStudentStatus}
            onBatchDeadline={handleBatchDeadline}
            onReplyQuestion={handleReplyQuestion}
            onPullFeedbackFromDoc={handlePullFeedbackFromDoc}
          />
        )}
      </main>

      <GasSetupModal
        isOpen={isSetupModalOpen}
        onClose={() => setIsSetupModalOpen(false)}
        gasUrl={gasUrl}
        onSaveGasUrl={handleSaveGasUrl}
        onAutoSetup={handleAutoSetupRelay}
        onTestConnection={() => callGasApi({ action: 'ping' })}
        isSyncing={isSyncing}
      />
    </div>
  );
}
