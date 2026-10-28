const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const helperUrl = pathToFileURL(path.join(root, 'src/utils/batchFeedback.js')).href;
const driveUrl = pathToFileURL(path.join(root, 'src/services/batchFeedbackDrive.js')).href;

async function loadGoogleService() {
  const source = fs
    .readFileSync(path.join(root, 'src/services/googleDriveService.js'), 'utf8')
    .replace(/import gasCodeRaw from [^;]+;/, "const gasCodeRaw = '';")
    .replace(/import gasManifestRaw from [^;]+;/, "const gasManifestRaw = '';")
    .replace("'./batchFeedbackDrive'", JSON.stringify(driveUrl))
    .replace("'../utils/batchFeedback'", JSON.stringify(helperUrl));
  return import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`
  );
}

function appStateRows(state) {
  return [['KEY', 'JSON_VALUE'], ...Object.entries(state).map(([key, value]) => [key, JSON.stringify(value)])];
}

function gvizResponse(state) {
  const rows = appStateRows(state).map(([key, value]) => ({
    c: [{ v: key }, { v: value }]
  }));
  return `google.visualization.Query.setResponse(${JSON.stringify({ table: { rows } })});`;
}

test('시트 직결 학생 API에서도 제출 회수 후 같은 차수로 다시 제출한다', async (t) => {
  const service = await loadGoogleService();
  const spreadsheetId = 'SHEET_ID_12345678901234567890';
  let state = {
    classes: [{ id: 'CLASS_A', className: '4학년 4반' }],
    topics: [
      {
        id: 'TOPIC_A',
        classId: 'CLASS_A',
        title: '나의 하루',
        isActive: true,
        classLocked: false
      }
    ],
    students: [
      {
        classId: 'CLASS_A',
        number: '1',
        name: '가학생',
        status: 'STAGE_1_SUBMITTED',
        locked: true,
        pieceTitle: '나의 글',
        draft1: '오타가 있는 글',
        draftHistory: [
          { round: 1, label: '1차 글', text: '오타가 있는 글', pieceTitle: '나의 글' }
        ],
        historyByTopic: {},
        updatedAtIso: '2026-10-27T00:00:00.000Z'
      }
    ],
    questions: [],
    config: {
      activeClassId: 'CLASS_A',
      activeTopicId: 'TOPIC_A',
      classAccessKeys: { CLASS_A: 'class-secret' },
      teacherBridgeToken: 'teacher-token'
    },
    updatedAt: '2026-10-27T00:00:00.000Z'
  };

  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/gviz/tq')) {
      return new Response(gvizResponse(state));
    }
    if (target.includes('/values/AppState!') && !target.endsWith(':clear')) {
      return new Response(JSON.stringify({ values: appStateRows(state) }));
    }
    if (target.includes('values:batchUpdate')) {
      const payload = JSON.parse(options.body);
      const appStateData = payload.data.find((entry) => entry.range === 'AppState!A1');
      const nextState = {};
      for (const [key, value] of appStateData.values.slice(1)) {
        const baseKey = String(key).replace(/:\d+$/, '');
        if (!nextState[baseKey]) nextState[baseKey] = '';
        nextState[baseKey] += value;
      }
      Object.keys(nextState).forEach((key) => {
        nextState[key] = JSON.parse(nextState[key]);
      });
      state = nextState;
      return new Response('{}');
    }
    return new Response('{}');
  });

  const sessionToken = Buffer.from(
    encodeURIComponent(
      JSON.stringify({
        spreadsheetId,
        classId: 'CLASS_A',
        accessKey: 'class-secret',
        number: '1',
        name: '가학생'
      })
    )
  ).toString('base64');

  const recalled = await service.callDirectSheetStudentApi({
    action: 'unsubmitStage',
    spreadsheetId,
    sessionToken,
    topicId: 'TOPIC_A'
  });
  assert.equal(recalled.ok, true);
  assert.equal(recalled.student.locked, false);
  assert.equal(recalled.student.recalled, true);
  assert.equal(recalled.student.status, 'STAGE_1_WRITING');

  const resubmitted = await service.callDirectSheetStudentApi({
    action: 'submitStage',
    spreadsheetId,
    sessionToken,
    topicId: 'TOPIC_A',
    stage: 1,
    pieceTitle: '나의 글',
    text: '오타를 고친 글',
    isRecallUpdate: true
  });
  assert.equal(resubmitted.ok, true);
  assert.equal(resubmitted.student.locked, true);
  assert.equal(resubmitted.student.draftHistory.length, 1);
  assert.equal(resubmitted.student.draftHistory[0].text, '오타를 고친 글');
});

test('시트 직결 학생 API에서도 완성본 저장과 첨삭 요청을 구분한다', async (t) => {
  const service = await loadGoogleService();
  const spreadsheetId = 'SHEET_ID_12345678901234567890';
  let state = {
    classes: [{ id: 'CLASS_A', className: '4학년 4반' }],
    topics: [{ id: 'TOPIC_A', classId: 'CLASS_A', title: '나의 하루', isActive: true, classLocked: true }],
    students: [{
      classId: 'CLASS_A', number: '1', name: '가학생', status: 'FINAL_COMPLETED', locked: true,
      pieceTitle: '완성한 글', draft1: '최종 완성 글', completionStars: 2,
      draftHistory: [{ round: 1, label: '1차 글', text: '최종 완성 글', pieceTitle: '완성한 글' }],
      historyByTopic: {}, updatedAtIso: '2026-10-27T00:00:00.000Z'
    }],
    questions: [],
    config: {
      activeClassId: 'CLASS_A', activeTopicId: 'TOPIC_A',
      classAccessKeys: { CLASS_A: 'class-secret' }, teacherBridgeToken: 'teacher-token'
    },
    updatedAt: '2026-10-27T00:00:00.000Z'
  };

  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/gviz/tq')) return new Response(gvizResponse(state));
    if (target.includes('/values/AppState!') && !target.endsWith(':clear')) {
      return new Response(JSON.stringify({ values: appStateRows(state) }));
    }
    if (target.includes('values:batchUpdate')) {
      const payload = JSON.parse(options.body);
      const appStateData = payload.data.find((entry) => entry.range === 'AppState!A1');
      const nextState = {};
      for (const [key, value] of appStateData.values.slice(1)) {
        const baseKey = String(key).replace(/:\d+$/, '');
        if (!nextState[baseKey]) nextState[baseKey] = '';
        nextState[baseKey] += value;
      }
      Object.keys(nextState).forEach((key) => { nextState[key] = JSON.parse(nextState[key]); });
      state = nextState;
      return new Response('{}');
    }
    return new Response('{}');
  });

  const sessionToken = Buffer.from(encodeURIComponent(JSON.stringify({
    spreadsheetId, classId: 'CLASS_A', accessKey: 'class-secret', number: '1', name: '가학생'
  }))).toString('base64');
  const selfSaved = await service.callDirectSheetStudentApi({
    action: 'submitStage', spreadsheetId, sessionToken, topicId: 'TOPIC_A', stage: 2,
    pieceTitle: '완성한 글 (더 다듬음)', text: '완성 후 더 다듬은 글', allowRevision: true,
    keepFinalCompleted: true, completionStars: 3
  });

  assert.equal(selfSaved.ok, true);
  assert.equal(selfSaved.student.status, 'FINAL_COMPLETED');
  assert.equal(selfSaved.student.draftHistory.length, 2);
  assert.equal(selfSaved.student.draftHistory[1].text, '완성 후 더 다듬은 글');
  assert.equal(selfSaved.student.completedWriting.text, '최종 완성 글');
  assert.equal(selfSaved.student.completedWriting.stars, 2, 'student payload cannot change awarded stars');

  const feedbackRequested = await service.callDirectSheetStudentApi({
    action: 'submitStage', spreadsheetId, sessionToken, topicId: 'TOPIC_A', stage: 3,
    pieceTitle: '완성한 글 (첨삭 요청)', text: '한 번 더 다듬은 글', allowRevision: true
  });

  assert.equal(feedbackRequested.ok, true);
  assert.equal(feedbackRequested.student.status, 'REVISION_SUBMITTED');
  assert.equal(feedbackRequested.student.draftHistory.length, 3);
  assert.equal(feedbackRequested.student.completedWriting.text, '최종 완성 글');
  assert.equal(feedbackRequested.student.completedWriting.stars, 2);
});

test('시트 직결 친구 공책 API도 세션·학급·주제와 승인본 공개 범위를 확인한다', async (t) => {
  const service = await loadGoogleService();
  const state = {
    classes: [{ id: 'A' }, { id: 'B' }], config: { classAccessKeys: { A: 'key' } },
    topics: [{ id: 'NOW', classId: 'A', isActive: true }, { id: 'OLD', classId: 'A' }, { id: 'OTHER', classId: 'B' }],
    students: [{ classId: 'A', number: '1', name: '나' },
      { classId: 'A', number: '2', name: '친구', status: 'REVISION_SUBMITTED', draft1: '작성 중', teacherNote: '비공개',
        completedWriting: { pieceTitle: '승인 제목', text: '  승인 본문\n\n문단', completedAt: 'approved' },
        historyByTopic: { OLD: { status: 'FINAL_COMPLETED', pieceTitle: '지난 제목', draft1: '지난 완성 글' } } },
      { classId: 'B', number: '3', name: '다른 반', status: 'FINAL_COMPLETED', draft1: '다른 반 글' },
      { classId: 'A', number: '4', name: '작성 중', status: 'FEEDBACK_DONE', draft1: '비공개 초안' }]
  };
  t.mock.method(globalThis, 'fetch', async () => new Response(gvizResponse(state)));
  const login = await service.callDirectSheetStudentApi({ action: 'studentLogin', spreadsheetId: 'sheet', classId: 'A', accessKey: 'key', number: '1', name: '나' });
  const payload = { action: 'studentCompletedWritings', spreadsheetId: 'sheet', sessionToken: login.sessionToken, topicId: 'NOW' };
  const result = await service.callDirectSheetStudentApi(payload);
  assert.equal(result.ok, true);
  assert.deepEqual(result.writings, [{ number: '2', name: '친구', pieceTitle: '승인 제목', text: '  승인 본문\n\n문단', completedAt: 'approved', stars: 0 }]);
  assert.equal((await service.callDirectSheetStudentApi({ ...payload, topicId: 'OLD' })).writings[0].text, '지난 완성 글');
  assert.equal((await service.callDirectSheetStudentApi({ ...payload, topicId: 'OTHER' })).ok, false);
  assert.equal((await service.callDirectSheetStudentApi({ ...payload, sessionToken: '' })).ok, false);
});
