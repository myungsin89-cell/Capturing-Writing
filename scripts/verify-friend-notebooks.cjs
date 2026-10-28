// Disposable browser contexts and intercepted responses; never uses a live account.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const now = new Date().toISOString();
  const topics = [
    { id: 'NOW', classId: 'A', title: '함께 쓰는 주제', prompt: '우리 반에서 해결하고 싶은 문제를 설명하세요.\n문제를 해결할 방법과 그 이유를 구체적으로 써 보세요.', isActive: true },
    { id: 'OLD', classId: 'A', title: '지난 주제' },
    { id: 'EMPTY', classId: 'A', title: '아직 완성 글 없는 주제' }
  ];
  const state = {
    classes: [{ id: 'A', className: '테스트 반' }], topics,
    students: [
      { classId: 'A', number: '1', name: '가학생', status: 'STAGE_1_WRITING', locked: false, pieceTitle: '', draft1: '' },
      { classId: 'A', number: '2', name: '나학생', status: 'FINAL_COMPLETED', locked: true, pieceTitle: '친구 완성 제목', draft1: '  첫 문단\n\n두 번째 문단\n', teacherNote: '비공개 첨삭', historyByTopic: { OLD: { status: 'FINAL_COMPLETED', pieceTitle: '지난 작품', draft1: '지난 본문' } } },
      { classId: 'A', number: '3', name: '다학생', status: 'STAGE_1_SUBMITTED', locked: true, pieceTitle: '요청한 글', draft1: '친구와 놀았어요.\n\n친구와 이야기했어요. 친구와 웃었어요.', updatedAtIso: now },
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
        if (['studentLogin', 'studentRefresh'].includes(payload.action)) {
          const own = state.students.find((item) => item.number === String(payload.number || payload.sessionToken?.split('-').at(-1) || '1'));
          return reply({ ok: true, student: own, topics, config: state.config, sessionToken: `opaque-${own.number}`, questions: [] });
        }
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
    const topicCard = teacher.locator('.sketch-card').filter({ has: teacher.getByRole('heading', { name: '함께 쓰는 주제', exact: true }) }).last();
    await topicCard.getByRole('button', { name: /완성 글 모음/ }).click();
    await teacher.getByRole('heading', { name: '함께 쓰는 주제 · 완성 글 모음', exact: true }).waitFor();
    await teacher.getByRole('heading', { name: '친구 완성 제목', exact: true }).click();
    assert.equal(await teacher.getByRole('region', { name: '학생 완성 공책', exact: true }).locator('.manuscript-body').textContent(), '  첫 문단\n\n두 번째 문단\n');
    await teacher.getByRole('button', { name: '주제 책장으로 돌아가기', exact: true }).click();
    await teacher.getByRole('heading', { name: '함께 쓰는 주제', exact: true }).click();
    await teacher.getByRole('button', { name: '완성 글 모음', exact: true }).click();
    await teacher.getByRole('heading', { name: '친구 완성 제목', exact: true }).waitFor();
    await teacher.getByRole('button', { name: '학생 관리로 돌아가기', exact: true }).click();
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
    const teacherBody = teacher.locator('.manuscript-body').first();
    const selectionStart = state.students[2].draft1.indexOf('친구', 1);
    await teacherBody.evaluate((element, start) => {
      const range = document.createRange();
      range.setStart(element.firstChild, start); range.setEnd(element.firstChild, start + 2);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }, selectionStart);
    assert.equal(await teacherBody.locator('mark').count(), 1);
    assert.equal(await teacherBody.locator('mark').evaluate((element) => element.previousSibling.textContent.length), selectionStart);
    await teacher.getByPlaceholder('이 문장을 어떻게 고치면 좋을지 적어주세요', { exact: true }).fill('두 번째 친구에 대한 조언');
    await teacher.getByRole('button', { name: '추가', exact: true }).click();
    assert.equal(await teacherBody.locator('mark').count(), 1);
    await teacher.getByLabel('선생님의 종합 첨삭 노트', { exact: true }).fill('다정한 조언');
    await send.click();
    await send.waitFor({ state: 'visible' });
    assert.equal(await send.isDisabled(), true);
    const delivered = await teacher.evaluate(() => JSON.parse(localStorage.getItem('sseudam_students_v7')).find((item) => item.number === '3'));
    assert.equal(delivered.feedbackItems[0].anchor.start, selectionStart);
    Object.assign(state.students[2], delivered);
    await select('나학생');
    assert.equal(await teacher.getByRole('button', { name: '수정 다시 열기', exact: true }).count(), 0);

    const student = await makeContext(true);
    await student.goto('http://127.0.0.1:5173/?student=1&sheetId=QA_SHEET&classId=A&accessKey=key');
    await student.getByPlaceholder('2', { exact: true }).fill('1');
    await student.getByPlaceholder('이도윤', { exact: true }).fill('가학생');
    await student.getByRole('button', { name: '내 글쓰기 책장 들어가기', exact: true }).click();
    const studentTopic = student.locator('.sketch-card').filter({ has: student.getByRole('heading', { name: '함께 쓰는 주제', exact: true }) }).last();
    await studentTopic.getByRole('button', { name: '친구 완성 글 보기', exact: true }).click();
    await student.getByRole('heading', { name: '친구 완성 제목', exact: true }).waitFor();
    await student.getByRole('button', { name: '내 노트로 돌아가기', exact: true }).click();
    assert.match(await student.locator('.student-writing-status').textContent(), /글 쓰는 중/);
    assert.equal(await student.getByRole('region', { name: '선생님의 글쓰기 안내', exact: true }).locator('p').textContent(), topics[0].prompt);
    assert.equal(await student.getByRole('button', { name: '처음 글과 비교하기', exact: true }).isDisabled(), true);
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

    // Finished students receive an explicit completion message and visible growth tools.
    state.students[1].draftHistory = [{ text: '처음 쓴 글', pieceTitle: '처음 제목' }, { text: state.students[1].draft1, pieceTitle: '친구 완성 제목' }];
    const completed = await makeContext(true);
    await completed.goto('http://127.0.0.1:5173/?student=1&sheetId=QA_SHEET&classId=A&accessKey=key');
    await completed.getByPlaceholder('2', { exact: true }).fill('2');
    await completed.getByPlaceholder('이도윤', { exact: true }).fill('나학생');
    await completed.getByRole('button', { name: '내 글쓰기 책장 들어가기', exact: true }).click();
    await completed.getByRole('heading', { name: '함께 쓰는 주제', exact: true }).click();
    const completionDialog = completed.getByRole('dialog', { name: '나학생 학생, 작품을 완성했어요!', exact: true });
    await completionDialog.waitFor({ state: 'visible' });
    await completionDialog.getByRole('button', { name: '내 작품 보기', exact: true }).click();
    assert.equal(await completed.locator('.student-writing-status').textContent(), '최종 완성');
    assert.equal(await completed.getByRole('heading', { name: '나학생 학생, 작품을 완성했어요!', exact: true }).count(), 0);
    assert.equal(await completed.getByRole('region', { name: '선생님의 글쓰기 안내', exact: true }).isVisible(), true);
    assert.equal(await completed.getByRole('button', { name: '친구 완성 글 보기', exact: true }).isVisible(), true);
    await completed.getByRole('button', { name: '처음 글과 비교하기', exact: true }).click();
    await completed.getByRole('heading', { name: '글쓰기 성장 비교', exact: true }).waitFor();
    await completed.getByRole('button', { name: '닫기', exact: true }).click();
    for (const width of [1440, 390]) {
      await completed.setViewportSize({ width, height: 1000 });
      await completed.evaluate(() => window.scrollTo(0, 0));
      assert.ok(await completed.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      if (process.env.FRIEND_NOTEBOOK_QA_DIR) await completed.screenshot({ path: require('node:path').join(process.env.FRIEND_NOTEBOOK_QA_DIR, `student-completion-${width}.png`), fullPage: true });
    }
    await completed.getByRole('button', { name: '더 다듬기', exact: true }).click();
    assert.equal(await completed.locator('.student-writing-status').textContent(), '최종 완성 · 다듬는 중');
    await completed.getByRole('button', { name: '책장으로', exact: true }).click();
    await completed.getByRole('heading', { name: '함께 쓰는 주제', exact: true }).click();
    assert.equal(await completionDialog.count(), 0, 'completion notice must not reopen on every entry');
    await completed.getByRole('button', { name: '최종 완성 안내 보기', exact: true }).click();
    await completionDialog.waitFor({ state: 'visible' });
    await completed.keyboard.press('Escape');

    // New feedback overrides a previously closed panel, while the same edition respects it.
    const feedbackStudent = await makeContext(true);
    const enterFeedbackNotebook = async () => {
      await feedbackStudent.getByRole('heading', { name: '함께 쓰는 주제', exact: true }).click();
    };
    await feedbackStudent.goto('http://127.0.0.1:5173/?student=1&sheetId=QA_SHEET&classId=A&accessKey=key');
    await feedbackStudent.getByPlaceholder('2', { exact: true }).fill('3');
    await feedbackStudent.getByPlaceholder('이도윤', { exact: true }).fill('다학생');
    await feedbackStudent.getByRole('button', { name: '내 글쓰기 책장 들어가기', exact: true }).click();
    await enterFeedbackNotebook();
    const panel = feedbackStudent.locator('#student-feedback-panel');
    assert.equal(await panel.isVisible(), true);
    await panel.getByRole('button', { name: /문장 조언 1/ }).click();
    const studentMark = feedbackStudent.getByRole('region', { name: '내 글 공책', exact: true }).locator('mark');
    assert.equal(await studentMark.count(), 1);
    assert.equal(await studentMark.evaluate((element) => element.previousSibling.textContent.length), selectionStart);
    await feedbackStudent.waitForFunction(() => {
      const drawer = document.querySelector('.student-feedback-drawer');
      return drawer && ['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(getComputedStyle(drawer).transform);
    });
    const paperBounds = await feedbackStudent.getByRole('region', { name: '내 글 공책', exact: true }).boundingBox();
    const panelBounds = await panel.boundingBox();
    const layerBounds = await feedbackStudent.locator('.student-feedback-drawer-layer').boundingBox();
    assert.equal(await feedbackStudent.locator('.student-feedback-drawer-layer').evaluate((element) => getComputedStyle(element).position), 'fixed');
    assert.ok(Math.abs(panelBounds.x + panelBounds.width - layerBounds.x - layerBounds.width) < 2, 'drawer is attached to the usable viewport edge');
    assert.ok(panelBounds.width >= 400 && panelBounds.width <= 460);
    if (process.env.FRIEND_NOTEBOOK_QA_DIR) await feedbackStudent.screenshot({ path: require('node:path').join(process.env.FRIEND_NOTEBOOK_QA_DIR, 'student-feedback-side-desktop.png'), fullPage: true, animations: 'disabled' });
    await panel.getByRole('button', { name: '첨삭 패널 닫기', exact: true }).click();
    assert.equal(await feedbackStudent.locator('.student-feedback-drawer').count(), 1, 'closing remains mounted for slide-out');
    await panel.waitFor({ state: 'hidden' });
    const closedPaperBounds = await feedbackStudent.getByRole('region', { name: '내 글 공책', exact: true }).boundingBox();
    assert.equal(closedPaperBounds.width, paperBounds.width);
    assert.equal(closedPaperBounds.x, paperBounds.x, 'opening and closing must not move or rewrap the notebook');
    const edgeButton = feedbackStudent.getByRole('button', { name: '선생님 첨삭 보기', exact: true });
    const edgeBounds = await edgeButton.boundingBox();
    await feedbackStudent.evaluate(() => window.scrollTo(0, 300));
    assert.equal((await edgeButton.boundingBox()).y, edgeBounds.y, 'edge trigger stays fixed when scrolling');
    await edgeButton.click();
    await panel.waitFor({ state: 'visible' });
    await panel.getByRole('button', { name: '첨삭 패널 닫기', exact: true }).click();
    await panel.waitFor({ state: 'hidden' });
    await feedbackStudent.getByRole('button', { name: '책장으로', exact: true }).click(); await enterFeedbackNotebook();
    assert.equal(await panel.isVisible(), false);
    state.students[2].teacherNote = '새로 도착한 선생님 조언\n\n' + '문장과 문단을 차근차근 살펴보세요.\n\n'.repeat(35);
    if (state.students[2].draftHistory?.length) state.students[2].draftHistory.at(-1).teacherNote = state.students[2].teacherNote;
    await feedbackStudent.reload();
    await enterFeedbackNotebook();
    await panel.getByText('새로 도착한 선생님 조언', { exact: false }).waitFor();
    assert.equal(await panel.isVisible(), true);
    await panel.getByRole('button', { name: '첨삭 패널 닫기', exact: true }).click();
    await panel.waitFor({ state: 'hidden' });
    await feedbackStudent.setViewportSize({ width: 390, height: 900 });
    await feedbackStudent.getByRole('button', { name: '선생님께 질문', exact: true }).click();
    await feedbackStudent.getByRole('dialog', { name: '선생님 첨삭', exact: true }).waitFor({ state: 'visible' });
    await feedbackStudent.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '질문 내용');
    await feedbackStudent.waitForFunction(() => {
      const input = document.querySelector('[aria-label="질문 내용"]');
      const box = input?.getBoundingClientRect();
      return box && box.top >= 70 && box.bottom <= window.innerHeight;
    });
    assert.ok((await panel.getByRole('button', { name: '첨삭 패널 닫기', exact: true }).boundingBox()).y < 60, 'close control remains fixed while feedback scrolls');
    assert.equal(await feedbackStudent.evaluate(() => document.body.style.overflow), 'hidden');
    assert.ok(await feedbackStudent.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    if (process.env.FRIEND_NOTEBOOK_QA_DIR) await feedbackStudent.screenshot({ path: require('node:path').join(process.env.FRIEND_NOTEBOOK_QA_DIR, 'student-feedback-drawer-mobile.png'), fullPage: true, animations: 'disabled' });
    await feedbackStudent.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
    assert.equal(await panel.isVisible(), false);
    assert.equal(await feedbackStudent.evaluate(() => document.body.style.overflow), '');
    assert.deepEqual(errors, []);
    console.log('PASS: viewport edge trigger, slide-out presence, unchanged notebook width and position, automatic new feedback, desktop/mobile overlay drawer, focus and Escape, exact highlights, completion modal, galleries, draft preservation.');
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
