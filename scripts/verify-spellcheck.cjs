// Disposable student session; spellcheck and school data responses are intercepted.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const student = { classId: 'A', number: '1', name: '가학생', status: 'FEEDBACK_DONE', locked: false,
    pieceTitle: '이전 제목', draft1: '이전 본문', teacherNote: '기존 선생님 첨삭' };
  const topics = [{ id: 'NOW', classId: 'A', title: '검사할 주제', prompt: '주제에 맞게 써 보세요.' }, { id: 'OTHER', classId: 'A', title: '다른 주제' }];
  const config = { activeClassId: 'A', activeTopicId: 'NOW', className: '테스트 반' };
  const state = { classes: [{ id: 'A', className: '테스트 반' }], topics, students: [student], questions: [], config };
  const requests = []; const errors = [];
  let mode = 'normal'; let release;
  await context.addCookies([{ name: 'private-test-cookie', value: 'must-not-send', url: 'http://127.0.0.1:5173' }]);
  await context.route('https://**/*', async (route) => {
    if (!route.request().url().includes('qa-relay.invalid')) return route.abort();
    const payload = JSON.parse(route.request().postData());
    const reply = (value) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
    if (payload.action === 'studentBootstrap') return reply({ ok: true, topics, config });
    if (['studentLogin', 'studentRefresh'].includes(payload.action)) return reply({ ok: true, student, topics, config, sessionToken: 'private-session-token', questions: [] });
    return reply({ ok: false });
  });
  await context.route('**/api/spellcheck', async (route) => {
    const payload = JSON.parse(route.request().postData());
    requests.push({ payload, headers: route.request().headers() });
    if (mode === 'hold') await new Promise((resolve) => { release = resolve; });
    if (mode === 'error') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '지금은 맞춤법 검사에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요.' }) });
    const issues = [];
    for (const field of ['title', 'text']) {
      let start = payload[field].indexOf('할수');
      while (start >= 0) {
        issues.push({ id: `${field}:${start}`, field, start, end: start + 2, original: '할수', suggestions: ['할 수'], changed: false });
        start = payload[field].indexOf('할수', start + 2);
      }
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ issues }) });
  });
  await context.addInitScript((state) => {
    for (const [key, value] of Object.entries(state)) localStorage.setItem(`sseudam_${key}_v7`, JSON.stringify(value));
    localStorage.setItem('sseudam_gas_url_v5', 'https://qa-relay.invalid/exec');
  }, state);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('http://127.0.0.1:5173/?student=1&sheetId=QA_SHEET&classId=A&accessKey=key');
    await page.getByPlaceholder('2', { exact: true }).fill('1');
    await page.getByPlaceholder('이도윤', { exact: true }).fill('가학생');
    await page.getByRole('button', { name: '내 글쓰기 책장 들어가기', exact: true }).click();
    await page.getByRole('heading', { name: '검사할 주제', exact: true }).click();
    const title = page.getByRole('textbox', { name: '작품 제목', exact: true });
    const body = page.getByRole('textbox', { name: '글 본문', exact: true });
    const check = page.getByRole('button', { name: '맞춤법 검사', exact: true });
    const card = page.getByRole('region', { name: '맞춤법 검사 결과', exact: true });
    const selected = async (input, start, end = start + 2) => {
      await page.waitForFunction(({ selector, start, end }) => {
        const element = document.querySelector(selector);
        return element && document.activeElement === element && element.selectionStart === start && element.selectionEnd === end;
      }, { selector: await input.evaluate((element) => `[aria-label="${element.getAttribute('aria-label')}"]`), start, end });
    };
    const original = '  나는 할수 있어요.\n\n친구도 할수 있어요.\n\n끝 문단\n';
    await title.fill('내가 할수 있는 일'); await body.fill(original);
    await page.getByRole('button', { name: '선생님 첨삭 닫기', exact: true }).click();
    await check.click();
    await card.getByText('확인할 표현 3곳', { exact: true }).waitFor();
    assert.deepEqual(Object.keys(requests[0].payload).sort(), ['text', 'title']);
    assert.equal(requests[0].headers.cookie, undefined, 'student cookies are not sent');
    assert.equal(requests[0].payload.text, original);
    assert.equal(await body.inputValue(), original, 'checking never applies corrections');
    const cardBox = await card.boundingBox();
    const teacherBox = await page.getByRole('heading', { name: '선생님 첨삭', exact: true }).boundingBox();
    assert.ok(cardBox.y + cardBox.height <= teacherBox.y, 'result card sits above teacher feedback');
    await page.getByText('기존 선생님 첨삭', { exact: true }).waitFor();
    assert.equal(await card.getByRole('button', { name: /적용|자동|힌트/ }).count(), 0);
    await card.locator('.student-spellcheck-item').nth(1).click();
    await selected(body, original.indexOf('할수'));
    assert.deepEqual(await body.evaluate((input) => [input.selectionStart, input.selectionEnd]), [original.indexOf('할수'), original.indexOf('할수') + 2]);
    await page.keyboard.insertText('할 수');
    await card.getByText('변경됨', { exact: true }).waitFor();
    assert.equal(await body.inputValue(), original.replace('할수', '할 수'));
    await card.locator('.student-spellcheck-item').nth(2).click();
    await selected(body, original.lastIndexOf('할수') + 1);
    assert.deepEqual(await body.evaluate((input) => [input.selectionStart, input.selectionEnd]), [original.lastIndexOf('할수') + 1, original.lastIndexOf('할수') + 3]);
    await page.keyboard.insertText('할 수');
    await card.locator('.student-spellcheck-item').first().click();
    await selected(title, 3);
    assert.deepEqual(await title.evaluate((input) => [input.selectionStart, input.selectionEnd]), [3, 5]);
    await page.keyboard.insertText('할 수');
    await card.getByRole('button', { name: '다시 검사', exact: true }).click();
    await card.getByText('이번 검사에서 확인할 표현을 찾지 못했어요.', { exact: true }).waitFor();

    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByRole('button', { name: '첨삭 패널 닫기', exact: true }).click();
    await body.fill(original); await check.click();
    await card.getByText('확인할 표현 2곳', { exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog', { name: '선생님 첨삭', exact: true }).count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    if (process.env.SPELLCHECK_QA_DIR) await page.screenshot({ path: path.join(process.env.SPELLCHECK_QA_DIR, 'spellcheck-mobile.png'), animations: 'disabled' });
    await card.locator('.student-spellcheck-item').nth(1).click();
    await card.waitFor({ state: 'hidden' });
    await selected(body, original.lastIndexOf('할수'));
    assert.equal(await body.evaluate((input) => document.activeElement === input), true);
    assert.equal(await body.evaluate((input) => input.selectionStart), original.lastIndexOf('할수'));
    assert.equal(await body.inputValue(), original);

    await page.setViewportSize({ width: 1600, height: 1000 });
    mode = 'error'; await check.click();
    await card.getByText(/지금은 맞춤법 검사에 연결할 수 없어요/).waitFor();
    assert.equal(await card.getByText('이번 검사에서 확인할 표현을 찾지 못했어요.', { exact: true }).count(), 0);
    mode = 'hold'; await card.getByRole('button', { name: '다시 검사', exact: true }).click();
    await card.getByText('글을 확인하고 있어요…', { exact: true }).waitFor();
    await body.fill(`새 문장\n${original}`);
    mode = 'normal'; release();
    await card.getByText('검사 후 글이 바뀌었어요. 다 고친 뒤 다시 검사해 주세요.', { exact: true }).waitFor();
    await card.locator('.student-spellcheck-item').last().click();
    await selected(body, original.lastIndexOf('할수') + 5);
    assert.equal(await body.evaluate((input) => input.selectionStart), original.lastIndexOf('할수') + 5);
    if (process.env.SPELLCHECK_QA_DIR) await page.screenshot({ path: path.join(process.env.SPELLCHECK_QA_DIR, 'spellcheck-desktop.png'), fullPage: true, animations: 'disabled' });
    await body.fill(`${'긴 문단입니다.\n\n'.repeat(100)}친구도 할수 있어요.`);
    await check.click();
    await card.getByText('확인할 표현 1곳', { exact: true }).waitFor();
    await card.locator('.student-spellcheck-item').click();
    await selected(body, (await body.inputValue()).lastIndexOf('할수'));
    await page.waitForFunction(() => window.scrollY > 4000);
    mode = 'hold'; await check.click();
    await card.getByText('글을 확인하고 있어요…', { exact: true }).waitFor();
    await page.getByRole('button', { name: '책장으로', exact: true }).click();
    mode = 'normal'; release();
    await page.getByRole('heading', { name: '다른 주제', exact: true }).click();
    assert.equal(await card.count(), 0, 'results cannot leak into another topic');
    assert.deepEqual(errors, []);
    console.log('PASS: results above teacher feedback, text-only requests, no cookies or automatic edits, repeated-word offsets, direct typing, title corrections, paragraph preservation, mobile selection, failed/late requests and topic isolation.');
  } finally { await context.close(); await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
