// Disposable profiles and intercepted student APIs only. No real student or Google data.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const APP = process.env.APP_URL || 'http://127.0.0.1:5174';
const OUT = process.env.STUDENT_DRAFT_QA_DIR || process.cwd();
const PREFIX = 'sseudam_local_draft_v2:';
const results = [];
const fixture = () => ({
  student: { classId: 'DRAFT_CLASS', number: '1', name: '확인학생', status: 'STAGE_1_WRITING', locked: false, pieceTitle: '', draft1: '', historyByTopic: {} },
  topics: [{ id: 'DRAFT_A', classId: 'DRAFT_CLASS', title: '초안 검증 A', isActive: true }, { id: 'DRAFT_B', classId: 'DRAFT_CLASS', title: '초안 검증 B', isActive: false }],
  config: { activeClassId: 'DRAFT_CLASS', activeTopicId: 'DRAFT_A', className: '초안 검증 학급' },
  submitOk: false
});
const editor = (page) => page.getByPlaceholder('여기에 글을 시작해 주세요.', { exact: true });
const title = (page) => page.getByRole('textbox', { name: '작품 제목', exact: true });
const back = async (page) => { await page.getByRole('button', { name: '내 글쓰기 책장으로', exact: true }).click(); await page.getByRole('heading', { name: '초안 검증 A', exact: true }).waitFor(); };
const open = async (page, topic = '초안 검증 A') => { await page.getByRole('heading', { name: topic, exact: true }).click(); await editor(page).waitFor(); };
const waitText = (page, text) => page.waitForFunction((value) => document.querySelector('textarea[placeholder="여기에 글을 시작해 주세요."]')?.value === value, text);
const login = async (page, state) => { await page.getByPlaceholder('2', { exact: true }).fill('1'); await page.getByPlaceholder('이도윤', { exact: true }).fill(state.student.name); await page.getByRole('button', { name: '내 글쓰기 책장 들어가기', exact: true }).click(); await page.getByRole('heading', { name: '초안 검증 A', exact: true }).waitFor(); };
const bundles = (page) => page.evaluate((prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)).map((key) => JSON.parse(localStorage.getItem(key))), PREFIX);

async function setup(browser, initial = fixture()) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const state = structuredClone(initial);
  const pageErrors = [];
  context.on('page', (tab) => { tab.on('pageerror', (error) => pageErrors.push(error.message)); tab.on('dialog', (dialog) => dialog.accept()); });
  page.on('pageerror', (error) => pageErrors.push(error.message)); page.on('dialog', (dialog) => dialog.accept());
  await context.addInitScript(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (window.qaBlockDraftStorage && key.startsWith('sseudam_local_draft_')) throw new DOMException('Storage test', 'QuotaExceededError');
      return write.call(this, key, value);
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.qaCopiedDraft = text; } } });
  });
  await context.route('https://**/*', async (route) => {
    if (!route.request().url().startsWith('https://student-draft-test.invalid/gas')) return route.abort();
    const payload = JSON.parse(route.request().postData() || '{}');
    let data = { ok: true, topics: state.topics, config: state.config };
    if (payload.action === 'studentLogin' || payload.action === 'studentRefresh') data = { ...data, student: state.student, questions: [], sessionToken: 'DRAFT_TEST_SESSION' };
    if (payload.action === 'submitStage') {
      if (!state.submitOk) data = { ok: false, error: '검증용 제출 실패' };
      else {
        state.student = { ...state.student, pieceTitle: payload.pieceTitle, draft1: payload.text, draftHistory: [{ text: payload.text, pieceTitle: payload.pieceTitle, updatedAtIso: new Date().toISOString() }], status: 'STAGE_1_SUBMITTED', locked: true };
        data = { ok: true, student: state.student };
      }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await context.route(`${APP}/student-draft-test-away`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>다른 페이지</title>' }));
  const url = `${APP}/?student=1&sheetId=DRAFT_SHEET&classId=DRAFT_CLASS&gasUrl=${encodeURIComponent('https://student-draft-test.invalid/gas')}`;
  await page.goto(url); await login(page, state); await open(page); await waitText(page, state.student.draft1 || '');
  return { context, page, state, url, pageErrors };
}
async function run(browser, name, action, initial) {
  const session = await setup(browser, initial);
  try { await action(session); assert.deepEqual(session.pageErrors, []); results.push(name); }
  catch (error) { await session.page.screenshot({ path: path.join(OUT, 'student-draft-failure.png'), fullPage: true }); throw new Error(`${name}: ${error.stack}`); }
  finally { await session.context.close(); }
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined });
  try {
    await run(browser, '입력 직후 책장·다른 주제·새로고침·외부 페이지 이동 복구', async ({ page, url }) => {
      await title(page).fill('즉시 보관 제목'); await editor(page).fill('  첫 문단\n\n마지막 문장\n');
      assert.equal((await bundles(page))[0].current.text, '  첫 문단\n\n마지막 문장\n');
      await back(page); await open(page, '초안 검증 B'); await waitText(page, '');
      await title(page).fill('B 제목'); await editor(page).fill('다른 주제의 글'); await back(page); await open(page); await waitText(page, '  첫 문단\n\n마지막 문장\n');
      await editor(page).fill('방금 덧붙인 마지막 문장'); await page.reload(); await open(page); await waitText(page, '방금 덧붙인 마지막 문장');
      await editor(page).fill('사이트 이동 직전 입력'); await page.goto(`${APP}/student-draft-test-away`); await page.goto(url); await open(page); await waitText(page, '사이트 이동 직전 입력');
      await page.getByText('이 기기에 보관한 임시 글을 자동으로 불러왔어요.', { exact: true }).waitFor();
    });
    await run(browser, '삭제한 빈 글도 복원하고 이전 글·복구 전 글을 다시 복구', async ({ page }) => {
      const original = '처음에 정성스럽게 쓴 글입니다.\n\n내 생각이 담겨 있어요.';
      const newer = '나중에 다르게 쓴 글입니다. 다른 내용도 지켜 주세요.';
      await title(page).fill('원래 제목'); await editor(page).fill(original); await back(page); await open(page); await waitText(page, original);
      await title(page).fill(''); await editor(page).fill(''); await page.reload(); await open(page); await waitText(page, ''); assert.equal(await title(page).inputValue(), '');
      await title(page).fill('지금 제목'); await editor(page).fill(newer);
      await page.getByRole('button', { name: '이전 글 복구', exact: true }).click();
      const modal = page.getByRole('dialog', { name: '이전 글 복구', exact: true });
      await modal.getByRole('button').filter({ hasText: `원래 제목 · ${original.length}자` }).click();
      await modal.getByRole('button', { name: '선택한 글로 복구', exact: true }).click(); await waitText(page, original);
      assert.equal(await title(page).inputValue(), '원래 제목');
      await page.getByRole('button', { name: '이전 글 복구', exact: true }).click();
      await modal.getByRole('button').filter({ hasText: `지금 제목 · ${newer.length}자` }).click();
      await page.screenshot({ path: path.join(OUT, 'student-draft-recovery-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 375, height: 812 });
      assert.equal(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth), true);
      const bounds = await modal.getByRole('button', { name: '선택한 글로 복구', exact: true }).boundingBox(); assert.ok(bounds.y + bounds.height <= 812);
      await page.screenshot({ path: path.join(OUT, 'student-draft-recovery-mobile.png'), fullPage: true });
      await modal.getByRole('button', { name: '선택한 글로 복구', exact: true }).click(); await waitText(page, newer);
      await page.reload(); await open(page); await waitText(page, newer);
    });
    await run(browser, '번호가 같아도 다른 학생의 글은 자동 복원하지 않음', async ({ page, state }) => {
      await title(page).fill('앞 학생 제목'); await editor(page).fill('앞 학생만 보관할 글'); await back(page);
      await page.getByRole('button', { name: '다른 번호로 입장하기', exact: true }).click();
      state.student = { ...state.student, name: '다른학생' }; await login(page, state); await open(page); await waitText(page, '');
      assert.equal(await title(page).inputValue(), ''); assert.equal((await bundles(page)).length, 1);
    });
    await run(browser, '저장 실패 표시·이동 차단·복사 및 재시도', async ({ page }) => {
      await title(page).fill('제목'); await editor(page).fill('이전 저장 글');
      await page.evaluate(() => { window.qaBlockDraftStorage = true; }); await editor(page).fill('저장에 실패한 마지막 글');
      await page.getByRole('alert').filter({ hasText: '이 기기에 저장하지 못했어요.' }).waitFor();
      assert.equal(await page.getByText(/기기에 저장됨/).count(), 0);
      await page.getByRole('button', { name: '내 글쓰기 책장으로', exact: true }).click(); assert.equal(await editor(page).inputValue(), '저장에 실패한 마지막 글');
      await page.getByRole('button', { name: '지금 글 복사', exact: true }).click(); assert.match(await page.evaluate(() => window.qaCopiedDraft), /저장에 실패한 마지막 글/);
      const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '글 파일로 보관', exact: true }).click(); const download = await downloadEvent; assert.ok(download.suggestedFilename().endsWith('.txt')); await download.cancel();
      await page.evaluate(() => { window.qaBlockDraftStorage = false; }); await page.getByRole('button', { name: '저장 다시 시도', exact: true }).click();
      await page.getByText(/기기에 저장됨/).waitFor(); await page.reload(); await open(page); await waitText(page, '저장에 실패한 마지막 글');
    });
    await run(browser, '제출 실패는 초안을 유지하고 성공은 제출본만 이력으로 정리', async ({ page, state }) => {
      await title(page).fill('제출 제목'); await editor(page).fill('제출할 본문');
      await page.getByRole('button', { name: /다 썼어요! 선생님께 제출하기/ }).click(); await page.getByText('검증용 제출 실패', { exact: true }).waitFor();
      assert.equal((await bundles(page))[0].current.text, '제출할 본문'); state.submitOk = true;
      await page.getByRole('button', { name: /다 썼어요! 선생님께 제출하기/ }).click(); await page.getByText('선생님께 내 글을 제출했어요!', { exact: true }).waitFor();
      const bundle = (await bundles(page))[0]; assert.equal(bundle.current, null); assert.ok(bundle.history.some((item) => item.text === '제출할 본문'));
      await page.getByRole('button', { name: '이전 글 복구', exact: true }).click(); assert.equal(await page.getByRole('button', { name: '선택한 글로 복구', exact: true }).isDisabled(), true);
    });
    await run(browser, '이전 방식 초안은 확인 후 수동 복구하고 원본을 보존', async ({ page }) => {
      const legacy = { pieceTitle: '예전 제목', text: '예전 방식으로 보관한 소중한 글', savedAt: Date.now() - 10000 };
      await page.evaluate((value) => localStorage.setItem('sseudam_local_draft_1_DRAFT_A', JSON.stringify(value)), legacy);
      await page.reload(); await open(page); await waitText(page, '');
      await page.getByRole('button', { name: '이전 글 복구', exact: true }).click();
      const modal = page.getByRole('dialog', { name: '이전 글 복구', exact: true }); await modal.getByText('예전에 임시 보관한 글 확인', { exact: true }).click();
      assert.equal(await modal.getByRole('button', { name: '확인하고 미리보기', exact: true }).isDisabled(), true);
      await modal.getByRole('checkbox', { name: '이 기기에서 내가 작성하던 글이 맞아요', exact: true }).check(); await modal.getByRole('button', { name: '확인하고 미리보기', exact: true }).click();
      await modal.getByRole('button', { name: '선택한 글로 복구', exact: true }).click(); await waitText(page, legacy.text);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sseudam_local_draft_1_DRAFT_A')).text), legacy.text);
    });
    await run(browser, '여러 탭의 수정 충돌을 알리고 복구 전 두 글을 모두 보관', async ({ page, context, url, state }) => {
      await title(page).fill('처음 제목'); await editor(page).fill('첫 번째 창의 초기 글'); await back(page); await open(page); await waitText(page, '첫 번째 창의 초기 글');
      const second = await context.newPage(); await second.goto(url); await login(second, state); await open(second); await waitText(second, '첫 번째 창의 초기 글');
      await editor(second).fill('두 번째 창에서 쓴 글');
      await page.getByRole('alert').filter({ hasText: '다른 창' }).waitFor(); await editor(page).fill('첫 번째 창의 저장되지 않은 글');
      assert.equal((await bundles(page))[0].current.text, '두 번째 창에서 쓴 글');
      await page.getByRole('button', { name: '이전 글 복구', exact: true }).click();
      const modal = page.getByRole('dialog', { name: '이전 글 복구', exact: true });
      await modal.getByRole('button').filter({ hasText: '두 번째 창에서 쓴 글' }).click();
      await modal.getByRole('button', { name: '선택한 글로 복구', exact: true }).click(); await waitText(page, '두 번째 창에서 쓴 글');
      const bundle = (await bundles(page))[0]; assert.ok(bundle.history.some((item) => item.text === '첫 번째 창의 저장되지 않은 글')); assert.ok(bundle.history.some((item) => item.text === '두 번째 창에서 쓴 글'));
    });
    await run(browser, '새 제출본과 다른 초안은 자동 덮어쓰기 없이 확인 후 복구', async ({ page, state }) => {
      await title(page).fill('이 기기의 제목'); await editor(page).fill('이 기기에서 작성하던 미제출 글');
      state.student = { ...state.student, pieceTitle: '새 제출 제목', draft1: '다른 기기에서 제출한 새로운 글', draftHistory: [{ pieceTitle: '새 제출 제목', text: '다른 기기에서 제출한 새로운 글', updatedAtIso: new Date().toISOString() }], status: 'FEEDBACK_DONE', locked: false };
      await page.reload(); await open(page); await waitText(page, '다른 기기에서 제출한 새로운 글');
      await page.getByText('제출된 글과 다른 임시 글이 있어요. ‘이전 글 복구’에서 확인해 주세요.', { exact: true }).waitFor();
      await page.getByRole('button', { name: '이전 글 복구', exact: true }).click();
      const modal = page.getByRole('dialog', { name: '이전 글 복구', exact: true });
      await modal.getByRole('button').filter({ hasText: '이 기기에서 작성하던 미제출 글' }).click();
      await modal.getByRole('button', { name: '선택한 글로 복구', exact: true }).click(); await waitText(page, '이 기기에서 작성하던 미제출 글');
      assert.ok((await bundles(page))[0].history.some((item) => item.text === '다른 기기에서 제출한 새로운 글'));
    });
    const completed = fixture(); Object.assign(completed.student, { status: 'FINAL_COMPLETED', locked: true, pieceTitle: '완성 제목', draft1: '완성했던 글' });
    await run(browser, '완성 후 이어 쓰던 미제출 초안도 편집 모드로 복원', async ({ page }) => {
      await page.getByRole('button', { name: '이어서 더 고쳐 쓰기', exact: true }).click(); await editor(page).fill('완성 후 더 다듬는 글');
      await page.reload(); await open(page); await waitText(page, '완성 후 더 다듬는 글'); await page.waitForFunction(() => !document.querySelector('textarea[placeholder="여기에 글을 시작해 주세요."]')?.disabled);
    }, completed);
    console.log(JSON.stringify({ passed: true, scenarios: results.length, checks: results }));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
