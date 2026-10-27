/**
 * ============================================================================
 * 쓰담 (글쓰기 스튜디오) - Google Apps Script 백엔드
 * ============================================================================
 * [핵심 작동 원리]
 * 1. 학생이 쓰담 앱에서 글을 제출하면, 해당 학생 전용 구글 독스([번호 이름] 주제명)가
 *    자동으로 생성(또는 업데이트)되며 학생이 쓴 글이 문단 그대로 독스에 기록됩니다.
 * 2. 교사가 [학생 독스 열기]를 눌러 구글 독스에서 Brisk Teaching으로 첨삭을 생성하고
 *    문서에 삽입(Insert)하거나 댓글을 단 뒤, 쓰담 앱으로 돌아와 [독스에서 첨삭 자동 가져오기]를 누르면
 *    독스에 추가된 Brisk 표(Glow & Grow), 추가 문단, 밑줄 댓글을 자동으로 추출해 앱에 채워 넣습니다!
 */

const FOLDER_NAME = '쓰담_글쓰기스튜디오_학급문서';
const STUDENT_TEXT_MARKER = '━━━ [학생 작성 본문] ━━━';

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const lock = LockService.getScriptLock();
  let lockAcquired = false;

  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    const action = payload.action || 'ping';
    const mutatingActions = [
      'getAllData',
      'createStudentDocs',
      'submitStage',
      'unsubmitStage',
      'pullFeedbackFromDoc',
      'updateStudentStatus',
      'batchDeadlineControl',
      'addQuestion',
      'replyQuestion'
    ];
    if (mutatingActions.indexOf(action) >= 0) {
      lockAcquired = lock.tryLock(10000);
      if (!lockAcquired) {
        return ContentService.createTextOutput(
          JSON.stringify({ ok: false, error: '요청이 많습니다. 잠시 뒤 다시 시도해 주세요.' })
        ).setMimeType(ContentService.MimeType.JSON);
      }
    }
    let result = {};

    switch (action) {
      case 'ping':
        result = { ok: true, service: 'sseudam-student-api', version: 2 };
        break;
      case 'getAllData':
        result = initSheetsAndGetData();
        break;
      case 'studentBootstrap':
        result = studentBootstrapV2(payload);
        break;
      case 'studentRefresh':
        result = studentRefreshV2(payload);
        break;
      case 'createStudentDocs':
        result = createStudentDocs(payload);
        break;
      case 'studentLogin':
        result = payload.spreadsheetId && payload.classId
          ? studentLoginV2(payload)
          : studentLogin(payload);
        break;
      case 'submitStage':
        result = payload.sessionToken ? submitStageV2(payload) : submitStage(payload);
        break;
      case 'unsubmitStage':
        result = payload.sessionToken ? unsubmitStageV2(payload) : { ok: true };
        break;
      case 'pullFeedbackFromDoc':
        result = pullFeedbackFromDoc(payload);
        break;
      case 'updateStudentStatus':
        result = updateStudentStatus(payload);
        break;
      case 'batchDeadlineControl':
        result = batchDeadlineControl(payload);
        break;
      case 'addQuestion':
        result = payload.sessionToken ? addQuestionV2(payload) : addQuestion(payload);
        break;
      case 'replyQuestion':
        result = replyQuestion(payload);
        break;
      default:
        result = { ok: false, error: '알 수 없는 요청입니다: ' + action };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: err.message || '요청을 처리하지 못했습니다.' })
    ).setMimeType(ContentService.MimeType.JSON);
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

function getOrCreateClassFolder() {
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(FOLDER_NAME);
}

/**
 * [자동 청소 헬퍼] 독스에 남아있는 이전 차수 Brisk 표(Insert), 추가 문단, 옛날 댓글을
 * 교사가 손대지 않아도 100% 깨끗하게 지우고 작품 제목·이름·학생 본문만 남깁니다.
 */
function resetDocWithCleanStudentText_(docId, studentText, pieceTitle, authorName) {
  if (!docId || String(docId).startsWith('DEMO_')) return;
  try {
    const doc = DocumentApp.openById(docId);
    const body = doc.getBody();

    // 문서 맨 끝에 표(Table)가 있으면 body.clear()가 에러를 낼 수 있으므로 빈 문단을 먼저 추가 후 전체 삭제
    body.appendParagraph('');
    while (body.getTables().length > 0) {
      body.getTables()[0].removeFromParent();
    }
    body.clear();

    const marker = body.appendParagraph(STUDENT_TEXT_MARKER);
    marker.editAsText().setFontSize(1).setForegroundColor('#ffffff');
    const title = body.appendParagraph(String(pieceTitle || '').trim() || '제목 없음');
    title.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    title.editAsText().setBold(true).setFontSize(18).setFontFamily('Noto Serif KR');
    const author = body.appendParagraph(String(authorName || '').trim());
    author.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
    author.editAsText().setBold(true).setFontSize(14).setFontFamily('Noto Serif KR');
    body.appendParagraph('');
    const paragraphs = String(studentText || '').replace(/\r\n/g, '\n').split('\n');
    paragraphs.forEach(p => {
      const paragraph = body.appendParagraph(p);
      if (p) paragraph.editAsText().setFontSize(14).setFontFamily('Noto Serif KR');
    });
    doc.saveAndClose();

    // 이전 차수에 달렸던 독스 댓글도 함께 정리 (2차 첨삭 시 1차 댓글과 섞이지 않도록)
    if (typeof Drive !== 'undefined' && Drive.Comments) {
      const res = Drive.Comments.list(docId, { fields: 'comments(id)' });
      const comments = (res && res.comments) || [];
      comments.forEach(c => {
        try {
          Drive.Comments.remove(docId, c.id);
        } catch (ce) {}
      });
    }
  } catch (e) {}
}

// ============================================================================
// 학생 무로그인 API v2
// - 시트는 비공개로 유지하고, 이 웹 앱이 교사 권한으로 필요한 학생 데이터만 중계합니다.
// - 학급 QR 비밀 키로 첫 입장을 확인한 뒤 6시간짜리 임시 세션을 발급합니다.
// ============================================================================

function openAppSpreadsheet_(spreadsheetId) {
  const cleanId = String(spreadsheetId || '').trim();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(cleanId)) {
    throw new Error('올바른 쓰담 데이터 시트가 아닙니다.');
  }
  return SpreadsheetApp.openById(cleanId);
}

function readAppStateV2_(spreadsheetId) {
  const ss = openAppSpreadsheet_(spreadsheetId);
  const sheet = ss.getSheetByName('AppState');
  if (!sheet) throw new Error('AppState 시트를 찾을 수 없습니다.');

  const lastRow = Math.max(1, Math.min(sheet.getLastRow(), 100));
  const rows = sheet.getRange(1, 1, lastRow, 2).getValues();
  const chunksByKey = {};
  rows.forEach(function(row) {
    const rawKey = String(row[0] || '');
    if (!rawKey || rawKey === 'KEY' || row[1] === '') return;
    const match = rawKey.match(/^(.+):(\d+)$/);
    const key = match ? match[1] : rawKey;
    const index = match ? Number(match[2]) : 0;
    if (!chunksByKey[key]) chunksByKey[key] = [];
    chunksByKey[key][index] = String(row[1]);
  });

  const state = {};
  Object.keys(chunksByKey).forEach(function(key) {
    const raw = chunksByKey[key].join('');
    try {
      state[key] = JSON.parse(raw);
    } catch (e) {
      state[key] = raw;
    }
  });
  state.classes = Array.isArray(state.classes) ? state.classes : [];
  state.topics = Array.isArray(state.topics) ? state.topics : [];
  state.students = Array.isArray(state.students) ? state.students : [];
  state.questions = Array.isArray(state.questions) ? state.questions : [];
  state.config = state.config || {};
  return { ss: ss, sheet: sheet, state: state };
}

function buildChunkedStateRowsV2_(state) {
  const rows = [['KEY', 'JSON_VALUE']];
  const chunkSize = 45000;
  ['classes', 'topics', 'students', 'questions', 'config', 'updatedAt'].forEach(function(key) {
    const serialized = JSON.stringify(state[key] === undefined ? null : state[key]);
    if (serialized.length <= chunkSize) {
      rows.push([key, serialized]);
      return;
    }
    for (let offset = 0, index = 0; offset < serialized.length; offset += chunkSize, index++) {
      rows.push([key + ':' + index, serialized.slice(offset, offset + chunkSize)]);
    }
  });
  if (rows.length > 100) throw new Error('학급 데이터가 너무 커졌습니다. 자료 보관 구조를 확장해야 합니다.');
  return rows;
}

function writeAppStateV2_(context) {
  const state = context.state;
  state.updatedAt = new Date().toISOString();
  const rows = buildChunkedStateRowsV2_(state);
  context.sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  if (rows.length < 100) {
    context.sheet.getRange(rows.length + 1, 1, 100 - rows.length, 2).clearContent();
  }
}

function legacyClassIdV2_(state) {
  return (state.classes[0] && state.classes[0].id) || state.config.activeClassId || '';
}

function belongsToClassV2_(record, classId, state) {
  return String(record.classId || legacyClassIdV2_(state)) === String(classId);
}

function findClassV2_(state, classId) {
  return state.classes.find(function(item) { return String(item.id) === String(classId); });
}

function findActiveTopicV2_(state, classId) {
  const classTopics = state.topics.filter(function(topic) {
    return belongsToClassV2_(topic, classId, state);
  });
  return classTopics.find(function(topic) { return topic.isActive; }) || classTopics[0] || null;
}

function validateClassAccessV2_(state, classId, accessKey) {
  const expected = state.config.classAccessKeys && state.config.classAccessKeys[classId];
  if (!expected || String(expected) !== String(accessKey || '')) {
    throw new Error('유효하지 않은 학급 입장 링크입니다. 선생님께 새 QR을 받아 주세요.');
  }
  if (!findClassV2_(state, classId)) throw new Error('학급을 찾을 수 없습니다.');
}

function publicConfigV2_(state, classId) {
  const cls = findClassV2_(state, classId);
  const activeTopic = findActiveTopicV2_(state, classId);
  return {
    className: cls ? cls.className : '우리 반',
    activeClassId: classId,
    activeTopicId: activeTopic ? activeTopic.id : '',
    assignmentTitle: activeTopic ? activeTopic.title : '',
    assignmentPrompt: activeTopic ? activeTopic.prompt : '',
    classLocked: Boolean(activeTopic && activeTopic.classLocked)
  };
}

function topicsForClassV2_(state, classId) {
  return state.topics.filter(function(topic) {
    return belongsToClassV2_(topic, classId, state);
  });
}

function questionsForStudentV2_(state, classId, number) {
  return state.questions.filter(function(question) {
    return belongsToClassV2_(question, classId, state) &&
      String(question.number).trim() === String(number).trim();
  });
}

function createStudentSessionV2_(spreadsheetId, classId, number, name) {
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  CacheService.getScriptCache().put(
    'SSEUDAM_SESSION_' + token,
    JSON.stringify({
      spreadsheetId: spreadsheetId,
      classId: classId,
      number: String(number),
      name: String(name)
    }),
    21600
  );
  return token;
}

function requireStudentSessionV2_(payload) {
  const token = String(payload.sessionToken || '').trim();
  if (!token) throw new Error('학생 입장 시간이 만료되었습니다. 번호와 이름으로 다시 들어가 주세요.');
  const raw = CacheService.getScriptCache().get('SSEUDAM_SESSION_' + token);
  if (!raw) throw new Error('학생 입장 시간이 만료되었습니다. 번호와 이름으로 다시 들어가 주세요.');
  const session = JSON.parse(raw);
  if (payload.spreadsheetId && String(payload.spreadsheetId) !== String(session.spreadsheetId)) {
    throw new Error('학급 정보가 일치하지 않습니다.');
  }
  return session;
}

function studentBootstrapV2(payload) {
  const context = readAppStateV2_(payload.spreadsheetId);
  validateClassAccessV2_(context.state, payload.classId, payload.accessKey);
  return {
    ok: true,
    topics: topicsForClassV2_(context.state, payload.classId),
    config: publicConfigV2_(context.state, payload.classId)
  };
}

function studentLoginV2(payload) {
  const context = readAppStateV2_(payload.spreadsheetId);
  const state = context.state;
  validateClassAccessV2_(state, payload.classId, payload.accessKey);
  const number = String(payload.number || '').trim();
  const name = String(payload.name || '').trim();
  const student = state.students.find(function(item) {
    return belongsToClassV2_(item, payload.classId, state) &&
      String(item.number).trim() === number &&
      String(item.name).trim() === name;
  });
  if (!student) return { ok: false, error: '번호와 이름을 다시 확인해 주세요.' };
  student.classId = student.classId || payload.classId;
  const sessionToken = createStudentSessionV2_(
    payload.spreadsheetId,
    payload.classId,
    student.number,
    student.name
  );
  return {
    ok: true,
    sessionToken: sessionToken,
    student: student,
    questions: questionsForStudentV2_(state, payload.classId, student.number),
    topics: topicsForClassV2_(state, payload.classId),
    config: publicConfigV2_(state, payload.classId)
  };
}

function studentRefreshV2(payload) {
  const session = requireStudentSessionV2_(payload);
  const context = readAppStateV2_(session.spreadsheetId);
  const state = context.state;
  const student = state.students.find(function(item) {
    return belongsToClassV2_(item, session.classId, state) &&
      String(item.number).trim() === String(session.number).trim();
  });
  if (!student) return { ok: false, error: '학생 정보를 찾을 수 없습니다.' };
  return {
    ok: true,
    student: student,
    questions: questionsForStudentV2_(state, session.classId, session.number),
    topics: topicsForClassV2_(state, session.classId),
    config: publicConfigV2_(state, session.classId)
  };
}

function getDraftHistoryV2_(record) {
  record = record || {};
  var isFreshTopic = record.status === 'STAGE_1_WRITING' && !record.recalled &&
    !String(record.pieceTitle || '').trim() &&
    ![record.draft1, record.draft2, record.draft3, record.draft4, record.draft5].some(function(text) {
      return String(text || '').trim();
    });
  if (!isFreshTopic && Array.isArray(record.draftHistory) && record.draftHistory.length > 0) {
    return record.draftHistory.filter(function(draft) {
      return draft && draft.text && String(draft.text).trim();
    });
  }
  var rawDrafts = [record.draft1, record.draft2, record.draft3, record.draft4, record.draft5]
    .filter(function(text) {
      return text && String(text).trim();
    });
  return rawDrafts.map(function(text, index) {
      return {
        round: index + 1,
        label: String(index + 1) + '차 글',
        text: text,
        pieceTitle: record.pieceTitle || '',
        teacherNote: index === rawDrafts.length - 1 ? record.teacherNote || '' : '',
        feedbackItems: index === rawDrafts.length - 1 ? record.feedbackItems || [] : [],
        updatedAt: record.updatedAt || '',
        updatedAtIso: record.updatedAtIso || ''
      };
  });
}

function appendDraftRevisionV2_(record, text, pieceTitle, updatedAt, updatedAtIso, options) {
  record = record || {};
  options = options || {};
  var history = getDraftHistoryV2_(record).slice();

  // 학생이 아직 교사 피드백을 받지 않은 상태에서 회수한 뒤 다시 제출하는 경우:
  // 불필요한 차수 추가 없이 현재 차수를 수정된 내용으로 업데이트
  if (options.isRecallUpdate && history.length > 0) {
    var lastIndex = history.length - 1;
    var currentDraft = history[lastIndex];
    history[lastIndex] = Object.assign({}, currentDraft, {
      text: text,
      pieceTitle: pieceTitle,
      updatedAt: updatedAt,
      updatedAtIso: updatedAtIso
    });
    var round = currentDraft.round || history.length;
    var nextRecord = Object.assign({}, record, {
      status: round === 1 ? 'STAGE_1_SUBMITTED' : 'REVISION_SUBMITTED',
      locked: true,
      pieceTitle: pieceTitle,
      draftHistory: history,
      updatedAt: updatedAt,
      updatedAtIso: updatedAtIso
    });
    delete nextRecord.recalled;
    if (round <= 5) nextRecord['draft' + round] = text;
    return nextRecord;
  }

  if (history.length > 0 && (record.teacherNote || (record.feedbackItems || []).length > 0)) {
    var lastIndex = history.length - 1;
    var previousLast = history[lastIndex];
    history[lastIndex] = Object.assign({}, previousLast, {
      teacherNote: record.teacherNote || previousLast.teacherNote || '',
      feedbackItems: record.feedbackItems || previousLast.feedbackItems || []
    });
  }
  var round = history.length + 1;
  var nextRecord = Object.assign({}, record, {
    status: round === 1 ? 'STAGE_1_SUBMITTED' : 'REVISION_SUBMITTED',
    locked: true,
    pieceTitle: pieceTitle,
    teacherNote: '',
    feedbackItems: [],
    draftHistory: history.concat([{
      round: round,
      label: String(round) + '차 글',
      text: text,
      pieceTitle: pieceTitle,
      teacherNote: '',
      feedbackItems: [],
      updatedAt: updatedAt,
      updatedAtIso: updatedAtIso
    }]),
    updatedAt: updatedAt,
    updatedAtIso: updatedAtIso
  });
  delete nextRecord.recalled;
  if (round <= 5) nextRecord['draft' + round] = text;
  return nextRecord;
}

function submitStageV2(payload) {
  const session = requireStudentSessionV2_(payload);
  const context = readAppStateV2_(session.spreadsheetId);
  const state = context.state;
  const topic = state.topics.find(function(item) {
    return String(item.id) === String(payload.topicId) &&
      belongsToClassV2_(item, session.classId, state);
  });
  if (!topic) return { ok: false, error: '글쓰기 주제를 찾을 수 없습니다.' };

  const studentIndex = state.students.findIndex(function(item) {
    return belongsToClassV2_(item, session.classId, state) &&
      String(item.number).trim() === String(session.number).trim();
  });
  if (studentIndex < 0) return { ok: false, error: '학생 정보를 찾을 수 없습니다.' };

  const student = state.students[studentIndex];
  const activeTopic = findActiveTopicV2_(state, session.classId);
  const isActive = activeTopic && String(activeTopic.id) === String(topic.id);
  const existingTopicRecord = student.historyByTopic && student.historyByTopic[topic.id];
  const isStudentLocked = isActive ? student.locked : Boolean(existingTopicRecord && existingTopicRecord.locked);
  const submissionRecord = isActive ? student : (existingTopicRecord || {});
  
  const isCompletedRevision = Boolean(payload.allowRevision) && submissionRecord.status === 'FINAL_COMPLETED';
  if (topic.classLocked && !isCompletedRevision) {
    return { ok: false, error: '선생님이 학급 글쓰기를 마감했습니다. 선생님께 문의해 주세요.' };
  }
  if (isStudentLocked && !payload.allowRevision && !payload.isRecallUpdate && !submissionRecord.recalled) {
    return { ok: false, error: '현재는 제출이 마감되어 있습니다. 선생님께 문의해 주세요.' };
  }

  const text = String(payload.text || '');
  const pieceTitle = String(payload.pieceTitle || '').trim();
  if (!pieceTitle) return { ok: false, error: '작품 제목을 먼저 지어 주세요.' };
  if (pieceTitle.length > 50) return { ok: false, error: '작품 제목은 50자 이내로 작성해 주세요.' };
  if (!text.trim()) return { ok: false, error: '글을 먼저 작성해 주세요.' };
  if (text.length > 30000) return { ok: false, error: '글은 30,000자 이내로 작성해 주세요.' };

  const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  const nowIso = new Date().toISOString();
  const submittedRecord = appendDraftRevisionV2_(
    submissionRecord,
    text,
    pieceTitle,
    now,
    nowIso,
    { isRecallUpdate: Boolean(payload.isRecallUpdate || submissionRecord.recalled) }
  );
  if (isActive) {
    Object.keys(submittedRecord).forEach(function(key) {
      student[key] = submittedRecord[key];
    });
    student.classId = session.classId;
  } else {
    student.historyByTopic = student.historyByTopic || {};
    student.historyByTopic[topic.id] = submittedRecord;
    student.updatedAtIso = nowIso;
  }

  state.students[studentIndex] = student;
  writeAppStateV2_(context);
  return { ok: true, student: student };
}

function unsubmitStageV2(payload) {
  const session = requireStudentSessionV2_(payload);
  const context = readAppStateV2_(session.spreadsheetId);
  const state = context.state;
  const topic = state.topics.find(function(item) {
    return String(item.id) === String(payload.topicId) &&
      belongsToClassV2_(item, session.classId, state);
  });
  if (!topic) return { ok: false, error: '글쓰기 주제를 찾을 수 없습니다.' };
  if (topic.classLocked) {
    return { ok: false, error: '선생님이 학급 글쓰기를 마감하여 회수할 수 없습니다.' };
  }

  const studentIndex = state.students.findIndex(function(item) {
    return belongsToClassV2_(item, session.classId, state) &&
      String(item.number).trim() === String(session.number).trim();
  });
  if (studentIndex < 0) return { ok: false, error: '학생 정보를 찾을 수 없습니다.' };

  const student = state.students[studentIndex];
  const activeTopic = findActiveTopicV2_(state, session.classId);
  const isActive = activeTopic && String(activeTopic.id) === String(topic.id);
  const nowIso = new Date().toISOString();
  
  if (isActive) {
    student.locked = false;
    student.recalled = true;
    student.updatedAtIso = nowIso;
    if (student.status === 'STAGE_1_SUBMITTED') {
      student.status = 'STAGE_1_WRITING';
    } else if (
      student.status === 'REVISION_SUBMITTED' ||
      student.status === 'STAGE_2_SUBMITTED' ||
      student.status === 'STAGE_3_COMPLETED'
    ) {
      student.status = 'FEEDBACK_DONE';
    }
  } else {
    student.historyByTopic = student.historyByTopic || {};
    const record = student.historyByTopic[topic.id] || {};
    record.locked = false;
    record.recalled = true;
    record.updatedAtIso = nowIso;
    if (record.status === 'STAGE_1_SUBMITTED') {
      record.status = 'STAGE_1_WRITING';
    } else if (
      record.status === 'REVISION_SUBMITTED' ||
      record.status === 'STAGE_2_SUBMITTED' ||
      record.status === 'STAGE_3_COMPLETED'
    ) {
      record.status = 'FEEDBACK_DONE';
    }
    student.historyByTopic[topic.id] = record;
    student.updatedAtIso = nowIso;
  }

  state.students[studentIndex] = student;
  writeAppStateV2_(context);
  return { ok: true, student: student };
}

function addQuestionV2(payload) {
  const session = requireStudentSessionV2_(payload);
  const context = readAppStateV2_(session.spreadsheetId);
  const state = context.state;
  const questionText = String(payload.question || '').trim();
  if (!questionText) return { ok: false, error: '질문 내용을 적어 주세요.' };
  if (questionText.length > 1000) return { ok: false, error: '질문은 1,000자 이내로 작성해 주세요.' };
  const requestId = String(payload.requestId || '').trim().slice(0, 120);
  const existingQuestion = requestId ? state.questions.find(function(question) {
    return String(question.id) === requestId &&
      belongsToClassV2_(question, session.classId, state) &&
      String(question.number).trim() === String(session.number).trim();
  }) : null;
  if (existingQuestion) {
    return {
      ok: true,
      questions: questionsForStudentV2_(state, session.classId, session.number)
    };
  }
  const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  const nowIso = new Date().toISOString();
  state.questions.unshift({
    id: requestId || 'Q_' + new Date().getTime() + '_' + Math.floor(Math.random() * 10000),
    classId: session.classId,
    topicId: String(payload.topicId || ''),
    number: session.number,
    name: session.name,
    source: '학생 질문',
    quote: String(payload.quote || '').slice(0, 1000),
    question: questionText,
    reply: '',
    resolved: false,
    createdAt: now,
    createdAtIso: nowIso,
    updatedAtIso: nowIso
  });
  writeAppStateV2_(context);
  return {
    ok: true,
    questions: questionsForStudentV2_(state, session.classId, session.number)
  };
}

/**
 * 1. 시트 초기화 및 전체 데이터 조회
 */
function initSheetsAndGetData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let studentSheet = ss.getSheetByName('Students');
  if (!studentSheet) {
    studentSheet = ss.insertSheet('Students');
    studentSheet.appendRow([
      'number', 'name', 'docId', 'docUrl', 'status', 'locked',
      'draft1', 'draft2', 'draft3', 'teacherNote', 'feedbackItemsJson', 'updatedAt'
    ]);
  }

  let questionSheet = ss.getSheetByName('Questions');
  if (!questionSheet) {
    questionSheet = ss.insertSheet('Questions');
    questionSheet.appendRow([
      'id', 'number', 'name', 'source', 'quote', 'question', 'reply', 'resolved', 'createdAt'
    ]);
  }

  let configSheet = ss.getSheetByName('Config');
  if (!configSheet) {
    configSheet = ss.insertSheet('Config');
    configSheet.appendRow(['key', 'value']);
    configSheet.appendRow(['assignmentTitle', '마음이 자라는 순간 · 나의 특별한 하루 글쓰기']);
    configSheet.appendRow(['assignmentPrompt', '기억에 남는 장면 하나를 골라 오감 표현이 생생하게 드러나도록 문단을 나누어 써 보세요.']);
    configSheet.appendRow(['currentPhase', 'STAGE_1']);
  }

  const rawStudents = getRowsAsObjects(studentSheet);
  const students = rawStudents.map(st => {
    let feedbackItems = [];
    if (st.feedbackItemsJson) {
      try {
        feedbackItems = JSON.parse(st.feedbackItemsJson);
      } catch (e) {}
    }
    return {
      ...st,
      locked: st.locked === true || st.locked === 'TRUE',
      feedbackItems: feedbackItems
    };
  });

  const questions = getRowsAsObjects(questionSheet);
  const configRows = getRowsAsObjects(configSheet);
  const config = {};
  configRows.forEach(r => { config[r.key] = r.value; });

  return {
    ok: true,
    students: students,
    questions: questions,
    config: config
  };
}

/**
 * 2. 새 글쓰기 주제 및 학생별 전용 구글 독스 일괄 생성
 */
function createStudentDocs(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  initSheetsAndGetData();
  const studentSheet = ss.getSheetByName('Students');
  const configSheet = ss.getSheetByName('Config');

  const title = payload.assignmentTitle || '초등 글쓰기 스튜디오 과제';
  const prompt = payload.assignmentPrompt || '자신의 생각과 느낌이 잘 드러나도록 문단을 나누어 글을 써 봅시다.';
  const studentList = payload.students || [];

  configSheet.clearContents();
  configSheet.appendRow(['key', 'value']);
  configSheet.appendRow(['assignmentTitle', title]);
  configSheet.appendRow(['assignmentPrompt', prompt]);
  configSheet.appendRow(['currentPhase', 'STAGE_1']);

  const folder = getOrCreateClassFolder();
  const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  const existingRows = getRowsAsObjects(studentSheet);

  studentList.forEach(st => {
    const exists = existingRows.find(r => String(r.number) === String(st.number));
    if (exists && exists.docId && !String(exists.docId).startsWith('DEMO_')) return;

    const docName = `[${st.number}번 ${st.name}] ${title}`;
    const doc = DocumentApp.create(docName);
    const docId = doc.getId();
    const body = doc.getBody();

    const marker = body.appendParagraph(STUDENT_TEXT_MARKER);
    marker.editAsText().setFontSize(1).setForegroundColor('#ffffff');
    doc.saveAndClose();

    const file = DriveApp.getFileById(docId);
    file.moveTo(folder);

    const docUrl = `https://docs.google.com/document/d/${docId}/edit`;
    studentSheet.appendRow([
      st.number, st.name, docId, docUrl, 'STAGE_1_WRITING', 'FALSE',
      '', '', '', '', '[]', now
    ]);
  });

  return initSheetsAndGetData();
}

/**
 * 3. 학생이 글을 제출하면 -> 해당 학생 전용 구글 독스에 문단 그대로 기록!
 */
function submitStage(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const studentSheet = ss.getSheetByName('Students');
  const data = studentSheet.getDataRange().getValues();
  const num = String(payload.number).trim();
  const stage = Number(payload.stage || 1);
  const studentText = payload.text || '';
  const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === num) {
      const name = data[i][1];
      let docId = data[i][2];
      let docUrl = data[i][3];

      try {
        if (!docId || String(docId).startsWith('DEMO_')) {
          const folder = getOrCreateClassFolder();
          const doc = DocumentApp.create(`[${num}번 ${name}] 글쓰기 공책`);
          docId = doc.getId();
          docUrl = `https://docs.google.com/document/d/${docId}/edit`;
          doc.saveAndClose();
          DriveApp.getFileById(docId).moveTo(folder);
          studentSheet.getRange(i + 1, 3).setValue(docId);
          studentSheet.getRange(i + 1, 4).setValue(docUrl);
        }

        // 이전 1차 Brisk 표/문단/댓글을 모두 자동 삭제하고 새 차수의 학생 본문만 깨끗하게 기록!
        resetDocWithCleanStudentText_(docId, studentText, payload.pieceTitle, name);
      } catch (e) {}

      const nextStatus =
        stage === 1 ? 'STAGE_1_SUBMITTED' : 'REVISION_SUBMITTED';

      studentSheet.getRange(i + 1, 5).setValue(nextStatus);
      studentSheet.getRange(i + 1, 6).setValue('TRUE');
      if (stage === 1) studentSheet.getRange(i + 1, 7).setValue(studentText);
      if (stage === 2) studentSheet.getRange(i + 1, 8).setValue(studentText);
      if (stage === 3) studentSheet.getRange(i + 1, 9).setValue(studentText);
      studentSheet.getRange(i + 1, 12).setValue(now);
      break;
    }
  }

  return initSheetsAndGetData();
}

/**
 * 4. [핵심] 구글 독스에서 Brisk가 삽입한 종합 첨삭(표/문단) 및 밑줄 댓글 자동 추출!
 *    복사·붙여넣기 없이 버튼 클릭(또는 탭 복귀) 한 번으로 독스의 첨삭을 읽어옵니다.
 */
function pullFeedbackFromDoc(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const studentSheet = ss.getSheetByName('Students');
  const data = studentSheet.getDataRange().getValues();
  const num = String(payload.number).trim();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === num) {
      const docId = data[i][2];
      const studentOriginal = String(data[i][8] || data[i][7] || data[i][6] || '').trim();

      if (!docId || String(docId).startsWith('DEMO_')) {
        return { ok: false, error: '연결된 실제 구글 독스가 없습니다.' };
      }

      let extractedBlocks = [];
      let extractedComments = [];

      try {
        const doc = DocumentApp.openById(docId);
        const body = doc.getBody();

        // (A) Brisk Glow & Grow 등 문서 내에 삽입된 표(Table) 텍스트 모두 추출
        const tables = body.getTables();
        for (let t = 0; t < tables.length; t++) {
          const table = tables[t];
          for (let r = 0; r < table.getNumRows(); r++) {
            const row = table.getRow(r);
            let rowCells = [];
            for (let c = 0; c < row.getNumCells(); c++) {
              const cellText = row.getCell(c).getText().trim();
              if (cellText) rowCells.push(cellText);
            }
            if (rowCells.length > 0) {
              extractedBlocks.push(rowCells.join('\n'));
            }
          }
        }

        // (B) 마커(STUDENT_TEXT_MARKER) 바깥이나 학생 원문에 없던 Brisk 추가 문단 추출
        const fullText = body.getText().replace(/\r\n/g, '\n');
        const withoutMarker = fullText.replace(STUDENT_TEXT_MARKER, '').trim();
        const originalLines = studentOriginal
          .replace(/\r\n/g, '\n')
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean);

        const docLines = withoutMarker
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean);

        const newLines = docLines.filter(line => !originalLines.includes(line));
        if (newLines.length > 0 && tables.length === 0) {
          extractedBlocks.push(newLines.join('\n'));
        }

        // (C) 구글 독스 밑줄 댓글(Drive API v3)도 함께 추출
        if (typeof Drive !== 'undefined' && Drive.Comments) {
          const res = Drive.Comments.list(docId, {
            fields: 'comments(id, content, quotedFileContent(value), resolved)'
          });
          const comments = (res && res.comments) || [];
          comments.forEach(c => {
            if (c.content) {
              extractedComments.push({
                id: 'DOC_FB_' + c.id,
                quote: (c.quotedFileContent && c.quotedFileContent.value) || '',
                comment: c.content
              });
            }
          });
        }
      } catch (e) {
        return { ok: false, error: e.message };
      }

      const combinedNote = extractedBlocks.join('\n\n').trim();
      if (combinedNote) {
        studentSheet.getRange(i + 1, 10).setValue(combinedNote);
      }
      if (extractedComments.length > 0) {
        studentSheet.getRange(i + 1, 11).setValue(JSON.stringify(extractedComments));
      }

      return {
        ok: true,
        pulledNote: combinedNote,
        pulledComments: extractedComments,
        fullData: initSheetsAndGetData()
      };
    }
  }

  return { ok: false, error: '학생을 찾을 수 없습니다.' };
}

/**
 * 5. 교사가 종합 첨삭 및 부분 첨삭을 학생 공책으로 전송
 */
function updateStudentStatus(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const studentSheet = ss.getSheetByName('Students');
  const data = studentSheet.getDataRange().getValues();
  const num = String(payload.number).trim();
  const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === num) {
      const newStatus = payload.status || data[i][4];
      const shouldLock = payload.locked !== undefined ? Boolean(payload.locked) : false;
      const feedbackItems = payload.feedbackItems || [];

      studentSheet.getRange(i + 1, 5).setValue(newStatus);
      studentSheet.getRange(i + 1, 6).setValue(shouldLock ? 'TRUE' : 'FALSE');
      if (payload.teacherNote !== undefined) {
        studentSheet.getRange(i + 1, 10).setValue(payload.teacherNote);
      }
      studentSheet.getRange(i + 1, 11).setValue(JSON.stringify(feedbackItems));
      studentSheet.getRange(i + 1, 12).setValue(now);

      // 첨삭 전송 완료 시: 이미 시트와 앱에 첨삭이 저장되었으므로, 다음 차수 첨삭을 위해 독스의 Brisk 표/댓글을 자동 청소!
      const docId = data[i][2];
      const latestStudentText = String(data[i][8] || data[i][7] || data[i][6] || '');
      if (docId && latestStudentText) {
        resetDocWithCleanStudentText_(docId, latestStudentText);
      }
      break;
    }
  }

  return initSheetsAndGetData();
}

function studentLogin(payload) {
  const data = initSheetsAndGetData();
  const num = String(payload.number || '').trim();
  const name = String(payload.name || '').trim();

  const student = data.students.find(
    s => String(s.number).trim() === num && String(s.name).trim() === name
  );

  if (!student) {
    return { ok: false, error: '일치하는 번호와 이름을 찾을 수 없습니다.' };
  }

  const myQuestions = data.questions.filter(q => String(q.number).trim() === num);
  return {
    ok: true,
    student: student,
    questions: myQuestions,
    config: data.config
  };
}

function batchDeadlineControl(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const studentSheet = ss.getSheetByName('Students');
  const data = studentSheet.getDataRange().getValues();
  const lockAll = Boolean(payload.lockAll);
  const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');

  for (let i = 1; i < data.length; i++) {
    studentSheet.getRange(i + 1, 6).setValue(lockAll ? 'TRUE' : 'FALSE');
    studentSheet.getRange(i + 1, 12).setValue(now);
  }

  return initSheetsAndGetData();
}

function addQuestion(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const questionSheet = ss.getSheetByName('Questions');
  const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  const id = String(payload.requestId || '').trim().slice(0, 120) ||
    'Q_' + new Date().getTime();

  const existingIds = questionSheet.getDataRange().getValues().slice(1).map(function(row) {
    return String(row[0] || '');
  });
  if (existingIds.indexOf(id) >= 0) return initSheetsAndGetData();

  questionSheet.appendRow([
    id,
    payload.number,
    payload.name,
    payload.source || '학생 질문',
    payload.quote || '',
    payload.question || '',
    '',
    'FALSE',
    now
  ]);

  return initSheetsAndGetData();
}

function replyQuestion(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const questionSheet = ss.getSheetByName('Questions');
  const data = questionSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(payload.id)) {
      questionSheet.getRange(i + 1, 7).setValue(payload.reply || '');
      questionSheet.getRange(i + 1, 8).setValue('TRUE');
      break;
    }
  }

  return initSheetsAndGetData();
}

function getRowsAsObjects(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx];
    });
    return obj;
  });
}
