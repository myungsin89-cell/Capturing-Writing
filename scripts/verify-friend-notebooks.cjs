// Disposable browser contexts and intercepted responses; never uses a live account.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const now = new Date().toISOString();
  const topics = [
    { id: 'NOW', classId: 'A', title: '함께 쓰는 주제', isActive: true },
    { id: 'OLD', classId: 'A', title: '지난 주제' },
    { id: 'EMPTY', classId: 'A', title: '아직 완성 글 없는 주제' }
  ];
  const state = {
    classes: [{ id: 'A', className: '테스트 반' }], topics,
    students: [
      { classId: 'A', number: '1', name: '가학생', status: 'STAGE_1_WRITING', locked: false, pieceTitle: '', draft1: '' },
      { classId: 'A', number: '2', name: '나학생', status: 'FINAL_COMPLETED', locked: true, pieceTitle: '친구 완성 제목', draft1: '  첫 문단\n\n두 번째 문단\n', teacherNote: '비공개 첨삭', historyByTopic: { OLD: { status: 'FINAL_COMPLETED', pieceTitle: '지난 작품', draft1: '지난 본문' } } },
      { classId: 'A', number: '3', name: '다학생', status: 'STAGE_1_SUBMITTED', locked: true, pieceTitle: '요청한 글', draft1: '선생님 확인 요청', updatedAtIso: now },
      { classId: 'A', number: '4', name: '라학생', status: 'FEEDBACK_DONE', locked: false, pieceTitle: '고치는 글', draft1: '비공개 초안' },
      { classId: 'A', number: '5', name: '마학생', status: 'REVISION_SUBMITTED', locked: true, pieceTitle: '비공개 수정 중', draft1: '비공개 새 본문', completedWriting: { pieceTitle: '이전 승인 제목', text: '이전 승인 본문' } }
    ], questions: [], config: { activeClassId: 'A', activeTopicId: 'NOW', className: '테스트 반', classAccessKeys: { A: 'key' } }
  };
  const errors = [];
  const contexts = [];
  const makeContext = async (student = false) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    contexts.push(context);
    await context.route('https://**/*', async (route) => {
      const url = route.request().url();
      const reply = (value) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
      if (url.includes('/gviz/tq')) return route.fulfill({ body: `google.visualization.Query.setResponse(${JSON.stringify({ table: { rows: Object.entries(state).map(([key, value]) => ({ c: [{ v: key }, { v: JSON.stringify(value) }] })) } })});` });
      if (url.includes('qa-relay.invalid')) {
        const payload = JSON.parse(route.request().postData());
        if (payload.action === 'studentBootstrap') return reply({ ok: true, topics, config: state.config });
        if (['studentLogin', 'studentRefresh'].includes(payload.action)) return reply({ ok: true, student: state.students[0], topics, config: state.config, sessionToken: 'opaque-old-gas-session', questions: [] });
        return reply({ ok: false, error: '지원하지 않는 요청입니다.' });
      }
      return route.abort();
    });
    await context.addInitScript(({ state, student }) => {
      for (const [key, value] of Object.entries(state)) localStorage.setItem(`sseudam_${key}_v7`, JSON.stringify(value));
      if (student) localStorage.setItem('sseudam_gas_url_v5', 'https://qa-relay.invalid/exec');
      else localStorage.setItem('sseudam_google_auth_v1', JSON.stringify({ accessToken: 'qa-token', expiresAt: Date.now() + 86400000, user: { email: 'qa@example.invalid' } }));
      localStorage.setItem('sseudam_teacher_step_v4', 'bookshelf');
    }, { state, student });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    return page;
  };
  try {
    const teacher = await makeContext();
    await teacher.goto('http://127.0.0.1:5173');
    await teacher.getByRole('heading', { name: '함께 쓰는 주제', exact: true }).click();
    const send = teacher.getByRole('button', { name: '첨삭 보내고 수정 열기', exact: true });
    const roster = teacher.getByRole('region', { name: '우리 반 학생 명단', exact: true });
    const select = (name) => roster.getByRole('button').filter({ hasText: name }).click();
    await select('가학생'); assert.equal(await send.isDisabled(), true);
    await teacher.getByLabel('선생님의 종합 첨삭 노트', { exact: true }).fill('미요청 글 조언');
    assert.equal(await send.isDisabled(), true);
    await teacher.locator('form').last().evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(await send.isDisabled(), true);
    await select('라학생'); assert.equal(await send.isDisabled(), true);
    await select('다학생'); assert.equal(await send.isEnabled(), true);
    await teacher.getByLabel('선생님의 종합 첨삭 노트', { exact: true }).fill('다정한 조언');
    await send.click();
    await send.waitFor({ state: 'visible' });
    assert.equal(await send.isDisabled(), true);
    await select('나학생');
    assert.equal(await teacher.getByRole('button', { name: '수정 다시 열기', exact: true }).count(), 0);

    const student = await makeContext(true);
    await student.goto('http://127.0.0.1:5173/?student=1&sheetId=QA_SHEET&classId=A&accessKey=key');
    await student.getByPlaceholder('2', { exact: true }).fill('1');
    await student.getByPlaceholder('이도윤', { exact: true }).fill('가학생');
    await student.getByRole('button', { name: '내 글쓰기 책장 들어가기', exact: true }).click();
    await student.getByRole('heading', { name: '함께 쓰는 주제', exact: true }).click();
    await student.getByRole('textbox', { name: '작품 제목', exact: true }).fill('보존할 내 제목');
    await student.getByRole('textbox', { name: '글 본문', exact: true }).fill('내가 작성하던 문단\n\n이어 쓰는 중');
    await student.getByRole('button', { name: '친구 완성 글 보기', exact: true }).click();
    await student.getByRole('heading', { name: '친구 완성 제목', exact: true }).click();
    const notebook = student.getByRole('region', { name: '친구 완성 공책', exact: true });
    assert.equal(await notebook.locator('.manuscript-body').textContent(), '  첫 문단\n\n두 번째 문단\n');
    assert.equal(await student.getByText('비공개 첨삭', { exact: true }).count(), 0);
    assert.equal(await student.getByRole('textbox').count(), 0);
    assert.equal(await student.getByText('비공개 수정 중', { exact: true }).count(), 0);
    assert.equal(await notebook.getByRole('button', { name: '이전 공책', exact: true }).isDisabled(), true);
    await notebook.getByRole('button', { name: '다음 공책', exact: true }).click();
    await notebook.getByRole('heading', { name: '이전 승인 제목', exact: true }).waitFor();
    assert.equal(await notebook.locator('.manuscript-body').textContent(), '이전 승인 본문');
    assert.equal(await notebook.getByRole('button', { name: '다음 공책', exact: true }).isDisabled(), true);
    await notebook.getByRole('button', { name: '이전 공책', exact: true }).click();
    for (const width of [1440, 390]) {
      await student.setViewportSize({ width, height: 1000 });
      assert.ok(await student.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      if (process.env.FRIEND_NOTEBOOK_QA_DIR) await student.screenshot({ path: require('node:path').join(process.env.FRIEND_NOTEBOOK_QA_DIR, `friend-notebook-${width}.png`), fullPage: true });
    }
    await student.getByRole('button', { name: '내 노트로 돌아가기', exact: true }).click();
    assert.equal(await student.getByRole('textbox', { name: '작품 제목', exact: true }).inputValue(), '보존할 내 제목');
    assert.equal(await student.getByRole('textbox', { name: '글 본문', exact: true }).inputValue(), '내가 작성하던 문단\n\n이어 쓰는 중');
    await student.getByRole('button', { name: '책장으로', exact: true }).click();
    await student.getByRole('heading', { name: '지난 주제', exact: true }).click();
    await student.getByRole('button', { name: '친구 완성 글 보기', exact: true }).click();
    await student.getByRole('heading', { name: '지난 작품', exact: true }).waitFor();
    assert.equal(await student.getByRole('heading', { name: '친구 완성 제목', exact: true }).count(), 0);
    await student.getByRole('button', { name: '내 노트로 돌아가기', exact: true }).click();
    await student.getByRole('button', { name: '책장으로', exact: true }).click();
    await student.getByRole('heading', { name: '아직 완성 글 없는 주제', exact: true }).click();
    await student.getByRole('button', { name: '친구 완성 글 보기', exact: true }).click();
    await student.getByText('아직 이 주제에서 완성한 친구 글이 없어요.', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: request-only feedback, old-relay fallback, topic-specific notebooks, paragraphs, read-only, draft preservation, empty list, mobile overflow.');
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
