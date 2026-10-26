const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
const helperUrl = pathToFileURL(path.join(root, 'src/utils/batchFeedback.js')).href;
const driveUrl = pathToFileURL(path.join(root, 'src/services/batchFeedbackDrive.js')).href;

const submission = () => ({
  classId: 'C1', number: '1', name: '가학생', status: 'STAGE_1_SUBMITTED', locked: true,
  pieceTitle: '소풍', updatedAtIso: '2026-10-26T01:00:00.000Z',
  draftHistory: [{ text: '  첫 문단\n\n둘째 문단\n', pieceTitle: '소풍', updatedAtIso: '2026-10-26T01:00:00.000Z' }]
});

test('묶음 대상은 본문이 있는 제출본만 포함한다', async () => {
  const { isFeedbackCandidate } = await import(helperUrl);
  for (const status of ['STAGE_1_SUBMITTED', 'STAGE_2_SUBMITTED', 'REVISION_SUBMITTED', 'STAGE_3_COMPLETED']) {
    assert.equal(isFeedbackCandidate({ ...submission(), status }), true);
  }
  for (const status of ['STAGE_1_WRITING', 'FEEDBACK_DONE', 'FINAL_COMPLETED']) {
    assert.equal(isFeedbackCandidate({ ...submission(), status }), false);
  }
  assert.equal(isFeedbackCandidate({ ...submission(), draftHistory: [] }), false);
});

test('회수, 재제출, 제목 변경, 다른 학급에는 이전 제출본 첨삭을 붙이지 않는다', async () => {
  const { getSubmissionSnapshot, isMatchingSubmission } = await import(helperUrl);
  const record = submission();
  const entry = { ...record, ...getSubmissionSnapshot(record) };
  assert.equal(isMatchingSubmission(record, entry), true);
  assert.equal(isMatchingSubmission({ ...record, docId: 'new-doc' }, entry), true);
  assert.equal(isMatchingSubmission({ ...record, status: 'STAGE_1_WRITING' }, entry), false);
  assert.equal(isMatchingSubmission({ ...record, classId: 'C2' }, entry), false);
  assert.equal(isMatchingSubmission({ ...record, pieceTitle: '새 제목' }, entry), false);
  assert.equal(isMatchingSubmission({ ...record, draftHistory: [{ ...record.draftHistory[0], updatedAtIso: '2026-10-26T01:01:00.000Z' }] }, entry), false);
});

test('지난 주제의 글은 현재 주제 본문이나 피드백을 섞지 않는다', async () => {
  const { getFeedbackTopicRecord, isFeedbackCandidate } = await import(helperUrl);
  const student = { ...submission(), historyByTopic: { OLD: { status: 'REVISION_SUBMITTED', draft1: '옛글', pieceTitle: '옛제목' } } };
  const past = getFeedbackTopicRecord(student, { id: 'OLD' }, 'CURRENT');
  assert.equal(past.draft1, '옛글');
  assert.equal(past.draftHistory, undefined);
  assert.equal(isFeedbackCandidate(past), true);
  assert.equal(isFeedbackCandidate(getFeedbackTopicRecord(student, { id: 'MISSING' }, 'CURRENT')), false);
});

test('저장한 목표·기준·피드백 방식과 새 주제 내용을 함께 재사용한다', async () => {
  const { normalizeFeedbackCriteria, buildFeedbackPrompt } = await import(helperUrl);
  const settings = normalizeFeedbackCriteria({ goal: '  생생하게 쓰기 ', criteria: '순서\n생각과 느낌', guidance: '잘한 점 1개, 질문 1개' });
  assert.equal(settings.goal, '생생하게 쓰기');
  const prompt = buildFeedbackPrompt({ title: '새 주제', prompt: '오늘의 안내' }, settings);
  for (const part of ['새 주제', '오늘의 안내', '생생하게 쓰기', '순서\n생각과 느낌', '질문 1개']) assert.ok(prompt.includes(part));
  assert.equal(normalizeFeedbackCriteria(null).goal, '');
});

test('검토한 피드백은 해당 학생·해당 주제만 수정 모드로 열고 차수에 기록한다', async () => {
  const { applyFeedbackToStudent, getSubmissionSnapshot } = await import(helperUrl);
  const record = submission();
  const entry = { id: 'E1', ...record, ...getSubmissionSnapshot(record), note: '장면을 더 들려줄래요?', comments: [{ id: 'F1', quote: '첫 문단', comment: '잘했어요' }] };
  const next = applyFeedbackToStudent(record, { topicId: 'T1', activeTopicId: 'T1', entry, nowIso: 'NOW' });
  assert.equal(next.status, 'FEEDBACK_DONE');
  assert.equal(next.locked, false);
  assert.equal(next.draftHistory[0].text, record.draftHistory[0].text);
  assert.equal(next.draftHistory[0].teacherNote, entry.note);
  assert.equal(next.batchFeedbackReceipt.entryId, 'E1');
  assert.equal(record.status, 'STAGE_1_SUBMITTED');
  const current = { ...submission(), historyByTopic: { OLD: record } };
  const previousTopic = applyFeedbackToStudent(current, { topicId: 'OLD', activeTopicId: 'T1', entry, nowIso: 'NOW' });
  assert.equal(previousTopic.status, 'STAGE_1_SUBMITTED');
  assert.equal(previousTopic.historyByTopic.OLD.status, 'FEEDBACK_DONE');
});

function mockDrive() {
  const files = [];
  const documents = new Map();
  let failEntry = 'E2';
  let active = 0; let maxActive = 0;
  const request = async (url, options = {}) => {
    active++; maxActive = Math.max(maxActive, active);
    try {
      const body = options.body ? JSON.parse(options.body) : null;
      if (url.includes('?q=')) {
        const query = new URL(url).searchParams.get('q');
        const match = query.match(/key='(\w+)' and value='([^']+)'/);
        return { files: files.filter((file) => file.appProperties?.[match[1]] === match[2]) };
      }
      if (url.endsWith('/files') && body) {
        const file = { id: `FILE_${files.length}`, ...body }; files.push(file);
        if (body.mimeType.endsWith('document')) documents.set(file.id, '');
        return file;
      }
      const id = url.split('/').at(-1).split(':')[0];
      if (url.endsWith(':batchUpdate')) {
        const file = files.find((item) => item.id === id);
        if (file.appProperties.sseudamEntryId === failEntry) { failEntry = null; throw new Error('일시적 문서 오류'); }
        documents.set(id, documents.get(id) + body.requests[0].insertText.text);
        return {};
      }
      return { body: { content: [{ paragraph: { elements: [{ textRun: { content: documents.get(id) || '\n' } }] } }] } };
    } finally { active--; }
  };
  return { files, documents, request, maxActive: () => maxActive };
}

test('묶음은 원본 독스를 건드리지 않고 선택한 제출본을 보존하며 부분 실패 후 재개한다', async () => {
  const { prepareFeedbackBatch } = await import(driveUrl);
  const drive = mockDrive();
  const batch = { id: 'B1', topicTitle: '경험', label: '1차 묶음', entries: [
    { id: 'E1', number: '1', name: '가학생', round: 1, pieceTitle: '제목1', text: '  원문\n\n끝\n' },
    { id: 'E2', number: '2', name: '나학생', round: 2, pieceTitle: '제목2', text: '두 번째 글' }
  ] };
  let progress;
  const first = await prepareFeedbackBatch(drive.request, batch, (state) => { progress = structuredClone(state); });
  assert.equal(first.entries[0].prepared, true);
  assert.equal(first.entries[1].prepared, undefined);
  assert.match(first.entries[1].error, /일시적/);
  assert.equal(progress.entries[1].docId, first.entries[1].docId);
  const doc1 = first.entries[0].docId;
  drive.documents.set(doc1, drive.documents.get(doc1) + '교사가 삽입한 피드백');
  const next = await prepareFeedbackBatch(drive.request, first);
  assert.equal(next.entries.every((entry) => entry.prepared), true);
  assert.equal(drive.files.length, 3);
  assert.ok(drive.documents.get(doc1).includes('  원문\n\n끝\n'));
  assert.ok(drive.documents.get(doc1).endsWith('교사가 삽입한 피드백'));
  assert.equal(drive.maxActive(), 1);
});

test('생성 응답 유실 후에도 같은 묶음·문서를 찾아 중복 생성하지 않는다', async () => {
  const { prepareFeedbackBatch } = await import(driveUrl);
  const drive = mockDrive();
  const batch = { id: 'B2', topicTitle: '주제', label: '묶음', entries: [{ id: 'E1', number: '1', name: '가학생', round: 1, text: '글' }] };
  let lost = false;
  const request = async (url, options) => {
    const result = await drive.request(url, options);
    if (!lost && options?.body && JSON.parse(options.body).mimeType?.endsWith('document')) {
      lost = true; throw new Error('생성 응답 유실');
    }
    return result;
  };
  const first = await prepareFeedbackBatch(request, batch);
  assert.equal(first.entries[0].docId, undefined);
  const second = await prepareFeedbackBatch(request, first);
  assert.equal(second.entries[0].prepared, true);
  assert.equal(drive.files.length, 2);
});

async function loadGoogleService() {
  const source = fs.readFileSync(path.join(root, 'src/services/googleDriveService.js'), 'utf8')
    .replace(/import gasCodeRaw from [^;]+;/, "const gasCodeRaw = '';")
    .replace(/import gasManifestRaw from [^;]+;/, "const gasManifestRaw = '';")
    .replace("'./batchFeedbackDrive'", JSON.stringify(driveUrl))
    .replace("'../utils/batchFeedback'", JSON.stringify(helperUrl));
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`);
}

function sheetFixture(t, record = submission()) {
  let state = {
    classes: [{ id: 'C1' }], topics: [{ id: 'T1', classId: 'C1', isActive: true }],
    students: [record, { classId: 'C1', number: '2', status: 'STAGE_1_WRITING', draft1: '계속 쓰는 글' }],
    questions: [], config: { activeClassId: 'C1', activeTopicId: 'T1' }
  };
  let writes = 0; let loseResponse = false;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (url.includes('values:batchUpdate')) {
      writes++;
      const rows = JSON.parse(options.body).data[0].values;
      const next = {};
      for (const [key, value] of rows.slice(1)) next[key] = JSON.parse(value);
      state = next;
      if (loseResponse) { loseResponse = false; throw new Error('저장 응답 유실'); }
      return new Response('{}');
    }
    if (url.includes('/values/AppState!') && !url.endsWith(':clear')) {
      return new Response(JSON.stringify({ values: Object.entries(state).map(([key, value]) => [key, JSON.stringify(value)]) }));
    }
    return new Response('{}');
  });
  return { state: () => structuredClone(state), setState: (next) => { state = next; }, writes: () => writes, loseNextWriteResponse: () => { loseResponse = true; } };
}

test('전송 직전 원격 제출본을 확인하고 교사 확인 없는 첨삭과 회수된 글을 차단한다', async (t) => {
  const { getSubmissionSnapshot } = await import(helperUrl);
  const service = await loadGoogleService();
  const sheet = sheetFixture(t);
  const local = sheet.state();
  const entry = { id: 'E1', ...submission(), ...getSubmissionSnapshot(submission()), note: '조언', reviewed: false };
  await assert.rejects(service.saveFullStateToSpreadsheet('token', 'SHEET', { ...local, reviewedFeedback: { classId: 'C1', topicId: 'T1', entry } }), /확인/);
  const remote = sheet.state(); remote.students[0].status = 'STAGE_1_WRITING'; sheet.setState(remote);
  await assert.rejects(service.saveFullStateToSpreadsheet('token', 'SHEET', { ...local, reviewedFeedback: { classId: 'C1', topicId: 'T1', entry: { ...entry, reviewed: true } } }), /제출 상태/);
  assert.equal(sheet.writes(), 0);
});

test('전송은 선택한 학생만 갱신하고 재시도와 늦은 자동 저장으로 첨삭을 중복·취소하지 않는다', async (t) => {
  const { getSubmissionSnapshot } = await import(helperUrl);
  const service = await loadGoogleService();
  const sheet = sheetFixture(t);
  const local = sheet.state();
  const entry = { id: 'E1', ...submission(), ...getSubmissionSnapshot(submission()), note: '조언', comments: [], reviewed: true };
  const update = { ...local, reviewedFeedback: { classId: 'C1', topicId: 'T1', entry } };
  sheet.loseNextWriteResponse();
  const result = await service.saveFullStateToSpreadsheet('token', 'SHEET', update);
  assert.equal(result.feedbackStudent.status, 'FEEDBACK_DONE');
  await service.saveFullStateToSpreadsheet('token', 'SHEET', update);
  assert.equal(sheet.writes(), 1);
  await service.saveFullStateToSpreadsheet('token', 'SHEET', local);
  assert.equal(sheet.state().students[0].teacherNote, '조언');
  assert.equal(sheet.state().students[1].status, 'STAGE_1_WRITING');
  assert.equal(sheet.state().students[1].draft1, '계속 쓰는 글');
});
