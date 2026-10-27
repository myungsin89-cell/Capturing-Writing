const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '../src/utils/topicTransition.js')).href;

test('새 주제는 빈 1차 공책으로 시작하고 이전 주제에는 모든 차수를 보관한다', async () => {
  const { transitionStudentToNewTopic } = await import(moduleUrl);
  const previousHistory = [
    { round: 1, text: '첫 글' },
    { round: 2, text: '고친 글' }
  ];
  const next = transitionStudentToNewTopic({
    number: '1', name: '가학생', status: 'FINAL_COMPLETED', locked: true,
    pieceTitle: '이전 제목', draft1: '첫 글', draft2: '고친 글', draftHistory: previousHistory,
    teacherNote: '좋아요', feedbackItems: [{ quote: '고친 글' }], recalled: true,
    historyByTopic: { OLDER: { draft1: '더 옛날 글' } }
  }, { previousTopicId: 'PREVIOUS', classId: 'CLASS_A', nowIso: 'NOW' });

  assert.deepEqual(next.draftHistory, []);
  assert.equal(next.draft1, '');
  assert.equal(next.draft2, '');
  assert.equal(next.pieceTitle, '');
  assert.equal(next.status, 'STAGE_1_WRITING');
  assert.equal(next.locked, false);
  assert.equal('recalled' in next, false);
  assert.deepEqual(next.historyByTopic.PREVIOUS.draftHistory, previousHistory);
  assert.equal(next.historyByTopic.PREVIOUS.pieceTitle, '이전 제목');
  assert.equal(next.historyByTopic.OLDER.draft1, '더 옛날 글');
});

test('이미 꼬인 빈 새 주제에서는 남아 있는 이전 draftHistory를 사용하지 않는다', async () => {
  const { getUsableDraftHistory, isFreshTopicRecord, repairLeakedDraftHistory } = await import(moduleUrl);
  const storageUrl = pathToFileURL(path.join(__dirname, '../src/utils/studentDraftStorage.js')).href;
  const { getDraftBase } = await import(storageUrl);
  const corrupted = {
    status: 'STAGE_1_WRITING', locked: false, pieceTitle: '', draft1: '', draft2: '',
    draftHistory: [{ round: 1, text: '이전 주제 글' }, { round: 2, text: '이전 주제 수정본' }]
  };
  assert.equal(isFreshTopicRecord(corrupted), true);
  assert.deepEqual(getUsableDraftHistory(corrupted), []);
  assert.deepEqual(getDraftBase(corrupted), {
    key: JSON.stringify([0, '', '', '']), text: '', pieceTitle: ''
  });

  const recalled = { ...corrupted, recalled: true };
  assert.equal(isFreshTopicRecord(recalled), false);
  assert.equal(getUsableDraftHistory(recalled).length, 2);

  const repaired = repairLeakedDraftHistory({
    ...corrupted,
    historyByTopic: { PREVIOUS: { pieceTitle: '이전 제목', draft1: '이전 주제 글' } }
  }, 'PREVIOUS');
  assert.deepEqual(repaired.draftHistory, []);
  assert.equal(repaired.historyByTopic.PREVIOUS.draftHistory.length, 2);
  assert.equal(repaired.historyByTopic.PREVIOUS.draftHistory[1].text, '이전 주제 수정본');
});
