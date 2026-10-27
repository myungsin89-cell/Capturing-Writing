const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '../src/utils/questionHelper.js')).href;

test('질문 배지와 질문 카드는 현재 주제 질문만 같은 기준으로 표시한다', async () => {
  const { questionBelongsToTopic } = await import(moduleUrl);

  assert.equal(questionBelongsToTopic({ topicId: 'TOPIC_A' }, 'TOPIC_A'), true);
  assert.equal(questionBelongsToTopic({ topicId: 'TOPIC_B' }, 'TOPIC_A'), false);
  assert.equal(questionBelongsToTopic({ topicId: 1 }, '1'), true);
});

test('주제 정보가 없던 예전 질문도 교사 화면에서 사라지지 않는다', async () => {
  const { questionBelongsToTopic } = await import(moduleUrl);

  assert.equal(questionBelongsToTopic({}, 'TOPIC_A'), true);
  assert.equal(questionBelongsToTopic({ topicId: 'TOPIC_A' }, ''), true);
});
