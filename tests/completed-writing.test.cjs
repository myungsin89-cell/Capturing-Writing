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
  assert.deepEqual(Object.keys(list[0]).sort(), ['number', 'name', 'pieceTitle', 'text', 'completedAt', 'stars'].sort());
  assert.equal(list[0].text, '  첫 문단\n\n두 번째 문단\n');
  assert.deepEqual(getClassCompletedWritings(state, 'A', 'PAST', '1').map((item) => item.text), ['지난 완성 글']);
  assert.throws(() => getClassCompletedWritings(state, 'A', 'OTHER', '1'), /주제/);
});

test('별은 선택 사항이며 새 완성 처리마다 교사가 고른 0~3개만 승인본에 저장한다', async () => {
  const { updateWritingFeedbackRecord, getCompletedWriting } = await helper;
  for (const stars of [0, 1, 2, 3, -1, 4, 1.5]) {
    const next = updateWritingFeedbackRecord(finished({ status: 'REVISION_SUBMITTED' }), { status: 'FINAL_COMPLETED', completionStars: stars });
    assert.equal(getCompletedWriting(next).stars, [0, 1, 2, 3].includes(stars) ? stars : 0);
  }
  const previouslyAwarded = updateWritingFeedbackRecord(finished(), { status: 'FINAL_COMPLETED', completionStars: 3 });
  assert.equal(getCompletedWriting(updateWritingFeedbackRecord(previouslyAwarded, { status: 'FINAL_COMPLETED' })).stars, 0);
});

test('별만 바꾸면 개인 수정은 공개하지 않고 승인본·완성 시점·잠금 상태를 유지한다', async () => {
  const { updateWritingFeedbackRecord, updateCompletedWritingStars, getCompletedWriting, isCompletedResubmission } = await helper;
  const approved = updateWritingFeedbackRecord(finished(), { status: 'FINAL_COMPLETED', completionStars: 1, updatedAtIso: 'approved' });
  const personal = { ...approved, pieceTitle: '개인 수정 제목', draftHistory: [{ text: '혼자 다듬는 중' }] };
  const awarded = updateCompletedWritingStars(personal, 3, 'stars-updated');
  assert.equal(getCompletedWriting(awarded).text, getCompletedWriting(approved).text);
  assert.equal(getCompletedWriting(awarded).completedAt, 'approved');
  assert.equal(getCompletedWriting(awarded).stars, 3);
  assert.equal(awarded.status, 'FINAL_COMPLETED');
  assert.equal(awarded.locked, personal.locked);
  const submitted = { ...awarded, status: 'REVISION_SUBMITTED' };
  assert.equal(isCompletedResubmission(submitted), true);
  assert.equal(getCompletedWriting(submitted).stars, 3);
  assert.equal(updateCompletedWritingStars(submitted, 2, 'bad'), null);
  assert.equal(isCompletedResubmission({ status: 'REVISION_SUBMITTED', draft1: '초안' }), false);
});

test('이전 중계기가 승인본의 별 필드를 생략해도 별을 복원하고 새 주제에는 섞지 않는다', async () => {
  const { getCompletedWriting } = await helper;
  const { transitionStudentToNewTopic } = await transition;
  const student = finished({ completionStars: 2, completedWriting: { text: '승인 본문', pieceTitle: '승인 제목', completedAt: 'approved' } });
  assert.equal(getCompletedWriting(student).stars, 2);
  const next = transitionStudentToNewTopic(student, { previousTopicId: 'OLD', classId: 'A' });
  assert.equal(next.completionStars, undefined);
  assert.equal(getCompletedWriting(next), null);
  assert.equal(getCompletedWriting(next.historyByTopic.OLD).stars, 2);
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
