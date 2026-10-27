const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const moduleUrl = pathToFileURL(path.join(__dirname, '../src/utils/teacherRoster.js')).href;
const entry = (number, status, needsAction = false, priorityScore = 0) => ({
  st: { number, status }, needsAction, priorityScore
});

test('완성본은 아래에 모으고 첨삭 받은 뒤 수정 중인 학생은 진행 중에 남긴다', async () => {
  const { groupTeacherRoster } = await import(moduleUrl);
  const groups = groupTeacherRoster([
    entry('1', 'FINAL_COMPLETED'),
    entry('2', 'FEEDBACK_DONE'),
    entry('3', 'REVISION_SUBMITTED', true, 100),
    entry('4', 'STAGE_1_WRITING')
  ]);
  assert.deepEqual(groups.actionNeeded.map((x) => x.st.number), ['3']);
  assert.deepEqual(groups.inProgress.map((x) => x.st.number), ['2', '4']);
  assert.deepEqual(groups.completed.map((x) => x.st.number), ['1']);
});

test('완료 학생의 질문 알림도 보존하고 번호순에서도 완료 구역을 따로 유지한다', async () => {
  const { groupTeacherRoster } = await import(moduleUrl);
  const entries = [
    entry('1', 'FINAL_COMPLETED'),
    entry('4', 'FINAL_COMPLETED', true, 200),
    entry('3', 'STAGE_1_SUBMITTED', true, 100),
    entry('2', 'STAGE_1_WRITING', true, 200)
  ];
  const groups = groupTeacherRoster(entries);
  assert.deepEqual(groups.actionNeeded.map((x) => x.st.number), ['2', '3']);
  assert.deepEqual(groups.completed.map((x) => x.st.number), ['4', '1']);
  assert.equal(groups.completed[0].needsAction, true);
  const numbered = groupTeacherRoster(entries, 'number');
  assert.deepEqual(numbered.completed.map((x) => x.st.number), ['1', '4']);
  assert.equal(Object.values(numbered).flat().length, entries.length);
});

test('완료 후 혼자 저장하면 완료에 머물고 명시적으로 첨삭 요청하면 대기로 돌아온다', async () => {
  const { groupTeacherRoster } = await import(moduleUrl);
  assert.equal(groupTeacherRoster([entry('1', 'FINAL_COMPLETED')]).completed.length, 1);
  const requested = groupTeacherRoster([entry('1', 'REVISION_SUBMITTED', true, 100)]);
  assert.equal(requested.completed.length, 0);
  assert.equal(requested.actionNeeded.length, 1);
});
