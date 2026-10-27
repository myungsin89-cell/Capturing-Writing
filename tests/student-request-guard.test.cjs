const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '../src/utils/studentRequestGuard.js')).href;

test('재제출 전에 시작한 자동 갱신 응답은 학생 상태를 덮어쓰지 않는다', async () => {
  const { createStudentRequestGuard } = await import(moduleUrl);
  const guard = createStudentRequestGuard();
  const staleRead = guard.beginRead();
  const finishMutation = guard.beginMutation();

  assert.equal(guard.isMutationPending(), true);
  assert.equal(guard.canApplyRead(staleRead), false);

  finishMutation();
  assert.equal(guard.isMutationPending(), false);
  assert.equal(guard.canApplyRead(staleRead), false);

  const freshRead = guard.beginRead();
  assert.equal(guard.canApplyRead(freshRead), true);
});

test('동일한 재제출 완료 처리는 한 번만 mutation 잠금을 해제한다', async () => {
  const { createStudentRequestGuard } = await import(moduleUrl);
  const guard = createStudentRequestGuard();
  const finishMutation = guard.beginMutation();
  finishMutation();
  finishMutation();
  assert.equal(guard.isMutationPending(), false);
});
