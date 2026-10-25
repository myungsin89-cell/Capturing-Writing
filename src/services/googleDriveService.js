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
export async function loginTeacherWithGoogle(clientId) {
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
          try {
            const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${accessToken}` }
            });
            const profile = profileRes.ok ? await profileRes.json() : {};
            resolve({
              accessToken,
              expiresAt: Date.now() + (Number(tokenResponse.expires_in || 3500) * 1000),
              user: {
                name: profile.name || '선생님',
                email: profile.email || '',
                picture: profile.picture || ''
              }
            });
          } catch {
            resolve({
              accessToken,
              expiresAt: Date.now() + 3500 * 1000,
              user: { name: '선생님', email: '' }
            });
          }
        }
      });

      tokenClient.requestAccessToken({ prompt: 'select_account' });
    } catch (err) {
      reject(err);
    }
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
    throw new Error(`Google API 오류 (${res.status}): ${errText}`);
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
    await removePublicLinkPermissions(accessToken, existing.id);
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

  // 생성된 시트를 [쓰담] 폴더 안으로 이동합니다.
  // 학생 조회·제출은 GAS가 교사 권한으로 중계하므로 시트 자체는 비공개로 유지합니다.
  try {
    await googleFetch(
      `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?addParents=${folderId}&fields=id`,
      accessToken,
      { method: 'PATCH', body: JSON.stringify({}) }
    );
  } catch (e) {
    console.warn('시트 폴더 이동 참고:', e);
  }

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
  const rows = [['KEY', 'JSON_VALUE']];
  const chunkSize = 45000;
  Object.entries(state).forEach(([key, value]) => {
    const serialized = JSON.stringify(value);
    if (serialized.length <= chunkSize) {
      rows.push([key, serialized]);
      return;
    }
    for (let offset = 0, index = 0; offset < serialized.length; offset += chunkSize, index++) {
      rows.push([`${key}:${index}`, serialized.slice(offset, offset + chunkSize)]);
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

function mergeQuestions(localQuestions = [], remoteQuestions = []) {
  const merged = new Map(remoteQuestions.map((question) => [String(question.id), question]));
  localQuestions.forEach((question) => {
    const previous = merged.get(String(question.id));
    const previousTime = Date.parse(previous?.updatedAtIso || previous?.createdAtIso || '') || 0;
    const nextTime = Date.parse(question.updatedAtIso || question.createdAtIso || '') || 0;
    if (!previous || nextTime >= previousTime) merged.set(String(question.id), question);
  });
  return Array.from(merged.values());
}

/**
 * 구글 시트에 전체 학급/주제/학생/질문 데이터를 깔끔하게 저장합니다.
 * (교사가 시트를 직접 열었을 때도 보기 쉽도록 Students 시트와 AppState 시트를 함께 업데이트합니다)
 */
export async function saveFullStateToSpreadsheet(
  accessToken,
  spreadsheetId,
  { classes, topics, students, questions, config }
) {
  if (!accessToken || !spreadsheetId) return;

  let safeStudents = students || [];
  let safeQuestions = questions || [];
  try {
    const remote = await loadFullStateFromSpreadsheet(accessToken, spreadsheetId);
    safeStudents = mergeNewerRemoteRecords(safeStudents, remote.students || []);
    safeQuestions = mergeQuestions(safeQuestions, remote.questions || []);
  } catch (e) {
    console.warn('저장 전 원격 변경 병합 참고:', e);
  }

  const stateValues = buildChunkedStateValues({
    classes: classes || [],
    topics: topics || [],
    students: safeStudents,
    questions: safeQuestions,
    config: config || {},
    updatedAt: new Date().toISOString()
  });
  if (stateValues.length > 100) {
    throw new Error('학급 데이터가 너무 커졌습니다. 자료 보관 구조 확장이 필요합니다.');
  }

  const studentRows = [
    ['출석번호', '이름', '상태', '1차 글', '2차 글', '3차 글', '4차 글', '선생님 종합 첨삭', '구글 독스 링크', '최근 수정']
  ];
  safeStudents.forEach((st) => {
    studentRows.push([
      String(st.number || ''),
      String(st.name || ''),
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

  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: [
          { range: 'AppState!A1', values: stateValues },
          { range: 'Students!A1', values: studentRows }
        ]
      })
    }
  );

  const firstUnusedRow = stateValues.length + 1;
  if (firstUnusedRow <= 100) {
    await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/AppState!A${firstUnusedRow}:B100:clear`,
      accessToken,
      { method: 'POST', body: JSON.stringify({}) }
    );
  }
}

/**
 * 학생별 Google Docs 자동 생성 (또는 기존 독스 초기화) 및 학생 최신 본문 동기화
 */
export async function ensureAndSyncStudentGoogleDoc(
  accessToken,
  { student, className, topicTitle, folderId }
) {
  if (!accessToken || !student) return null;

  const targetFolderId = folderId || (await ensureRootFolder(accessToken));
  const latestText =
    student.draft4 || student.draft3 || student.draft2 || student.draft1 || '';

  let docId = student.docId;
  let docUrl = student.docUrl;

  // 데모 ID이거나 아직 실제 독스가 없으면 교사의 구글 드라이브에 자동 생성!
  if (!docId || String(docId).startsWith('DEMO_')) {
    const docTitle = `[${className || '쓰담'}] ${student.number}번 ${student.name} - ${
      topicTitle || '글쓰기 공책'
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

  // 학생의 최신 글로 독스 본문을 깨끗하게 세팅 (이전 Brisk 표 제거 포함)
  await resetGoogleDocWithStudentText(accessToken, docId, latestText);

  return { docId, docUrl };
}

/**
 * 구글 독스 안의 이전 Brisk 첨삭 표/문단/댓글을 지우고 학생의 순수 본문만 남깁니다.
 */
export async function resetGoogleDocWithStudentText(accessToken, docId, studentText) {
  if (!accessToken || !docId || String(docId).startsWith('DEMO_')) return;

  try {
    const doc = await googleFetch(
      `https://docs.googleapis.com/v1/documents/${docId}`,
      accessToken
    );
    const content = doc.body?.content || [];
    const lastElem = content[content.length - 1];
    const endIndex = (lastElem?.endIndex || 2) - 1;

    const requests = [];
    if (endIndex > 1) {
      requests.push({
        deleteContentRange: {
          range: { startIndex: 1, endIndex }
        }
      });
    }

    const cleanBody = `${STUDENT_TEXT_MARKER}\n${String(studentText || '').replace(/\r\n/g, '\n')}\n`;
    requests.push({
      insertText: {
        location: { index: 1 },
        text: cleanBody
      }
    });

    await googleFetch(
      `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ requests })
      }
    );

    // 이전 차수 댓글 정리
    const commentsRes = await googleFetch(
      `https://www.googleapis.com/drive/v3/files/${docId}/comments?fields=comments(id,deleted)`,
      accessToken
    );
    const comments = commentsRes?.comments || [];
    for (const c of comments) {
      if (!c.deleted) {
        try {
          await googleFetch(
            `https://www.googleapis.com/drive/v3/files/${docId}/comments/${c.id}`,
            accessToken,
            { method: 'DELETE' }
          );
        } catch {
          // ignore
        }
      }
    }
  } catch (e) {
    console.warn('구글 독스 본문 동기화 참고:', e);
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
  return String(rawText)
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
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 구글 독스에서 Brisk Teaching으로 삽입된 표(Table)/첨삭 문단과 댓글(Comment)을 자동으로 읽어옵니다.
 */
export async function pullBriskFeedbackFromGoogleDoc(accessToken, docId, studentCurrentText = '') {
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
    console.warn('구글 독스 댓글 읽기 참고:', e);
  }

  return {
    pulledNote: translateBriskTextToKorean(extraBlocks.join('\n\n')),
    pulledComments
  };
}
