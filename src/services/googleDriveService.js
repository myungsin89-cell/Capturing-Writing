/**
 * 쓰담 (다정한 글쓰기) — Google OAuth 2.0 + Google Drive / Sheets / Docs 자동 생성 및 동기화 서비스
 *
 * [작동 원리 - 제작자 서버 비용 평생 0원]
 * 1. 교사가 [Google 계정으로 시작하기]를 클릭하면 Google Identity Services(OAuth2)로 로그인합니다.
 * 2. 로그인 즉시 교사 본인의 구글 드라이브에서 '[쓰담] 다정한 글쓰기 데이터베이스' 시트를 찾고,
 *    없으면 그 자리에서 자동으로 시트를 생성(Sheets API)하고 학생 제출용 공유 권한(Drive API)을 설정합니다.
 * 3. 학급/주제 생성 시 교사의 구글 드라이브에 학생별 구글 독스(Google Docs)를 자동으로 생성합니다.
 * 4. Brisk Teaching 첨삭 가져오기 및 이전 차수 표/댓글 자동 청소도 교사의 OAuth 토큰으로 직접 처리합니다.
 */

import gasCodeRaw from '../../gas/Code.gs?raw';
import gasManifestRaw from '../../gas/appsscript.json?raw';
import { prepareFeedbackBatch } from './batchFeedbackDrive';
import {
  applyFeedbackToStudent, getFeedbackTopicRecord, hasFeedbackContent,
  nextRecordTimestamp, wasBatchFeedbackDelivered
} from '../utils/batchFeedback';

export function prepareFeedbackBatchInDrive(accessToken, batch, onProgress) {
  if (!accessToken) throw new Error('구글 로그인 후 묶음 피드백을 준비해 주세요.');
  return prepareFeedbackBatch((url, options) => googleFetch(url, accessToken, options), batch, onProgress);
}

export const DEFAULT_GOOGLE_CLIENT_ID =
  '1095632072504-ijtmagk1fblel9i8d5oglj0e4d846f3q.apps.googleusercontent.com';

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const SPREADSHEET_TITLE = '[쓰담] 다정한 글쓰기 데이터베이스';
const ROOT_FOLDER_NAME = '[쓰담] 다정한 글쓰기 교실';
const STUDENT_TEXT_MARKER = '━━━ [학생 작성 본문] ━━━';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
].join(' ');

let gisLoadedPromise = null;

export function loadGoogleIdentityScript() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.google && window.google.accounts && window.google.accounts.oauth2) {
    return Promise.resolve();
  }
  if (gisLoadedPromise) return gisLoadedPromise;

  gisLoadedPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', (e) => reject(e));
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = (e) => reject(e);
    document.head.appendChild(script);
  });

  return gisLoadedPromise;
}
/**
 * 교사 Google OAuth 팝업 로그인 및 Access Token 발급
 */
export async function loginTeacherWithGoogle(clientId, options = {}) {
  const prompt = options.prompt !== undefined ? options.prompt : 'select_account';
  const cleanClientId = (
    clientId ||
    import.meta.env.VITE_GOOGLE_CLIENT_ID ||
    DEFAULT_GOOGLE_CLIENT_ID
  ).trim();
  if (!cleanClientId) {
    throw new Error('MISSING_CLIENT_ID');
  }

  await loadGoogleIdentityScript();

  return new Promise((resolve, reject) => {
    try {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: cleanClientId,
        scope: SCOPES,
        callback: async (tokenResponse) => {
          if (tokenResponse.error) {
            reject(new Error(tokenResponse.error_description || tokenResponse.error));
            return;
          }
          const accessToken = tokenResponse.access_token;
          const expiresInSec = Number(tokenResponse.expires_in || 3500);
          try {
            const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${accessToken}` }
            });
            const profile = profileRes.ok ? await profileRes.json() : {};
            resolve({
              accessToken,
              expiresAt: Date.now() + expiresInSec * 1000,
              user: {
                name: profile.name || options.existingUser?.name || '선생님',
                email: profile.email || options.existingUser?.email || '',
                picture: profile.picture || options.existingUser?.picture || ''
              }
            });
          } catch {
            resolve({
              accessToken,
              expiresAt: Date.now() + expiresInSec * 1000,
              user: options.existingUser || { name: '선생님', email: '' }
            });
          }
        }
      });

      tokenClient.requestAccessToken({ prompt });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * 교사 화면 활성화 중 백그라운드에서 토큰을 자동 갱신 (팝업 없이 세션 연장)
 */
export async function refreshTeacherGoogleToken(clientId, existingAuth) {
  return loginTeacherWithGoogle(clientId, {
    prompt: '',
    existingUser: existingAuth?.user
  });
}

async function googleFetch(url, accessToken, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const errText = await res.text();
    let friendlyMessage = '';
    if (res.status === 429) {
      friendlyMessage = 'Google API 요청 한도 초과 (429): 동시 요청이 많습니다. 잠시 후 다시 시도해 주세요.';
    } else if (res.status === 401) {
      friendlyMessage = 'Google 인증 만료 (401): 선생님의 연결 권한이 만료되었습니다. 화면을 새로고침해 주세요.';
    } else if (res.status === 403) {
      friendlyMessage = 'Google 권한 오류 (403): 구글 드라이브 또는 시트 접근 권한을 확인해 주세요.';
    }
    const fullMessage = friendlyMessage
      ? `${friendlyMessage} (${errText})`
      : `Google API 오류 (${res.status}): ${errText}`;
    const error = new Error(fullMessage);
    error.status = res.status;
    error.rawText = errText;
    throw error;
  }
  if (res.status === 204) return null;
  return res.json();
}

/**
 * 교사의 구글 드라이브에 '[쓰담] 다정한 글쓰기 교실' 루트 폴더 자동 확인/생성
 */
export async function ensureRootFolder(accessToken) {
  const q = encodeURIComponent(
    `name = '${ROOT_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const search = await googleFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    accessToken
  );
  if (search.files && search.files.length > 0) {
    return search.files[0].id;
  }

  const created = await googleFetch('https://www.googleapis.com/drive/v3/files', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      name: ROOT_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder'
    })
  });
  return created.id;
}

/**
 * 학생 제출 중계기(GAS 웹 앱)를 교사의 [쓰담] 시트에 자동으로 만들고 웹 앱으로 배포합니다.
 * (Apps Script API: projects.create → updateContent → versions.create → deployments.create)
 * 교사가 직접 코드를 붙여넣거나 배포할 필요가 없습니다.
 */
const RELAY_SCRIPT_ID_KEY = 'sseudam_relay_script_id_v1';

function classifyRelayError(err) {
  const msg = String(err?.message || err);
  let code = '';
  if (/insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(msg)) {
    code = 'RELAY_NEED_RELOGIN';
  } else if (/has not been used in project|SERVICE_DISABLED|accessNotConfigured/i.test(msg)) {
    code = 'RELAY_CLOUD_API_DISABLED';
  } else if (/User has not enabled the Apps Script API|usersettings/i.test(msg)) {
    code = 'RELAY_USER_API_DISABLED';
  }
  const linkMatch = msg.match(/https:\/\/console\.(?:developers|cloud)\.google\.com\/[^\s"\\]+/);
  return { code, msg, enableUrl: linkMatch ? linkMatch[0] : '' };
}

export async function deployStudentRelayWebApp(accessToken, spreadsheetId) {
  if (!spreadsheetId) throw new Error('시트가 아직 준비되지 않았습니다.');
  const base = 'https://script.googleapis.com/v1/projects';

  const runOnce = async () => {
    // 이전 시도에서 프로젝트만 만들어지고 실패했다면 그 프로젝트를 재사용합니다. (중복 생성 방지)
    let scriptId = localStorage.getItem(RELAY_SCRIPT_ID_KEY) || '';
    if (scriptId && !scriptId.startsWith(`${spreadsheetId}:`)) scriptId = '';
    scriptId = scriptId ? scriptId.split(':')[1] : '';

    if (!scriptId) {
      const project = await googleFetch(base, accessToken, {
        method: 'POST',
        body: JSON.stringify({ title: '[쓰담] 학생 제출 중계기', parentId: spreadsheetId })
      });
      scriptId = project.scriptId;
      localStorage.setItem(RELAY_SCRIPT_ID_KEY, `${spreadsheetId}:${scriptId}`);
    }

    await googleFetch(`${base}/${scriptId}/content`, accessToken, {
      method: 'PUT',
      body: JSON.stringify({
        files: [
          { name: 'Code', type: 'SERVER_JS', source: gasCodeRaw },
          { name: 'appsscript', type: 'JSON', source: gasManifestRaw }
        ]
      })
    });

    const version = await googleFetch(`${base}/${scriptId}/versions`, accessToken, {
      method: 'POST',
      body: JSON.stringify({ description: '쓰담 자동 배포' })
    });

    const deployment = await googleFetch(`${base}/${scriptId}/deployments`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        versionNumber: version.versionNumber,
        manifestFileName: 'appsscript',
        description: '쓰담 학생 제출 웹 앱'
      })
    });

    const webApp = (deployment.entryPoints || []).find((e) => e.webApp?.url);
    const gasUrl = webApp?.webApp?.url || '';
    if (!gasUrl) throw new Error('웹 앱 주소를 받지 못했습니다.');
    return { scriptId, gasUrl };
  };

  // 선생님이 Apps Script API를 막 켠 직후에는 구글 반영까지 잠시 걸리므로 몇 번 자동 재시도합니다.
  const waits = [0, 4000, 8000];
  let last = null;
  for (const wait of waits) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      return await runOnce();
    } catch (err) {
      last = classifyRelayError(err);
      console.warn('[쓰담] 학생 제출 중계기 생성 오류:', last.msg);
      if (last.code !== 'RELAY_USER_API_DISABLED') break;
    }
  }
  const e = new Error(last?.code || 'RELAY_FAILED');
  e.detail = last?.msg || '';
  e.enableUrl = last?.enableUrl || '';
  throw e;
}

const studentReadySheetIds = new Set();

export async function ensureStudentSheetPermission(accessToken, fileId) {
  if (!accessToken || !fileId || studentReadySheetIds.has(fileId)) return;
  try {
    await googleFetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ role: 'reader', type: 'anyone' })
      }
    );
    studentReadySheetIds.add(fileId);
  } catch (e) {
    console.warn('학생 연결용 시트 권한 설정 참고:', e);
  }
}

/**
 * 교사의 구글 드라이브에 '[쓰담] 다정한 글쓰기 데이터베이스' 구글 시트를 자동으로 찾거나 생성합니다.
 */
export async function ensureTeacherSpreadsheet(accessToken, initialData = {}) {
  const folderId = await ensureRootFolder(accessToken);

  const q = encodeURIComponent(
    `name = '${SPREADSHEET_TITLE}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`
  );
  const search = await googleFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,webViewLink)`,
    accessToken
  );

  if (search.files && search.files.length > 0) {
    const existing = search.files[0];
    await ensureStudentSheetPermission(accessToken, existing.id);
    return {
      spreadsheetId: existing.id,
      spreadsheetUrl: existing.webViewLink || `https://docs.google.com/spreadsheets/d/${existing.id}/edit`,
      folderId,
      isNew: false
    };
  }

  // 시트가 없으면 새로 자동 생성!
  const created = await googleFetch('https://sheets.googleapis.com/v4/spreadsheets', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: SPREADSHEET_TITLE },
      sheets: [
        { properties: { title: 'AppState', gridProperties: { rowCount: 100, columnCount: 10 } } },
        { properties: { title: 'Students', gridProperties: { rowCount: 200, columnCount: 15 } } },
        { properties: { title: 'Questions', gridProperties: { rowCount: 300, columnCount: 12 } } }
      ]
    })
  });

  const spreadsheetId = created.spreadsheetId;

  // 생성된 시트를 [쓰담] 폴더 안으로 이동하고 학생 링크 접속을 활성화합니다.
  try {
    await googleFetch(
      `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?addParents=${folderId}&fields=id`,
      accessToken,
      { method: 'PATCH', body: JSON.stringify({}) }
    );
  } catch (e) {
    console.warn('시트 폴더 이동 참고:', e);
  }

  await ensureStudentSheetPermission(accessToken, spreadsheetId);

  // 초기 데이터 저장
  await saveFullStateToSpreadsheet(accessToken, spreadsheetId, initialData);

  return {
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    folderId,
    isNew: true
  };
}

/**
 * 이전 버전에서 생성한 "링크가 있는 모든 사용자" 권한을 제거합니다.
 * 사용자·그룹별 공유 권한은 건드리지 않습니다.
 */
export async function removePublicLinkPermissions(accessToken, fileId) {
  if (!accessToken || !fileId) return;
  try {
    const res = await googleFetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?fields=permissions(id,type,role)`,
      accessToken
    );
    const publicPermissions = (res?.permissions || []).filter(
      (permission) => permission.type === 'anyone'
    );
    for (const permission of publicPermissions) {
      await googleFetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}/permissions/${permission.id}`,
        accessToken,
        { method: 'DELETE' }
      );
    }
  } catch (e) {
    console.warn('기존 공개 링크 권한 정리 참고:', e);
  }
}

/**
 * 구글 시트에서 전체 학급/주제/학생/질문 데이터를 불러옵니다.
 */
export async function loadFullStateFromSpreadsheet(accessToken, spreadsheetId) {
  const res = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/AppState!A1:B100`,
    accessToken
  );
  const rows = res.values || [];
  const rawMap = {};
  rows.forEach((r) => {
    if (r[0] && r[1]) {
      const match = String(r[0]).match(/^(.+):(\d+)$/);
      const key = match ? match[1] : r[0];
      const chunkIndex = match ? Number(match[2]) : 0;
      if (!rawMap[key]) rawMap[key] = [];
      rawMap[key][chunkIndex] = r[1];
    }
  });
  const map = {};
  Object.entries(rawMap).forEach(([key, chunks]) => {
    const raw = chunks.join('');
    try {
      map[key] = JSON.parse(raw);
    } catch {
      map[key] = raw;
    }
  });
  return map;
}

function buildChunkedStateValues(state) {
  const rows = [['KEY', 'JSON_VALUE', 'ROW_NUM']];
  const chunkSize = 45000;
  let rowNum = 1;
  Object.entries(state).forEach(([key, value]) => {
    const serialized = JSON.stringify(value);
    if (serialized.length <= chunkSize) {
      rows.push([key, serialized, rowNum++]);
      return;
    }
    for (let offset = 0, index = 0; offset < serialized.length; offset += chunkSize, index++) {
      rows.push([`${key}:${index}`, serialized.slice(offset, offset + chunkSize), rowNum++]);
    }
  });
  return rows;
}

function recordKey(record) {
  return `${record?.classId || ''}::${record?.number || record?.id || ''}`;
}

function mergeNewerRemoteRecords(localRecords = [], remoteRecords = []) {
  const remoteByKey = new Map(remoteRecords.map((record) => [recordKey(record), record]));
  return localRecords.map((localRecord) => {
    const remoteRecord = remoteByKey.get(recordKey(localRecord));
    if (!remoteRecord) return localRecord;
    const localTime = Date.parse(localRecord.updatedAtIso || '') || 0;
    const remoteTime = Date.parse(remoteRecord.updatedAtIso || '') || 0;
    return remoteTime > localTime ? remoteRecord : localRecord;
  });
}

function dedupeStoredQuestions(items = []) {
  const seenIds = new Set();
  const recentByContent = new Map();
  return items.filter((question) => {
    const id = String(question?.id || '');
    if (id && seenIds.has(id)) return false;
    if (id) seenIds.add(id);
    if (question?.resolved === true || question?.resolved === 'TRUE') return true;
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

function mergeQuestions(localQuestions = [], remoteQuestions = []) {
  const merged = new Map(remoteQuestions.map((question) => [String(question.id), question]));
  localQuestions.forEach((question) => {
    const previous = merged.get(String(question.id));
    const previousTime = Date.parse(previous?.updatedAtIso || previous?.createdAtIso || '') || 0;
    const nextTime = Date.parse(question.updatedAtIso || question.createdAtIso || '') || 0;
    if (!previous || nextTime >= previousTime) merged.set(String(question.id), question);
  });
  return dedupeStoredQuestions(Array.from(merged.values()));
}

/**
 * 구글 시트에 전체 학급/주제/학생/질문 데이터를 깔끔하게 저장합니다.
 * (교사가 시트를 직접 열었을 때도 보기 쉽도록 Students 시트와 AppState 시트를 함께 업데이트합니다)
 */
const spreadsheetSaveQueues = new Map();

export function saveFullStateToSpreadsheet(accessToken, spreadsheetId, state) {
  // Serialize this browser's teacher writes so a delayed autosave cannot overtake
  // a reviewed-feedback send. Newer remote student records are merged below.
  const previous = spreadsheetSaveQueues.get(spreadsheetId) || Promise.resolve();
  const pending = previous.catch(() => {}).then(() => writeFullStateToSpreadsheet(accessToken, spreadsheetId, state));
  spreadsheetSaveQueues.set(spreadsheetId, pending);
  const cleanup = () => {
    if (spreadsheetSaveQueues.get(spreadsheetId) === pending) spreadsheetSaveQueues.delete(spreadsheetId);
  };
  pending.then(cleanup, cleanup);
  return pending;
}

async function writeFullStateToSpreadsheet(
  accessToken,
  spreadsheetId,
  { classes, topics, students, questions, config, replaceRemoteRecords = false, reviewedFeedback }
) {
  if (!accessToken || !spreadsheetId) return;
  await ensureStudentSheetPermission(accessToken, spreadsheetId);

  let safeStudents = students || [];
  let safeQuestions = dedupeStoredQuestions(questions || []);
  let feedbackStudent = null;
  if (!replaceRemoteRecords) {
    try {
      const remote = await loadFullStateFromSpreadsheet(accessToken, spreadsheetId);
      safeStudents = mergeNewerRemoteRecords(safeStudents, remote.students || []);
      safeQuestions = mergeQuestions(safeQuestions, remote.questions || []);
      if (reviewedFeedback) {
        const { classId, topicId, entry } = reviewedFeedback;
        if (!entry.reviewed || !hasFeedbackContent(entry)) throw new Error('피드백 내용을 읽고 확인한 후 전송해 주세요.');
        const legacyClassId = remote.classes?.[0]?.id || remote.config?.activeClassId || '';
        const target = (remote.students || []).find((student) =>
          String(student.classId || legacyClassId) === String(classId) && String(student.number) === String(entry.number));
        const topic = (remote.topics || []).find((item) => String(item.id) === String(topicId) && String(item.classId || legacyClassId) === String(classId));
        const activeTopic = (remote.topics || []).find((item) => String(item.classId || legacyClassId) === String(classId) && item.isActive);
        const activeTopicId = activeTopic?.id || remote.config?.activeTopicId;
        if (topic && target && wasBatchFeedbackDelivered(getFeedbackTopicRecord(target, topic, activeTopicId), entry)) {
          return { feedbackStudent: { ...target, classId: target.classId || legacyClassId } };
        }
        feedbackStudent = topic && target && applyFeedbackToStudent(
          { ...target, classId: target.classId || legacyClassId },
          { topicId, activeTopicId, entry, nowIso: nextRecordTimestamp([target]) }
        );
        if (!feedbackStudent) {
          const error = new Error('학생의 제출 상태가 바뀌었습니다. 최신 제출본을 확인하고 다시 준비해 주세요.');
          error.student = target ? { ...target, classId: target.classId || legacyClassId } : null;
          throw error;
        }
        safeStudents = safeStudents.map((student) =>
          String(student.classId || legacyClassId) === String(classId) && String(student.number) === String(entry.number)
            ? feedbackStudent : student);
      }
    } catch (e) {
      if (reviewedFeedback) throw e;
      console.warn('저장 전 원격 변경 병합 참고:', e);
    }
  }

  const stateValues = buildChunkedStateValues({
    classes: classes || [],
    topics: topics || [],
    students: safeStudents,
    questions: safeQuestions,
    config: { ...(config || {}), teacherBridgeToken: accessToken },
    updatedAt: new Date().toISOString()
  });
  if (stateValues.length > 100) {
    throw new Error('학급 데이터가 너무 커졌습니다. 자료 보관 구조 확장이 필요합니다.');
  }

  const studentRows = [
    ['출석번호', '이름', '작품 제목', '상태', '1차 글', '2차 글', '3차 글', '4차 글', '선생님 종합 첨삭', '구글 독스 링크', '최근 수정']
  ];
  safeStudents.forEach((st) => {
    studentRows.push([
      String(st.number || ''),
      String(st.name || ''),
      String(st.pieceTitle || ''),
      String(st.status || ''),
      String(st.draft1 || ''),
      String(st.draft2 || ''),
      String(st.draft3 || ''),
      String(st.draft4 || ''),
      String(st.teacherNote || ''),
      String(st.docUrl || ''),
      String(st.updatedAt || '')
    ]);
  });

  const questionRows = [
    ['ID', '학급 ID', '주제 ID', '출석번호', '이름', '질문', '인용문', '답변', '해결 여부', '등록 시각', '수정 시각', '출처']
  ];
  safeQuestions.forEach((question) => {
    questionRows.push([
      String(question.id || ''),
      String(question.classId || ''),
      String(question.topicId || ''),
      String(question.number || ''),
      String(question.name || ''),
      String(question.question || ''),
      String(question.quote || ''),
      String(question.reply || ''),
      question.resolved ? '완료' : '대기',
      String(question.createdAt || question.createdAtIso || ''),
      String(question.updatedAt || question.updatedAtIso || ''),
      String(question.source || '')
    ]);
  });

  try {
    await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'RAW',
          data: [
            { range: 'AppState!A1', values: stateValues },
            { range: 'Students!A1', values: studentRows },
            { range: 'Questions!A1', values: questionRows }
          ]
        })
      }
    );
  } catch (error) {
    // A lost HTTP response can follow a successful write. Read the receipt before
    // reporting failure so a retry never sends a second feedback round.
    if (reviewedFeedback) {
      const readback = await loadFullStateFromSpreadsheet(accessToken, spreadsheetId);
      const { classId, topicId, entry } = reviewedFeedback;
      const legacyClassId = readback.classes?.[0]?.id || readback.config?.activeClassId || '';
      const saved = readback.students?.find((student) => String(student.classId || legacyClassId) === String(classId) && String(student.number) === String(entry.number));
      const activeTopicId = readback.topics?.find((topic) => topic.isActive && String(topic.classId || legacyClassId) === String(classId))?.id || readback.config?.activeTopicId;
      if (saved && wasBatchFeedbackDelivered(getFeedbackTopicRecord(saved, { id: topicId }, activeTopicId), entry)) {
        return { feedbackStudent: { ...saved, classId: saved.classId || legacyClassId } };
      }
    }
    throw error;
  }

  try {
    const firstUnusedRow = stateValues.length + 1;
    if (firstUnusedRow <= 100) {
      await googleFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/AppState!A${firstUnusedRow}:B100:clear`,
        accessToken,
        { method: 'POST', body: JSON.stringify({}) }
      );
    }

    const firstUnusedStudentRow = studentRows.length + 1;
    if (firstUnusedStudentRow <= 200) {
      await googleFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Students!A${firstUnusedStudentRow}:O200:clear`,
        accessToken,
        { method: 'POST', body: JSON.stringify({}) }
      );
    }

    const firstUnusedQuestionRow = questionRows.length + 1;
    if (firstUnusedQuestionRow <= 300) {
      await googleFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Questions!A${firstUnusedQuestionRow}:L300:clear`,
        accessToken,
        { method: 'POST', body: JSON.stringify({}) }
      );
    }
  } catch (error) {
    if (!reviewedFeedback) throw error;
    console.warn('피드백 저장 후 빈 행 정리 참고:', error);
  }
  return { feedbackStudent };
}

function getStoredDraftHistory(record = {}) {
  const isFreshTopic = record.status === 'STAGE_1_WRITING' && !record.recalled &&
    !String(record.pieceTitle || '').trim() &&
    ![record.draft1, record.draft2, record.draft3, record.draft4, record.draft5]
      .some((text) => String(text || '').trim());
  const storedHistory = isFreshTopic ? [] : (Array.isArray(record.draftHistory)
    ? record.draftHistory.filter((draft) => draft?.text && String(draft.text).trim())
    : []);
  if (storedHistory.length > 0) {
    return storedHistory;
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

function appendStoredDraftRevision(record = {}, text, pieceTitle, updatedAt, updatedAtIso, options = {}) {
  const history = getStoredDraftHistory(record);
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

function getStoredLatestDraftText(record = {}) {
  const history = getStoredDraftHistory(record);
  return history[history.length - 1]?.text || record.draft5 || record.draft4 || record.draft3 || record.draft2 || record.draft1 || '';
}

/**
 * 학생별 Google Docs 자동 생성 (또는 기존 독스 초기화) 및 학생 최신 본문 동기화
 */
export async function ensureAndSyncStudentGoogleDoc(
  accessToken,
  { student, className, topicTitle, folderId, studentText, pieceTitle }
) {
  if (!accessToken || !student) return null;

  const targetFolderId = folderId || (await ensureRootFolder(accessToken));
  const latestText =
    studentText !== undefined && studentText !== null
      ? studentText
      : getStoredLatestDraftText(student);
  const cleanPieceTitle = pieceTitle || student.pieceTitle || topicTitle || '제목 없음';

  let docId = student.docId;
  let docUrl = student.docUrl;

  // 데모 ID이거나 아직 실제 독스가 없으면 교사의 구글 드라이브에 자동 생성!
  if (!docId || String(docId).startsWith('DEMO_')) {
    const docTitle = `[${className || '쓰담'}] ${student.number}번 ${student.name} - ${
      cleanPieceTitle || topicTitle || '글쓰기 공책'
    }`;

    const createdFile = await googleFetch(
      'https://www.googleapis.com/drive/v3/files',
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          name: docTitle,
          mimeType: 'application/vnd.google-apps.document',
          parents: [targetFolderId]
        })
      }
    );

    docId = createdFile.id;
    docUrl = `https://docs.google.com/document/d/${docId}/edit`;
  }

  // 학생의 최신 글로 독스 본문을 깨끗하게 세팅 (이전 Brisk 표/댓글 초기화 및 최신 본문 100% 동기화)
  await resetGoogleDocWithStudentText(accessToken, docId, latestText, {
    pieceTitle: cleanPieceTitle,
    authorName: student.name || ''
  });

  return { docId, docUrl };
}

/**
 * 구글 독스 안의 이전 Brisk 첨삭 표/문단/댓글을 지우고 작품 제목·이름·학생 본문만 남깁니다.
 * 표(Table)와 문단을 역순으로 안전하게 삭제하여 테이블 경계 충돌 없이 본문을 깔끔하게 교체합니다.
 */
export async function resetGoogleDocWithStudentText(
  accessToken,
  docId,
  studentText,
  { pieceTitle = '', authorName = '' } = {}
) {
  if (!accessToken || !docId || String(docId).startsWith('DEMO_')) return;

  const cleanTitle = String(pieceTitle || '').trim() || '제목 없음';
  const cleanAuthor = String(authorName || '').trim();
  // 학생 공책에 입력한 문단·들여쓰기·끝줄을 임의로 잘라내지 않고 그대로 보존합니다.
  const rawBody = String(studentText || '').replace(/\r\n/g, '\n');

  try {
    const doc = await googleFetch(
      `https://docs.googleapis.com/v1/documents/${docId}`,
      accessToken
    );
    const content = doc.body?.content || [];
    const requests = [];

    // 역순으로 각 요소(표, 문단)를 삭제하여 테이블 경계 충돌 없이 깨끗이 비웁니다.
    for (let i = content.length - 1; i >= 0; i--) {
      const elem = content[i];
      if (i === content.length - 1) {
        // 구글 독스의 맨 마지막 문단(맨 끝 줄바꿈 \n)은 삭제할 수 없으므로, 그 앞까지만 삭제
        if (elem.endIndex - 1 > elem.startIndex) {
          requests.push({
            deleteContentRange: {
              range: { startIndex: elem.startIndex, endIndex: elem.endIndex - 1 }
            }
          });
        }
      } else {
        // 테이블이나 이전 문단 전체를 통째로 안전하게 삭제
        if (elem.endIndex > elem.startIndex) {
          requests.push({
            deleteContentRange: {
              range: { startIndex: elem.startIndex, endIndex: elem.endIndex }
            }
          });
        }
      }
    }

    const markerLine = `${STUDENT_TEXT_MARKER}\n`;
    const titleLine = `${cleanTitle}\n`;
    const authorLine = `${cleanAuthor ? cleanAuthor + '\n' : ''}`;
    const cleanBody = `${markerLine}${titleLine}${authorLine}\n${rawBody}\n`;
    const documentStart = 1;
    const documentEnd = documentStart + cleanBody.length;
    const markerEnd = documentStart + markerLine.length;
    const titleStart = documentStart + markerLine.length;
    const titleEnd = titleStart + cleanTitle.length;
    const authorStart = titleStart + titleLine.length;
    const authorEnd = authorStart + cleanAuthor.length;
    const bodyStart = authorStart + authorLine.length + 1;

    requests.push({
      insertText: {
        location: { index: 1 },
        text: cleanBody
      }
    });

    // 학생 공책과 같은 인상으로 제목·이름·본문을 정리합니다.
    requests.push({
      updateTextStyle: {
        range: { startIndex: documentStart, endIndex: documentEnd },
        textStyle: {
          weightedFontFamily: { fontFamily: 'Noto Serif KR' },
          fontSize: { magnitude: 14.5, unit: 'PT' },
          foregroundColor: {
            color: { rgbColor: { red: 0.118, green: 0.161, blue: 0.231 } }
          }
        },
        fields: 'weightedFontFamily,fontSize,foregroundColor'
      }
    });

    // 첨삭 추출에 필요한 내부 마커는 독스 화면에서는 보이지 않게 숨깁니다.
    requests.push({
      updateTextStyle: {
        range: { startIndex: documentStart, endIndex: markerEnd },
        textStyle: {
          fontSize: { magnitude: 1, unit: 'PT' },
          foregroundColor: {
            color: { rgbColor: { red: 1, green: 1, blue: 1 } }
          }
        },
        fields: 'fontSize,foregroundColor'
      }
    });
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: documentStart, endIndex: markerEnd },
        paragraphStyle: {
          lineSpacing: 100,
          spaceAbove: { magnitude: 0, unit: 'PT' },
          spaceBelow: { magnitude: 0, unit: 'PT' }
        },
        fields: 'lineSpacing,spaceAbove,spaceBelow'
      }
    });

    requests.push(
      {
        updateTextStyle: {
          range: { startIndex: titleStart, endIndex: titleEnd },
          textStyle: {
            bold: true,
            fontSize: { magnitude: 18, unit: 'PT' }
          },
          fields: 'bold,fontSize'
        }
      },
      {
        updateParagraphStyle: {
          range: { startIndex: titleStart, endIndex: titleEnd + 1 },
          paragraphStyle: {
            alignment: 'CENTER',
            spaceBelow: { magnitude: 9, unit: 'PT' }
          },
          fields: 'alignment,spaceBelow'
        }
      }
    );

    if (cleanAuthor) {
      requests.push(
        {
          updateTextStyle: {
            range: { startIndex: authorStart, endIndex: authorEnd },
            textStyle: {
              bold: true,
              fontSize: { magnitude: 14.5, unit: 'PT' },
              foregroundColor: {
                color: { rgbColor: { red: 0.278, green: 0.353, blue: 0.443 } }
              }
            },
            fields: 'bold,fontSize,foregroundColor'
          }
        },
        {
          updateParagraphStyle: {
            range: { startIndex: authorStart, endIndex: authorEnd + 1 },
            paragraphStyle: {
              alignment: 'END',
              spaceBelow: { magnitude: 16, unit: 'PT' }
            },
            fields: 'alignment,spaceBelow'
          }
        }
      );
    }

    if (bodyStart < documentEnd) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: bodyStart, endIndex: documentEnd },
          paragraphStyle: { lineSpacing: 160 },
          fields: 'lineSpacing'
        }
      });
    }

    if (requests.length > 0) {
      await googleFetch(
        `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({ requests })
        }
      );
    }

    // 이전 차수 구글 독스 댓글 비동기 정리
    try {
      const commentsRes = await googleFetch(
        `https://www.googleapis.com/drive/v3/files/${docId}/comments?fields=comments(id,deleted)`,
        accessToken
      );
      const comments = commentsRes?.comments || [];
      for (const c of comments) {
        if (!c.deleted) {
          googleFetch(
            `https://www.googleapis.com/drive/v3/files/${docId}/comments/${c.id}`,
            accessToken,
            { method: 'DELETE' }
          ).catch(() => {});
        }
      }
    } catch (e) {}
  } catch (err) {
    console.warn('Google Doc 본문 리셋 참고:', err);
  }
}

/**
 * Brisk Teaching의 영문 항목명(GLOW, GROW, WONDERING 등)을 다정한 초등 한국어 제목으로 변환합니다.
 */
export function translateBriskHeader(rawHeader = '') {
  const clean = String(rawHeader || '')
    .replace(/[^\w\s가-힣]/g, ' ')
    .trim()
    .toUpperCase();

  if (clean === 'GLOW' || clean === 'GLOWS' || clean === 'STRENGTH' || clean === 'STRENGTHS') {
    return '[칭찬해요 · 잘한 점]';
  }
  if (
    clean === 'GROW' ||
    clean === 'GROWS' ||
    clean === 'AREAS FOR GROWTH' ||
    clean === 'AREA FOR GROWTH'
  ) {
    return '[더 자랄 점 · 고쳐 볼 점]';
  }
  if (
    clean === 'WONDERING' ||
    clean === 'WONDERINGS' ||
    clean === 'WONDER' ||
    clean === 'QUESTIONS'
  ) {
    return '[궁금해요 · 더 생각해 볼 점]';
  }
  if (clean === 'NEXT STEPS' || clean === 'NEXT STEP') {
    return '[다음에 해 볼 일]';
  }
  return null;
}

export function translateBriskTextToKorean(rawText = '') {
  if (!rawText) return '';
  const translated = String(rawText)
    .replace(
      /^[\s✨🌟🌱💡❓•\-*\[\]()]*\b(GLOWS?|STRENGTHS?)\b[\s:：\-—\]()]*/gim,
      '[칭찬해요 · 잘한 점]\n'
    )
    .replace(
      /^[\s✨🌟🌱💡❓•\-*\[\]()]*\b(GROWS?|AREAS?\s+FOR\s+GROWTH)\b[\s:：\-—\]()]*/gim,
      '[더 자랄 점 · 고쳐 볼 점]\n'
    )
    .replace(
      /^[\s✨🌟🌱💡❓•\-*\[\]()]*\b(WONDERINGS?|WONDER)\b[\s:：\-—\]()]*/gim,
      '[궁금해요 · 더 생각해 볼 점]\n'
    )
    .replace(
      /\b(GLOWS?)\s*[:：]\s*/gi,
      '[칭찬해요 · 잘한 점]\n'
    )
    .replace(
      /\b(GROWS?)\s*[:：]\s*/gi,
      '[더 자랄 점 · 고쳐 볼 점]\n'
    )
    .replace(
      /\b(WONDERINGS?)\s*[:：]\s*/gi,
      '[궁금해요 · 더 생각해 볼 점]\n'
    );
  return formatBriskFeedbackText(translated);
}

export function formatBriskFeedbackText(rawText = '') {
  if (!rawText) return '';
  let text = String(rawText)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    // 표에서 한 줄로 합쳐진 평가 항목을 각각 새 줄로 분리합니다.
    .replace(/[ \t]*[•●▪◦]\s*(잘한\s*점|고쳐\s*볼?\s*점)\s*[:：]\s*/g, (_match, label) => {
      const cleanLabel = label.replace(/\s+/g, '').replace('고쳐볼점', '고쳐볼 점').replace('잘한점', '잘한 점');
      return `\n• ${cleanLabel}: `;
    })
    .replace(/[ \t]+([•●▪◦])\s*/g, '\n$1 ')
    // "문제 상황 설명 : • 잘한 점"처럼 붙은 기준 제목을 독립된 줄로 만듭니다.
    .replace(
      /(^|\n)[ \t]*([^\n:：•●▪◦]{1,50}?)[ \t]*[:：][ \t]*(?=\n•\s*(?:잘한 점|고쳐볼 점))/g,
      (_match, prefix, heading) => `${prefix}${heading.trim()}\n`
    )
    // 원래 줄바꿈과 새로 넣은 줄바꿈이 겹쳐도 글머리표 사이는 한 줄만 둡니다.
    .replace(/\n{2,}(?=•)/g, '\n')
    .replace(/(^|\n)([^\n•●▪◦]{1,50})\n(?=•\s*(?:잘한 점|고쳐볼 점))/g, '$1$2\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

/**
 * 구글 독스에서 Brisk Teaching으로 삽입된 표(Table)/첨삭 문단과 댓글(Comment)을 자동으로 읽어옵니다.
 */
export async function pullBriskFeedbackFromGoogleDoc(accessToken, docId, studentCurrentText = '', { strictComments = false } = {}) {
  if (!accessToken || !docId || String(docId).startsWith('DEMO_')) {
    return null;
  }

  const doc = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${docId}`,
    accessToken
  );

  const studentLines = new Set(
    String(studentCurrentText || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  );

  const readStructuralElements = (elements) => {
    let text = '';
    (elements || []).forEach((el) => {
      if (el.paragraph) {
        (el.paragraph.elements || []).forEach((pe) => {
          if (pe.textRun?.content) {
            text += pe.textRun.content;
          }
        });
      }
    });
    return text.trim();
  };

  const extraBlocks = [];
  let markerPassed = false;

  (doc.body?.content || []).forEach((el) => {
    if (el.table) {
      const matrix = (el.table.tableRows || []).map((row) =>
        (row.tableCells || []).map((cell) => readStructuralElements(cell.content))
      );

      // 케이스 1: Brisk 3열 가로 표 (1행이 [GLOW | GROW | WONDERING], 2행이 각 항목의 본문인 경우)
      if (
        matrix.length >= 2 &&
        matrix[0].length >= 2 &&
        matrix[0].some((cell) => Boolean(translateBriskHeader(cell)))
      ) {
        const headers = matrix[0];
        const colSections = [];
        headers.forEach((rawH, colIdx) => {
          const korHeader = translateBriskHeader(rawH) || `[${rawH.trim()}]`;
          const bodyParts = [];
          for (let r = 1; r < matrix.length; r++) {
            const cellVal = (matrix[r][colIdx] || '').trim();
            if (cellVal) bodyParts.push(cellVal);
          }
          if (bodyParts.length > 0) {
            colSections.push(`${korHeader}\n${bodyParts.join('\n')}`);
          }
        });
        if (colSections.length > 0) {
          extraBlocks.push(colSections.join('\n\n'));
          return;
        }
      }

      // 케이스 2: 행별 표 (좌측 셀이 GLOW/GROW/WONDERING이고 우측 셀이 내용인 경우 또는 일반 표)
      const tableRows = [];
      matrix.forEach((rowCells) => {
        const nonEmpty = rowCells.map((c) => c.trim()).filter(Boolean);
        if (nonEmpty.length === 0) return;

        if (nonEmpty.length === 1) {
          const korH = translateBriskHeader(nonEmpty[0]);
          tableRows.push(korH || translateBriskTextToKorean(nonEmpty[0]));
        } else {
          const firstKorH = translateBriskHeader(nonEmpty[0]);
          if (firstKorH) {
            tableRows.push(`${firstKorH}\n${nonEmpty.slice(1).join('\n')}`);
          } else {
            tableRows.push(translateBriskTextToKorean(nonEmpty.join(' : ')));
          }
        }
      });

      if (tableRows.length > 0) {
        extraBlocks.push(tableRows.join('\n\n'));
      }
    } else if (el.paragraph) {
      const pText = readStructuralElements([el]);
      if (!pText) return;
      if (pText.includes(STUDENT_TEXT_MARKER)) {
        markerPassed = true;
        return;
      }
      if (!markerPassed && !studentLines.has(pText)) {
        const korH = translateBriskHeader(pText);
        extraBlocks.push(korH || translateBriskTextToKorean(pText));
      }
    }
  });

  // 구글 독스 댓글(부분 첨삭) 읽기
  let pulledComments = [];
  try {
    const commentsRes = await googleFetch(
      `https://www.googleapis.com/drive/v3/files/${docId}/comments?fields=comments(id,content,quotedFileContent,resolved,deleted)`,
      accessToken
    );
    pulledComments = (commentsRes?.comments || [])
      .filter((c) => !c.deleted && !c.resolved && c.content)
      .map((c, idx) => ({
        id: c.id || `DOC_C_${Date.now()}_${idx}`,
        quote: c.quotedFileContent?.value || '',
        comment: translateBriskTextToKorean(c.content)
      }));
  } catch (e) {
    if (strictComments) throw e;
    console.warn('구글 독스 댓글 읽기 참고:', e);
  }

  return {
    pulledNote: translateBriskTextToKorean(extraBlocks.join('\n\n')),
    pulledComments
  };
}

/**
 * 학급 또는 글쓰기 주제 삭제 시, 교사가 '관련 자료 모두 삭제'를 선택한 경우
 * 구글 드라이브에 생성된 관련 학생 구글 독스(또는 파일)를 삭제(휴지통 이동/영구 삭제)합니다.
 */
export async function deleteGoogleDriveFiles(accessToken, fileIds = []) {
  if (!accessToken || !Array.isArray(fileIds) || fileIds.length === 0) {
    return { deletedCount: 0 };
  }

  const validIds = Array.from(
    new Set(
      fileIds
        .map((id) => String(id || '').trim())
        .filter((id) => id && !id.startsWith('DEMO_'))
    )
  );

  let deletedCount = 0;
  for (const fileId of validIds) {
    try {
      await googleFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, accessToken, {
        method: 'PATCH',
        body: JSON.stringify({ trashed: true })
      });
      deletedCount++;
    } catch (e) {
      try {
        await googleFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, accessToken, {
          method: 'DELETE'
        });
        deletedCount++;
      } catch (err) {
        console.warn('구글 드라이브 파일 삭제 참고:', fileId, err);
      }
    }
  }

  return { deletedCount };
}

/**
 * [학생 링크 직결 엔진]
 * 별도의 GAS 웹 앱 수동 배포 없이도, 교사가 로그인해 생성한 구글 시트(spreadsheetId)와
 * 자동 연동하여 학생 입장(studentBootstrap, studentLogin, studentRefresh)과
 * 글 제출(submitStage), 질문 등록(addQuestion)을 처리합니다.
 */
export async function loadPublicStateFromSpreadsheetId(spreadsheetId) {
  if (!spreadsheetId) return null;
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&headers=0&sheet=AppState&_t=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('학급 시트에 연결할 수 없습니다.');
  const text = await res.text();
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);?/);
  if (!match || !match[1]) throw new Error('학급 시트 응답을 읽을 수 없습니다.');
  const json = JSON.parse(match[1]);
  const rows = json?.table?.rows || [];
  const rawMap = {};
  rows.forEach((r) => {
    const k = r?.c?.[0]?.v;
    const v = r?.c?.[1]?.v;
    if (k && v && k !== 'KEY') {
      const m = String(k).match(/^(.+):(\d+)$/);
      const key = m ? m[1] : String(k);
      const idx = m ? Number(m[2]) : 0;
      if (!rawMap[key]) rawMap[key] = [];
      rawMap[key][idx] = String(v);
    }
  });
  const map = {};
  Object.entries(rawMap).forEach(([key, chunks]) => {
    const joined = chunks.join('');
    try {
      map[key] = JSON.parse(joined);
    } catch {
      map[key] = joined;
    }
  });

  // 교사 브릿지 토큰이 유효하면 Sheets API로 캐시 없는 최신 상태를 즉시 조회합니다.
  const bridgeToken = map?.config?.teacherBridgeToken;
  if (bridgeToken) {
    try {
      const fresh = await loadFullStateFromSpreadsheet(bridgeToken, spreadsheetId);
      if (fresh && (fresh.classes || fresh.students)) return fresh;
    } catch {
      /* 토큰 만료 시 공개 조회 데이터 사용 */
    }
  }
  return map;
}

function encodeStudentSessionToken(sessionObj) {
  return btoa(encodeURIComponent(JSON.stringify(sessionObj)));
}

function decodeStudentSessionToken(token) {
  try {
    return JSON.parse(decodeURIComponent(atob(String(token || '').trim())));
  } catch {
    return null;
  }
}

export async function callDirectSheetStudentApi(payload = {}) {
  const action = payload.action || 'ping';
  let spreadsheetId = String(payload.spreadsheetId || '').trim();
  const decodedSession = payload.sessionToken
    ? decodeStudentSessionToken(payload.sessionToken)
    : null;
  if (!spreadsheetId && decodedSession?.spreadsheetId) {
    spreadsheetId = decodedSession.spreadsheetId;
  }
  if (!spreadsheetId) {
    return { ok: false, error: '학급 시트 주소가 없습니다.' };
  }

  try {
    const rawState = await loadPublicStateFromSpreadsheetId(spreadsheetId);
    const state = {
      classes: Array.isArray(rawState?.classes) ? rawState.classes : [],
      topics: Array.isArray(rawState?.topics) ? rawState.topics : [],
      students: Array.isArray(rawState?.students) ? rawState.students : [],
      questions: Array.isArray(rawState?.questions) ? rawState.questions : [],
      config: rawState?.config && typeof rawState.config === 'object' ? rawState.config : {}
    };

    const legacyClassId = state.classes[0]?.id || state.config.activeClassId || '';
    const belongsToClass = (record, classId) =>
      String(record?.classId || legacyClassId) === String(classId);
    const findClass = (classId) =>
      state.classes.find((c) => String(c.id) === String(classId));
    const topicsForClass = (classId) =>
      state.topics.filter((t) => belongsToClass(t, classId));
    const findActiveTopic = (classId) => {
      const list = topicsForClass(classId);
      return list.find((t) => t.isActive) || list[0] || null;
    };
    const publicConfig = (classId) => {
      const cls = findClass(classId);
      const activeTopic = findActiveTopic(classId);
      return {
        className: cls?.className || state.config.className || '우리 반',
        activeClassId: classId,
        activeTopicId: activeTopic?.id || state.config.activeTopicId || '',
        assignmentTitle: activeTopic?.title || '',
        assignmentPrompt: activeTopic?.prompt || '',
        classLocked: Boolean(activeTopic?.classLocked)
      };
    };
    const questionsForStudent = (classId, number) =>
      state.questions.filter(
        (q) =>
          belongsToClass(q, classId) &&
          String(q.number).trim() === String(number).trim()
      );
    const validateAccess = (classId, accessKey) => {
      const expected = state.config.classAccessKeys?.[classId];
      if (expected && accessKey && String(expected) !== String(accessKey)) {
        throw new Error('유효하지 않은 학급 입장 링크입니다. 선생님께 새 QR을 받아 주세요.');
      }
      if (!findClass(classId) && state.classes.length > 0) {
        throw new Error('학급을 찾을 수 없습니다.');
      }
    };

    if (action === 'ping') {
      return { ok: true, mode: 'direct-sheet' };
    }

    if (action === 'studentBootstrap') {
      const classId = payload.classId || legacyClassId;
      validateAccess(classId, payload.accessKey);
      return {
        ok: true,
        topics: topicsForClass(classId),
        config: publicConfig(classId)
      };
    }

    if (action === 'studentLogin') {
      const classId = payload.classId || legacyClassId;
      validateAccess(classId, payload.accessKey);
      const number = String(payload.number || '').trim();
      const name = String(payload.name || '').trim();
      const student = state.students.find(
        (s) =>
          belongsToClass(s, classId) &&
          String(s.number).trim() === number &&
          String(s.name).trim() === name
      );
      if (!student) {
        return { ok: false, error: '번호와 이름을 다시 확인해 주세요.' };
      }
      const sessionToken = encodeStudentSessionToken({
        spreadsheetId,
        classId,
        accessKey: payload.accessKey || '',
        number: String(student.number).trim(),
        name: String(student.name).trim()
      });
      return {
        ok: true,
        sessionToken,
        student: { ...student, classId: student.classId || classId },
        questions: questionsForStudent(classId, student.number),
        topics: topicsForClass(classId),
        config: publicConfig(classId)
      };
    }

    if (!decodedSession) {
      return {
        ok: false,
        error: '학생 입장 시간이 만료되었습니다. 번호와 이름으로 다시 들어가 주세요.'
      };
    }
    const { classId, accessKey, number, name } = decodedSession;
    validateAccess(classId, accessKey);

    if (action === 'studentRefresh') {
      const student = state.students.find(
        (s) =>
          belongsToClass(s, classId) &&
          String(s.number).trim() === String(number).trim()
      );
      if (!student) {
        return { ok: false, error: '학생 정보를 찾을 수 없습니다.' };
      }
      return {
        ok: true,
        student,
        questions: questionsForStudent(classId, number),
        topics: topicsForClass(classId),
        config: publicConfig(classId)
      };
    }

    const bridgeToken = state.config?.teacherBridgeToken;

    if (action === 'unsubmitStage') {
      const studentIdx = state.students.findIndex(
        (s) =>
          belongsToClass(s, classId) &&
          String(s.number).trim() === String(number).trim()
      );
      if (studentIdx < 0) {
        return { ok: false, error: '학생 정보를 찾을 수 없습니다.' };
      }

      const student = { ...state.students[studentIdx] };
      const activeTopic = findActiveTopic(classId);
      const topic =
        state.topics.find(
          (item) =>
            String(item.id) === String(payload.topicId) && belongsToClass(item, classId)
        ) || activeTopic;
      if (!topic) return { ok: false, error: '글쓰기 주제를 찾을 수 없습니다.' };
      if (topic.classLocked) {
        return { ok: false, error: '선생님이 학급 글쓰기를 마감하여 회수할 수 없습니다.' };
      }

      const isActive = !activeTopic || String(topic.id) === String(activeTopic.id);
      const topicRecord = isActive ? student : student.historyByTopic?.[topic.id] || {};
      if (topicRecord.status === 'FINAL_COMPLETED') {
        return {
          ok: false,
          error: '최종 완성된 글은 회수할 수 없습니다. 이어서 더 고쳐 쓰기를 이용해 주세요.'
        };
      }
      if (getStoredDraftHistory(topicRecord).length === 0) {
        return { ok: false, error: '아직 회수할 제출 글이 없습니다.' };
      }

      const nextStatus =
        topicRecord.status === 'STAGE_1_SUBMITTED' ? 'STAGE_1_WRITING' : 'FEEDBACK_DONE';
      const recalledRecord = {
        ...topicRecord,
        locked: false,
        recalled: true,
        status: nextStatus,
        updatedAtIso: new Date().toISOString()
      };

      if (isActive) {
        Object.assign(student, recalledRecord, { classId });
      } else {
        student.historyByTopic = {
          ...(student.historyByTopic || {}),
          [topic.id]: recalledRecord
        };
        student.updatedAtIso = recalledRecord.updatedAtIso;
      }
      state.students[studentIdx] = student;

      if (!bridgeToken) {
        return {
          ok: false,
          error: '선생님 화면이 연결되면 제출을 회수할 수 있습니다. 선생님께 쓰담 화면을 한 번 열어 달라고 알려 주세요.'
        };
      }

      await saveFullStateToSpreadsheet(bridgeToken, spreadsheetId, {
        classes: state.classes,
        topics: state.topics,
        students: state.students,
        questions: state.questions,
        config: state.config,
        replaceRemoteRecords: true
      });

      return { ok: true, student };
    }

    if (action === 'submitStage') {
      const studentIdx = state.students.findIndex(
        (s) =>
          belongsToClass(s, classId) &&
          String(s.number).trim() === String(number).trim()
      );
      if (studentIdx < 0) {
        return { ok: false, error: '학생 정보를 찾을 수 없습니다.' };
      }
      const student = { ...state.students[studentIdx] };
      const activeTopic = findActiveTopic(classId);
      const topic =
        state.topics.find(
          (t) => String(t.id) === String(payload.topicId) && belongsToClass(t, classId)
        ) || activeTopic;
      const isActive = !topic || !activeTopic || String(topic.id) === String(activeTopic.id);
      const existingTopicRecord = topic ? student.historyByTopic?.[topic.id] : null;
      const isStudentLocked = isActive ? student.locked : Boolean(existingTopicRecord?.locked);
      const submissionRecord = isActive ? student : existingTopicRecord || {};
      const isCompletedRevision =
        Boolean(payload.allowRevision) && submissionRecord.status === 'FINAL_COMPLETED';
      if (topic?.classLocked && !isCompletedRevision) {
        return {
          ok: false,
          error: '선생님이 학급 글쓰기를 마감했습니다. 선생님께 문의해 주세요.'
        };
      }
      if (
        isStudentLocked &&
        !payload.allowRevision &&
        !payload.isRecallUpdate &&
        !submissionRecord.recalled
      ) {
        return {
          ok: false,
          error: '현재는 제출이 마감되어 있습니다. 선생님께 문의해 주세요.'
        };
      }

      const text = String(payload.text || '');
      const pieceTitle = String(payload.pieceTitle || '').trim();
      if (!pieceTitle) return { ok: false, error: '작품 제목을 먼저 지어 주세요.' };
      if (pieceTitle.length > 50) {
        return { ok: false, error: '작품 제목은 50자 이내로 작성해 주세요.' };
      }
      if (!text.trim()) return { ok: false, error: '글을 먼저 작성해 주세요.' };
      if (text.length > 30000) {
        return { ok: false, error: '글은 30,000자 이내로 작성해 주세요.' };
      }

      const now = new Date().toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit'
      });
      const nowIso = new Date().toISOString();
      const isRecallUpdate = Boolean(payload.isRecallUpdate || submissionRecord.recalled);
      const storedRoundCount = getStoredDraftHistory(submissionRecord).length;
      const stage = Math.max(1, storedRoundCount + (isRecallUpdate ? 0 : 1));
      const submittedRecord = appendStoredDraftRevision(
        submissionRecord,
        text,
        pieceTitle,
        `오늘 ${now}`,
        nowIso,
        { isRecallUpdate }
      );

      if (isActive) {
        Object.assign(student, submittedRecord, { classId });
      } else if (topic) {
        student.historyByTopic = {
          ...(student.historyByTopic || {}),
          [topic.id]: submittedRecord
        };
        student.updatedAtIso = nowIso;
      }

      state.students[studentIdx] = student;

      if (!bridgeToken) {
        return {
          ok: false,
          error: '선생님 화면이 연결되면 곧바로 제출할 수 있습니다. 선생님께 쓰담 화면을 한 번 열어 달라고 알려 주세요.'
        };
      }

      await saveFullStateToSpreadsheet(bridgeToken, spreadsheetId, {
        classes: state.classes,
        topics: state.topics,
        students: state.students,
        questions: state.questions,
        config: state.config,
        replaceRemoteRecords: true
      });

      if (student.docId && !String(student.docId).startsWith('DEMO_')) {
        pushStudentDraftToDoc(bridgeToken, student.docId, {
          className: publicConfig(classId).className,
          topicTitle: topic?.title || publicConfig(classId).assignmentTitle || '글쓰기',
          student,
          stage,
          text
        }).catch((e) => console.warn('학생 제출 독스 자동 반영 참고:', e));
      }

      return { ok: true, student };
    }

    if (action === 'addQuestion') {
      const questionText = String(payload.question || '').trim();
      if (!questionText) return { ok: false, error: '질문 내용을 적어 주세요.' };
      if (questionText.length > 1000) {
        return { ok: false, error: '질문은 1,000자 이내로 작성해 주세요.' };
      }
      const requestId = String(payload.requestId || '').trim().slice(0, 120);
      const existingQuestion = requestId
        ? state.questions.find(
            (question) =>
              String(question.id) === requestId &&
              belongsToClass(question, classId) &&
              String(question.number).trim() === String(number).trim()
          )
        : null;
      if (existingQuestion) {
        return {
          ok: true,
          questions: questionsForStudent(classId, number)
        };
      }
      const nowIso = new Date().toISOString();
      const newQ = {
        id: requestId || `Q_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        classId,
        topicId: String(payload.topicId || ''),
        number,
        name,
        source: '학생 질문',
        quote: String(payload.quote || '').slice(0, 1000),
        question: questionText,
        reply: '',
        resolved: false,
        createdAt: '방금 전',
        createdAtIso: nowIso,
        updatedAtIso: nowIso
      };
      state.questions.unshift(newQ);

      if (!bridgeToken) {
        return {
          ok: false,
          error: '선생님 화면이 연결되면 곧바로 질문할 수 있습니다. 선생님께 쓰담 화면을 한 번 열어 달라고 알려 주세요.'
        };
      }

      await saveFullStateToSpreadsheet(bridgeToken, spreadsheetId, {
        classes: state.classes,
        topics: state.topics,
        students: state.students,
        questions: state.questions,
        config: state.config,
        replaceRemoteRecords: true
      });

      return {
        ok: true,
        questions: questionsForStudent(classId, number)
      };
    }

    return { ok: false, error: '지원하지 않는 요청입니다.' };
  } catch (err) {
    let userMsg = err?.message || '학생 데이터를 불러오는 중 문제가 발생했습니다.';
    if (err?.status === 429 || /429|요청 한도|quota|Too Many Requests/i.test(userMsg)) {
      userMsg = '친구들이 동시에 제출하고 있어요! 5~10초 뒤 다시 [제출하기]를 눌러주세요.';
    } else if (err?.status === 401 || /401|인증 만료|invalid authentication|credentials|만료/i.test(userMsg)) {
      userMsg = '선생님의 연결 권한이 만료되었습니다. 선생님께 쓰담 화면을 새로고침(F5)해 달라고 말씀해 주세요.';
    }
    return {
      ok: false,
      error: userMsg
    };
  }
}

