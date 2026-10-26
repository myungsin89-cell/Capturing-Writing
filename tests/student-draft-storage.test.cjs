const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'src/utils/studentDraftStorage.js')).href;
const ownerArgs = { spreadsheetId: 'SHEET_A', classId: 'CLASS_A', student: { number: '1', name: '가학생' }, topicId: 'TOPIC_A' };
const storage = () => {
  const entries = new Map();
  return { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: (key) => entries.delete(key), entries };
};

test('학교 시트·학급·학생 이름·번호·주제별로 초안 저장 공간을 분리한다', async () => {
  const { getDraftOwner, getStudentDraftKey } = await import(moduleUrl);
  const original = getStudentDraftKey(getDraftOwner(ownerArgs));
  for (const changes of [
    { spreadsheetId: 'SHEET_B' }, { classId: 'CLASS_B' }, { topicId: 'TOPIC_B' },
    { student: { number: '2', name: '가학생' } }, { student: { number: '1', name: '나학생' } }
  ]) assert.notEqual(getStudentDraftKey(getDraftOwner({ ...ownerArgs, ...changes })), original);
});

test('입력은 타이머 없이 즉시 기록하며 빈 제목·본문도 최신 초안으로 저장한다', async () => {
  const { getDraftOwner, writeStudentDraft, readStudentDraft } = await import(moduleUrl);
  const owner = getDraftOwner(ownerArgs); const local = storage();
  const first = writeStudentDraft(local, owner, { pieceTitle: '제목', text: '  본문\n\n끝\n', baseKey: 'BASE' }, { expectedId: null, now: 100, id: 'FIRST' });
  assert.equal(readStudentDraft(local, owner).current.text, '  본문\n\n끝\n');
  const second = writeStudentDraft(local, owner, { pieceTitle: '', text: '', baseKey: 'BASE' }, { expectedId: first.current.id, now: 101, id: 'EMPTY' });
  assert.equal(second.current.text, ''); assert.equal(second.current.pieceTitle, '');
  assert.equal(second.history[0].pieceTitle, '제목');
});

test('제목 삭제와 본문 전체 교체 직전의 글을 복구 이력에 보관한다', async () => {
  const { getDraftOwner, writeStudentDraft } = await import(moduleUrl);
  const owner = getDraftOwner(ownerArgs); const local = storage();
  const first = writeStudentDraft(local, owner, { pieceTitle: '원래 제목', text: '기억해 두어야 하는 원래의 긴 문장입니다.', baseKey: 'BASE' }, { id: 'A', now: 10 });
  const second = writeStudentDraft(local, owner, { ...first.current, pieceTitle: '' }, { expectedId: 'A', id: 'B', now: 11 });
  assert.equal(second.history[0].pieceTitle, '원래 제목');
  const third = writeStudentDraft(local, owner, { ...second.current, text: '완전히 다른 내용으로 한 번에 교체한 문장입니다.' }, { expectedId: 'B', id: 'C', now: 12 });
  assert.ok(third.history.some((item) => item.id === 'B'));
});

test('복구할 때 현재 글과 다른 탭의 글을 모두 보관하고 이력을 제한한다', async () => {
  const { getDraftOwner, writeStudentDraft, MAX_DRAFT_HISTORY } = await import(moduleUrl);
  const owner = getDraftOwner(ownerArgs); const local = storage();
  writeStudentDraft(local, owner, { pieceTitle: '다른 탭', text: '다른 창에서 쓴 글', baseKey: 'BASE' }, { id: 'OTHER', now: 1 });
  const recovered = writeStudentDraft(local, owner, { pieceTitle: '복구', text: '복구할 글', baseKey: 'BASE' }, {
    force: true, checkpoint: true, id: 'RESTORED', now: 2,
    preserveSnapshot: { id: 'VISIBLE', savedAt: 1, pieceTitle: '화면의 글', text: '저장 실패로 화면에만 남은 글', baseKey: 'BASE' }
  });
  assert.ok(recovered.history.some((item) => item.id === 'OTHER'));
  assert.ok(recovered.history.some((item) => item.id === 'VISIBLE'));
  let current = recovered;
  for (let index = 0; index < 20; index++) current = writeStudentDraft(local, owner, { pieceTitle: `제목${index}`, text: `문장${index}`, baseKey: 'BASE' }, { expectedId: current.current.id, now: 30000 * (index + 1), id: `ITEM_${index}`, checkpoint: true });
  assert.ok(current.history.length <= MAX_DRAFT_HISTORY);
});

test('다른 탭이 수정한 초안은 자동 저장으로 덮어쓰지 않는다', async () => {
  const { getDraftOwner, writeStudentDraft, readStudentDraft } = await import(moduleUrl);
  const owner = getDraftOwner(ownerArgs); const local = storage();
  writeStudentDraft(local, owner, { pieceTitle: '처음', text: '처음 글', baseKey: 'BASE' }, { id: 'A' });
  writeStudentDraft(local, owner, { pieceTitle: '다른 탭', text: '다른 탭 글', baseKey: 'BASE' }, { expectedId: 'A', id: 'B' });
  assert.throws(() => writeStudentDraft(local, owner, { pieceTitle: '늦은 저장', text: '덮어쓰면 안 됨', baseKey: 'BASE' }, { expectedId: 'A' }), (error) => error.code === 'DRAFT_CONFLICT');
  assert.equal(readStudentDraft(local, owner).current.id, 'B');
});

test('제출 완료는 해당 제출 초안만 정리하고 이후 변경된 글은 유지한다', async () => {
  const { getDraftOwner, writeStudentDraft, archiveSubmittedDraft } = await import(moduleUrl);
  const owner = getDraftOwner(ownerArgs); const local = storage();
  const first = writeStudentDraft(local, owner, { pieceTitle: '제출 제목', text: '제출 본문', baseKey: 'BASE' }, { id: 'A' });
  const done = archiveSubmittedDraft(local, owner, first.current, 'A');
  assert.equal(done.current, null); assert.equal(done.history[0].reason, 'submitted');
  const second = writeStudentDraft(local, owner, { pieceTitle: '새 글', text: '나중에 쓴 글', baseKey: 'BASE' }, { id: 'B' });
  const retry = archiveSubmittedDraft(local, owner, first.current, 'A');
  assert.equal(retry.current.id, second.current.id);
});

test('손상된 저장 자료는 덮어쓰지 않고 예전 초안도 자동 삭제하지 않는다', async () => {
  const { getDraftOwner, getStudentDraftKey, writeStudentDraft, readLegacyStudentDraft } = await import(moduleUrl);
  const owner = getDraftOwner(ownerArgs); const local = storage();
  local.setItem(getStudentDraftKey(owner), '{broken');
  assert.throws(() => writeStudentDraft(local, owner, { pieceTitle: '새 제목', text: '새 내용', baseKey: 'BASE' }));
  assert.equal(local.getItem(getStudentDraftKey(owner)), '{broken');
  const oldKey = 'sseudam_local_draft_1_TOPIC_A';
  local.setItem(oldKey, JSON.stringify({ pieceTitle: '옛 제목', text: '옛 글', savedAt: 1 }));
  assert.equal(readLegacyStudentDraft(local, '1', 'TOPIC_A').text, '옛 글');
  assert.ok(local.getItem(oldKey));
});

test('제출본 지문은 교사 피드백 상태에는 유지되고 실제 제출본 변경에는 달라진다', async () => {
  const { getDraftBase } = await import(moduleUrl);
  const record = { pieceTitle: '제목', draftHistory: [{ text: '글', updatedAtIso: 'TIME_1' }] };
  assert.equal(getDraftBase(record).key, getDraftBase({ ...record, status: 'FEEDBACK_DONE', teacherNote: '조언', updatedAtIso: 'TEACHER_TIME' }).key);
  assert.notEqual(getDraftBase(record).key, getDraftBase({ ...record, draftHistory: [{ text: '수정 글', updatedAtIso: 'TIME_2' }] }).key);
});

test('제출본이 바뀐 뒤 새로 작성해도 이전 제출본에 쓰던 초안을 이력으로 남긴다', async () => {
  const { getDraftOwner, writeStudentDraft } = await import(moduleUrl);
  const owner = getDraftOwner(ownerArgs); const local = storage();
  const previous = writeStudentDraft(local, owner, { pieceTitle: '제목', text: '이전 제출본에 쓰던 글', baseKey: 'BASE_1' }, { id: 'OLD', now: 1 });
  const next = writeStudentDraft(local, owner, { pieceTitle: '제목', text: '다른 제출본에 쓰는 글', baseKey: 'BASE_2' }, { expectedId: previous.current.id, id: 'NEW', now: 2 });
  assert.ok(next.history.some((item) => item.id === 'OLD'));
  assert.equal(next.current.baseKey, 'BASE_2');
});
