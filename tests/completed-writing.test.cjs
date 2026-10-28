const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const helper = import(pathToFileURL(path.join(__dirname, '../src/utils/batchFeedback.js')).href);
const transition = import(pathToFileURL(path.join(__dirname, '../src/utils/topicTransition.js')).href);

const finished = (overrides = {}) => ({
  classId: 'A', number: '2', name: '나학생', status: 'FINAL_COMPLETED',
  pieceTitle: '완성 제목', draftHistory: [{ text: '  첫 문단\n\n두 번째 문단\n', pieceTitle: '완성 제목' }],
  teacherNote: '비공개 첨삭', feedbackItems: [{ comment: '비공개' }], docId: 'private-doc', ...overrides
});

test('친구 공책에는 해당 학급·주제의 완성 작품만 최소 필드로 공개한다', async () => {
  const { getClassCompletedWritings } = await helper;
  const state = {
    classes: [{ id: 'A' }, { id: 'B' }], config: {},
    topics: [{ id: 'NOW', classId: 'A', isActive: true }, { id: 'PAST', classId: 'A' }, { id: 'OTHER', classId: 'B', isActive: true }],
    students: [finished({ number: '1' }), finished(), finished({ number: '3', status: 'FEEDBACK_DONE' }),
      finished({ number: '4', classId: 'B' }), finished({ number: '5', historyByTopic: { PAST: { status: 'FINAL_COMPLETED', draft1: '지난 완성 글', pieceTitle: '지난 제목' } } })]
  };
  const list = getClassCompletedWritings(state, 'A', 'NOW', '1');
  assert.deepEqual(list.map((writing) => writing.number), ['2', '5']);
  assert.deepEqual(Object.keys(list[0]).sort(), ['number', 'name', 'pieceTitle', 'text', 'completedAt'].sort());
  assert.equal(list[0].text, '  첫 문단\n\n두 번째 문단\n');
  assert.deepEqual(getClassCompletedWritings(state, 'A', 'PAST', '1').map((item) => item.text), ['지난 완성 글']);
  assert.throws(() => getClassCompletedWritings(state, 'A', 'OTHER', '1'), /주제/);
});

test('완성 처리 시 승인 본문을 보관하고 개인 수정·첨삭 요청 중에도 이전 완성본을 공개한다', async () => {
  const { updateWritingFeedbackRecord, getCompletedWriting, preserveCompletedWriting } = await helper;
  const first = updateWritingFeedbackRecord(finished({ status: 'REVISION_SUBMITTED' }), { status: 'FINAL_COMPLETED', updatedAtIso: 'approved' });
  assert.equal(first.completedWriting.completedAt, 'approved');
  const revised = { ...preserveCompletedWriting(first), status: 'REVISION_SUBMITTED', pieceTitle: '미완성 제목', draftHistory: [{ text: '아직 쓰는 글' }] };
  assert.equal(getCompletedWriting(revised).text, '  첫 문단\n\n두 번째 문단\n');
  const again = updateWritingFeedbackRecord(revised, { status: 'FINAL_COMPLETED', updatedAtIso: 'approved-again' });
  assert.equal(getCompletedWriting(again).text, '아직 쓰는 글');
  assert.equal(getCompletedWriting(again).pieceTitle, '미완성 제목');
  assert.equal(preserveCompletedWriting(finished()).completedWriting.text, '  첫 문단\n\n두 번째 문단\n');
});

test('새 주제에 완성 작품을 섞지 않고 이전 주제에 보관한다', async () => {
  const { preserveCompletedWriting } = await helper;
  const { transitionStudentToNewTopic } = await transition;
  const student = preserveCompletedWriting(finished());
  const next = transitionStudentToNewTopic(student, { previousTopicId: 'OLD', classId: 'A' });
  assert.equal(next.completedWriting, undefined);
  assert.deepEqual(next.historyByTopic.OLD.completedWriting, student.completedWriting);
});

test('기존 완료 자료도 교사 접속 시 주제별 승인본을 한 번만 보관한다', async () => {
  const { preserveStudentCompletedWritings } = await helper;
  const student = finished({ historyByTopic: { OLD: { status: 'FINAL_COMPLETED', draft1: '지난 완성 글' }, DRAFT: { status: 'FEEDBACK_DONE', draft1: '미완성' } } });
  const next = preserveStudentCompletedWritings(student);
  assert.equal(next.completedWriting.text, '  첫 문단\n\n두 번째 문단\n');
  assert.equal(next.historyByTopic.OLD.completedWriting.text, '지난 완성 글');
  assert.equal(next.historyByTopic.DRAFT.completedWriting, undefined);
  assert.equal(preserveStudentCompletedWritings(next), next);
});
