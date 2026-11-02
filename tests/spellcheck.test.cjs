const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const load = (file) => import(pathToFileURL(path.join(__dirname, '..', file)).href);

test('검사 요청은 제목과 본문만 허용하고 개인정보와 과도한 글은 거절한다', async () => {
  const { validateSpellcheckInput } = await load('server/spellcheck.js');
  assert.deepEqual(validateSpellcheckInput({ title: '제목', text: '  본문\n\n다음 문단\n' }), { title: '제목', text: '  본문\n\n다음 문단\n' });
  for (const extra of ['name', 'number', 'classId', 'sessionToken', 'teacherNote']) {
    assert.throws(() => validateSpellcheckInput({ title: '', text: '본문', [extra]: '비공개' }), /INVALID_INPUT/);
  }
  assert.throws(() => validateSpellcheckInput({ title: '', text: ' '.repeat(5) }), /EMPTY_INPUT/);
  assert.throws(() => validateSpellcheckInput({ title: '', text: '가'.repeat(10001) }), /TOO_LONG/);
});

test('긴 글은 빈 줄과 들여쓰기, 이모지 위치를 보존하며 제한 크기로 나눈다', async () => {
  const { splitSpellcheckText } = await load('src/utils/spellcheck.js');
  const source = `  ${'가'.repeat(897)}🌱\n\n  다음 문단\n${'나'.repeat(2500)}`;
  const chunks = splitSpellcheckText(source);
  assert.equal(chunks.map((chunk) => chunk.text).join(''), source);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 900);
    assert.equal(source.slice(chunk.start, chunk.start + chunk.text.length), chunk.text);
    assert.ok(!/[\uD800-\uDBFF]$/.test(chunk.text));
  }
});

test('같은 표현도 문맥이 일치하는 한 위치만 선택하고 모호하면 위치를 추측하지 않는다', async () => {
  const { mapSpellcheckSuggestions } = await load('src/utils/spellcheck.js');
  const text = '나는 할수 있어요.\n\n친구도 할수 있어요.';
  const item = { token: '할수', suggestions: ['할 수'], context: '친구도 할수 있어요.' };
  const [issue] = mapSpellcheckSuggestions(text, [item], 'text', 20);
  assert.equal(issue.start, 20 + text.lastIndexOf('할수'));
  assert.equal(mapSpellcheckSuggestions(text, [{ ...item, context: '' }], 'text')[0].start, null);
  assert.deepEqual(mapSpellcheckSuggestions(text, [{ token: '<잘못된 응답>', suggestions: ['다른 말'] }], 'text'), []);
});

test('외부 검사에는 글 조각만 전달하고 결과에 긴 지도 설명을 포함하지 않는다', async () => {
  const { checkWriting } = await load('server/spellcheck.js');
  const calls = [];
  const result = await checkWriting({ title: '제목', text: '나는 할수 있어요.' }, async (...args) => {
    calls.push(args);
    return [{ token: '할수', suggestions: ['할 수'], context: '나는 할수 있어요.', info: '긴 지도 설명' }];
  });
  assert.deepEqual(calls, [['제목'], ['나는 할수 있어요.']]);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].original, '할수');
  assert.ok(!JSON.stringify(result).includes('긴 지도 설명'));
});

test('검사 일부가 실패하면 오류 없음으로 잘못 보고하지 않는다', async () => {
  const { checkWriting } = await load('server/spellcheck.js');
  let count = 0;
  await assert.rejects(checkWriting({ title: '', text: '가'.repeat(1800) }, async () => {
    count += 1;
    if (count === 2) throw new Error('provider failed');
    return [];
  }), /provider failed/);
});

test('학생이 직접 고친 표현은 변경됨으로 남기고 뒤의 표현 위치만 이동시킨다', async () => {
  const { mapSpellcheckSuggestions, rebaseSpellcheckResult } = await load('src/utils/spellcheck.js');
  const text = '나는 할수 있어요.\n\n친구도 할수 있어요.';
  const issues = mapSpellcheckSuggestions(text, [
    { token: '할수', suggestions: ['할 수'], context: '나는 할수 있어요.' },
    { token: '할수', suggestions: ['할 수'], context: '친구도 할수 있어요.' }
  ], 'text');
  const next = rebaseSpellcheckResult({ document: { title: '제목', text }, issues }, { title: '제목', text: text.replace('할수', '할 수') });
  assert.equal(next.issues[0].changed, true);
  assert.equal(next.issues[0].start, null);
  assert.equal(next.issues[1].start, issues[1].start + 1);
  assert.equal(next.dirty, true);
  assert.equal(next.document.text, '나는 할 수 있어요.\n\n친구도 할수 있어요.');
});

test('검사 후 다르게 고치거나 문단 전체를 교체해도 정답으로 판정하지 않는다', async () => {
  const { rebaseSpellcheckResult } = await load('src/utils/spellcheck.js');
  const result = { document: { title: '', text: '할수' }, issues: [{ field: 'text', original: '할수', start: 0, end: 2 }] };
  const next = rebaseSpellcheckResult(result, { title: '', text: '틀린 표현으로 바꿈' });
  assert.equal(next.issues[0].changed, true);
  assert.equal(next.issues[0].start, null);
  assert.equal(next.issues[0].correct, undefined);
});

function request(body, headers = {}) {
  return { method: 'POST', headers: { origin: 'https://sseudam.chorok.app', host: 'sseudam.chorok.app', 'content-type': 'application/json', ...headers }, body };
}
function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.code = code; return this; }, json(value) { this.value = value; return this; } };
}

test('검사 API는 다른 사이트, 잘못된 입력과 요청 방식을 차단한다', async () => {
  const { createSpellcheckHandler } = await load('api/spellcheck.js');
  let calls = 0;
  const handler = createSpellcheckHandler(async () => { calls += 1; return { issues: [] }; });
  for (const [req, expected] of [
    [{ ...request({}), method: 'GET' }, 405],
    [request({ title: '', text: '본문' }, { origin: 'https://other.invalid' }), 403],
    [request({ title: '', text: '본문' }, { origin: '' }), 403],
    [request({ title: '', text: '본문', name: '학생' }), 400],
    [request('{broken'), 400]
  ]) {
    const res = response(); await handler(req, res); assert.equal(res.code, expected);
  }
  assert.equal(calls, 0);
});

test('검사 API는 내용 저장 없이 응답하며 서비스 오류와 같은 반의 동시 사용을 처리한다', async () => {
  const { createSpellcheckHandler } = await load('api/spellcheck.js');
  const received = [];
  const handler = createSpellcheckHandler(async (input) => { received.push(input); return { issues: [] }; });
  for (let index = 0; index < 30; index += 1) {
    const res = response(); await handler(request({ title: '', text: '본문' }), res);
    assert.equal(res.code, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
  assert.equal(received.length, 30);
  const res = response();
  await createSpellcheckHandler(async () => { throw new Error('본문이나 외부 내부 오류'); })(request({ title: '', text: '본문' }), res);
  assert.equal(res.code, 503);
  assert.ok(!JSON.stringify(res.value).includes('외부 내부 오류'));
});
