const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
const helperUrl = pathToFileURL(path.join(root, 'src/utils/batchFeedback.js')).href;
async function service() {
  const source = fs.readFileSync(path.join(root, 'src/services/googleDriveService.js'), 'utf8')
    .replace(/import gasCodeRaw from [^;]+;/, "const gasCodeRaw = '';")
    .replace(/import gasManifestRaw from [^;]+;/, "const gasManifestRaw = '';")
    .replace("'./batchFeedbackDrive'", JSON.stringify(pathToFileURL(path.join(root, 'src/services/batchFeedbackDrive.js')).href))
    .replace("'../utils/batchFeedback'", JSON.stringify(helperUrl));
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`);
}
function fixture(t) {
  let state = {
    classes: [{ id: 'C' }], topics: [{ id: 'T', classId: 'C', isActive: true }],
    students: ['1', '2'].map((number) => ({ classId: 'C', number, name: number + '학생', pieceTitle: '제목',
      status: 'STAGE_1_SUBMITTED', locked: true, draft1: '  첫 문단\n\n둘째 문단\n',
      draftHistory: [{ text: '  첫 문단\n\n둘째 문단\n', pieceTitle: '제목', updatedAtIso: '2026-11-01T00:00:00.000Z' }], updatedAtIso: '2026-11-01T00:00:00.000Z' })),
    questions: [], config: { activeClassId: 'C', activeTopicId: 'T', teacherBridgeToken: 'token' }
  };
  let revision = ''; let writes = 0; let conflicts = 0; let loseResponse = false;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (url.includes('?fields=sheets(')) return Response.json({ sheets: ['AppState', 'Students', 'Questions'].map((title, sheetId) => ({ properties: { title, sheetId } })), namedRanges: revision ? [{ name: 'SSEUDAM_STATE_REVISION', namedRangeId: revision }] : [] });
    if (url.includes('/values/AppState!')) return Response.json({ values: [['KEY', 'JSON_VALUE'], ...Object.entries(state).map(([key, value]) => [key, JSON.stringify(value)])] });
    if (url.endsWith(':batchUpdate') && !url.includes('values:batchUpdate')) {
      const requests = JSON.parse(options.body).requests;
      const expected = requests.find((item) => item.deleteNamedRange)?.deleteNamedRange.namedRangeId || '';
      if (expected !== revision) { conflicts += 1; return Response.json({ error: { message: 'named range conflict' } }, { status: 400 }); }
      revision = requests.find((item) => item.addNamedRange).addNamedRange.namedRange.namedRangeId;
      const rows = requests.find((item) => item.updateCells?.range.sheetId === 0).updateCells.rows;
      state = Object.fromEntries(rows.slice(1).map((row) => [row.values[0].userEnteredValue.stringValue, JSON.parse(row.values[1].userEnteredValue.stringValue)]));
      writes += 1;
      if (loseResponse) { loseResponse = false; throw new Error('응답 유실'); }
      return Response.json({});
    }
    return Response.json({});
  });
  return { state: () => structuredClone(state), writes: () => writes, conflicts: () => conflicts, loseResponse: () => { loseResponse = true; } };
}
async function transition(sheet, kind, number = '1') {
  const { getSubmissionSnapshot } = await import(helperUrl);
  return { kind, classId: 'C', topicId: 'T', number,
    submissionKey: getSubmissionSnapshot(sheet.state().students.find((item) => item.number === number)).submissionKey,
    requestId: `${kind}:${number}`, note: '보관할 첨삭', comments: [], completionStars: 2 };
}

for (const first of ['recall', 'feedback', 'complete']) {
  test(`${first}와 다른 창의 요청이 동시에 같은 제출본을 읽어도 하나만 저장한다`, async (t) => {
    const sheet = fixture(t); const a = await service(); const b = await service();
    const firstRequest = await transition(sheet, first);
    const secondRequest = await transition(sheet, first === 'recall' ? 'feedback' : 'recall');
    const outcomes = await Promise.allSettled([
      a.saveFullStateToSpreadsheet('token', 'SHEET', { submissionTransition: firstRequest }),
      b.saveFullStateToSpreadsheet('token', 'SHEET', { submissionTransition: secondRequest })
    ]);
    assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((item) => item.status === 'rejected').length, 1);
    assert.equal(sheet.writes(), 1);
    assert.ok(sheet.conflicts() >= 1, 'both requests reached the atomic write using the old revision');
    const saved = sheet.state().students[0];
    assert.equal(saved.submissionTransitionReceipt.kind, first);
    assert.equal(saved.draft1, '  첫 문단\n\n둘째 문단\n');
    assert.equal(saved.recalled === true, first === 'recall');
  });
}

test('다른 학생의 동시 회수는 충돌 후 다시 읽어 두 학생 모두 보존한다', async (t) => {
  const sheet = fixture(t); const a = await service(); const b = await service();
  const requests = await Promise.all(['1', '2'].map((number) => transition(sheet, 'recall', number)));
  await Promise.all(requests.map((request, index) => [a, b][index].saveFullStateToSpreadsheet('token', 'SHEET', { submissionTransition: request })));
  assert.equal(sheet.writes(), 2); assert.ok(sheet.conflicts() >= 1);
  assert.ok(sheet.state().students.every((student) => student.recalled));
});

test('저장 응답 유실과 같은 요청 재시도는 첨삭을 중복 저장하지 않는다', async (t) => {
  const sheet = fixture(t); const api = await service(); const request = await transition(sheet, 'feedback');
  sheet.loseResponse();
  await api.saveFullStateToSpreadsheet('token', 'SHEET', { submissionTransition: request });
  await api.saveFullStateToSpreadsheet('token', 'SHEET', { submissionTransition: request });
  assert.equal(sheet.writes(), 1);
  assert.equal(sheet.state().students[0].teacherNote, '보관할 첨삭');
});

test('전송과 동시에 시작한 오래된 자동 저장은 전송된 첨삭을 취소하지 않는다', async (t) => {
  const sheet = fixture(t); const teacher = await service(); const auto = await service();
  const stale = sheet.state(); const request = await transition(sheet, 'feedback');
  await Promise.all([
    teacher.saveFullStateToSpreadsheet('token', 'SHEET', { submissionTransition: request }),
    auto.saveFullStateToSpreadsheet('token', 'SHEET', stale)
  ]);
  assert.equal(sheet.state().students[0].status, 'FEEDBACK_DONE');
  assert.equal(sheet.state().students[0].teacherNote, '보관할 첨삭');
  assert.ok(sheet.conflicts() >= 1);
});
