// Uses a disposable browser profile and intercepted Google responses; no live account is used.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.cwd();

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const now = new Date().toISOString();
  const topic = { id: 'QA_TOPIC', classId: 'QA_CLASS', title: '생생한 경험 쓰기', prompt: '기억에 남는 장면을 써 보세요.', isActive: true, classLocked: false };
  let state = {
    classes: [{ id: 'QA_CLASS', className: '테스트 학급' }],
    topics: [topic, { id: 'QA_OLD', classId: 'QA_CLASS', title: '지난 시간 기준', feedbackCriteria: { goal: '자세한 장면', criteria: '순서\n생각과 느낌', guidance: '잘한 점 1개, 고칠 점 1개' } }],
    students: [1, 2, 3].map((number) => ({
      classId: 'QA_CLASS', number: String(number), name: ['가학생', '나학생', '다학생'][number - 1],
      status: number === 3 ? 'STAGE_1_WRITING' : 'STAGE_1_SUBMITTED', locked: number !== 3,
      pieceTitle: `${number}번의 소풍`, draft1: `  ${number}번 첫 문단입니다.\n\n신나는 둘째 문단입니다.\n`,
      draftHistory: [{ text: `  ${number}번 첫 문단입니다.\n\n신나는 둘째 문단입니다.\n`, pieceTitle: `${number}번의 소풍`, updatedAtIso: now }],
      docId: `ORIGINAL_${number}`, updatedAtIso: now
    })),
    questions: [], config: { activeClassId: 'QA_CLASS', activeTopicId: topic.id, className: '테스트 학급', assignmentTitle: topic.title, spreadsheetId: 'QA_SHEET', driveFolderId: 'QA_ROOT', classAccessKeys: { QA_CLASS: 'qa-key' } }
  };
  const seed = structuredClone(state);
  const files = [];
  const docs = new Map();
  const feedbackDocs = new Set();
  const feedbackTextByDoc = new Map();
  let originalReadGate = null;
  const originalDocRequests = [];
  let failSecondDoc = true;
  let failCleanupSecondDoc = false;
  const trashEvents = [];
  await context.route('https://**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const reply = (value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    if (url.hostname === 'sheets.googleapis.com') {
      if (url.pathname.endsWith('/values:batchUpdate')) {
        const rows = body.data.find((item) => item.range === 'AppState!A1').values.slice(1);
        const next = {}; const chunks = {};
        for (const [key, value] of rows) {
          const match = key.match(/^(.+):(\d+)$/);
          if (match) { (chunks[match[1]] ||= [])[Number(match[2])] = value; }
          else next[key] = JSON.parse(value);
        }
        for (const [key, values] of Object.entries(chunks)) next[key] = JSON.parse(values.join(''));
        state = next;
        return reply({});
      }
      if (url.pathname.includes('/values/AppState!') && !url.pathname.endsWith(':clear')) {
        return reply({ values: Object.entries(state).map(([key, value]) => [key, JSON.stringify(value)]) });
      }
      return reply({});
    }
    if (url.hostname === 'www.googleapis.com') {
      if (req.method() === 'DELETE') throw new Error('Permanent deletion is forbidden');
      if (url.pathname.endsWith('/permissions')) return reply({ id: 'PERMISSION' });
      if (url.pathname.endsWith('/comments')) return reply({ comments: [] });
      if (url.searchParams.has('q')) {
        const parent = url.searchParams.get('q').match(/'([^']+)' in parents/);
        const match = url.searchParams.get('q').match(/key='(\w+)' and value='([^']+)'/);
        if (parent) return reply({ files: files.filter((file) => !file.trashed && file.parents?.includes(parent[1]) && (!match || file.appProperties?.[match[1]] === match[2])) });
        return reply({ files: match ? files.filter((file) => file.appProperties?.[match[1]] === match[2]) : [] });
      }
      if (url.pathname.endsWith('/files') && req.method() === 'POST') {
        const file = { id: `QA_FILE_${files.length}`, ...body }; files.push(file);
        if (body.mimeType.endsWith('document')) docs.set(file.id, '');
        return reply(file);
      }
      const fileId = url.pathname.split('/').at(-1);
      const file = files.find((item) => item.id === fileId);
      if (file && req.method() === 'GET') return reply(file);
      if (file && req.method() === 'PATCH') {
        assert.deepEqual(body, { trashed: true });
        if (file.mimeType.endsWith('document')) {
          const number = Number(file.name.match(/^(\d+)번/)?.[1]);
          if (number) assert.equal(state.students[number - 1].status, 'FEEDBACK_DONE', 'persist feedback before trashing');
          if (failCleanupSecondDoc && number === 2) return route.fulfill({ status: 403, body: 'mock permission failure' });
        }
        file.trashed = true;
        trashEvents.push(file.id);
        return reply(file);
      }
      return reply({});
    }
    if (url.hostname === 'docs.googleapis.com') {
      const id = url.pathname.split('/').at(-1).split(':')[0];
      if (id.startsWith('ORIGINAL_')) originalDocRequests.push(req.url());
      if (url.pathname.endsWith(':batchUpdate')) {
        const file = files.find((item) => item.id === id);
        if (failSecondDoc && file?.name.startsWith('2번')) {
          failSecondDoc = false;
          return route.fulfill({ status: 503, body: 'temporary test failure' });
        }
        docs.set(id, docs.get(id) + (body.requests.find((item) => item.insertText)?.insertText.text || ''));
        return reply({});
      }
      if (id.startsWith('ORIGINAL_') && originalReadGate) await originalReadGate;
      const content = (docs.get(id) || '\n').split('\n').map((text) => ({ paragraph: { elements: [{ textRun: { content: text + '\n' } }] } }));
      if (feedbackDocs.has(id)) content.unshift({ table: { tableRows: [
        { tableCells: ['GLOW', 'GROW'].map((text) => ({ content: [{ paragraph: { elements: [{ textRun: { content: text } }] } }] })) },
        { tableCells: [feedbackTextByDoc.get(id) || '장면을 순서대로 잘 썼어요.', '어떤 소리가 들렸는지 덧붙여 볼까요?'].map((text) => ({ content: [{ paragraph: { elements: [{ textRun: { content: text } }] } }] })) }
      ] } });
      return reply({ body: { content } });
    }
    return route.abort();
  });
  await context.addInitScript(({ seed }) => {
    const qaRealNow = Date.now.bind(Date);
    Date.now = () => qaRealNow() + (window.qaTimeOffset || 0);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text) => {
        if (window.qaDenyClipboard) throw new Error('clipboard denied for verification');
        window.qaCopiedFeedback = text;
      }
    } });
    if (localStorage.getItem('qa_seeded')) return;
    for (const [key, value] of Object.entries(seed)) {
      localStorage.setItem(`sseudam_${key}_v7`, JSON.stringify(value));
    }
    localStorage.setItem('sseudam_google_auth_v1', JSON.stringify({ accessToken: 'qa-intercepted-token', expiresAt: Date.now() + 86400000, user: { email: 'qa@example.invalid', name: '테스트 교사' } }));
    localStorage.setItem('sseudam_teacher_step_v4', 'bookshelf');
    localStorage.setItem('qa_seeded', 'yes');
  }, { seed });
  const openWorkspace = async () => {
    await page.getByRole('heading', { name: '생생한 경험 쓰기', exact: true }).click();
  };
  const openBatch = () => page.getByRole('tab', { name: /묶음 피드백/ }).click();
  const openIndividual = () => page.getByRole('tab', { name: '개인 피드백', exact: true }).click();
  const panel = page.getByRole('region', { name: '묶음 피드백', exact: true });
  const roster = page.getByRole('region', { name: '우리 반 학생 명단', exact: true });
  const individualPanel = page.locator('#feedback-panel-individual');
  const modal = page.getByRole('dialog', { name: '피드백 기준', exact: true });
  try {
    await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173');
    await openWorkspace();
    assert.equal(await individualPanel.isVisible(), true);
    assert.equal(await roster.getByRole('tablist').count(), 1);
    assert.equal(await page.getByRole('tablist').count(), 1);
    const topHeights = await Promise.all(['학생 링크 · QR 안내', '피드백 기준', '이 주제 전체 마감'].map(async (name) => (await page.getByRole('button', { name, exact: true }).boundingBox()).height));
    assert.ok(topHeights.every((height) => height === topHeights[0]));
    assert.equal(await individualPanel.getByRole('button', { name: '첨삭 가져오기', exact: true }).count(), 0);
    assert.equal(await individualPanel.getByRole('button', { name: '다시 확인', exact: true }).count(), 0);
    assert.equal(await page.locator('#feedback-panel-batch').isVisible(), false);
    await page.getByLabel('선생님의 종합 첨삭 노트', { exact: true }).fill('개인 첨삭 작성 중인 조언');
    await page.getByRole('tab', { name: '개인 피드백', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await panel.waitFor({ state: 'visible' });
    assert.equal(await individualPanel.isVisible(), false);
    await openIndividual();
    assert.equal(await page.getByLabel('선생님의 종합 첨삭 노트', { exact: true }).inputValue(), '개인 첨삭 작성 중인 조언');
    await page.getByRole('button', { name: '피드백 기준', exact: true }).click();
    await modal.getByText('다른 주제의 기준 불러오기', { exact: true }).click();
    await page.getByLabel('불러올 주제', { exact: true }).selectOption('QA_OLD');
    await page.getByRole('button', { name: '불러오기', exact: true }).click();
    await page.getByLabel('이번 수업의 목표', { exact: true }).fill('생생한 장면 쓰기');
    await page.keyboard.press('Escape');
    await modal.getByText('저장하지 않은 변경 내용이 있습니다.', { exact: true }).waitFor();
    await modal.getByRole('button', { name: '계속 수정', exact: true }).click();
    assert.equal(await page.getByLabel('이번 수업의 목표', { exact: true }).inputValue(), '생생한 장면 쓰기');
    await page.getByRole('button', { name: '저장하기', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });
    await page.getByText('이 주제의 피드백 기준을 저장했습니다.', { exact: false }).waitFor();
    assert.equal(state.topics.find((item) => item.id === topic.id).feedbackCriteria.goal, '생생한 장면 쓰기');
    assert.equal(state.topics.find((item) => item.id === 'QA_OLD').feedbackCriteria.goal, '자세한 장면');
    await page.getByRole('button', { name: '기준 복사', exact: true }).click();
    const personalPrompt = await page.evaluate(() => window.qaCopiedFeedback);
    for (const part of ['생생한 경험 쓰기', '생생한 장면 쓰기', '순서\n생각과 느낌', '잘한 점 1개, 고칠 점 1개']) assert.ok(personalPrompt.includes(part));
    await page.evaluate(() => { window.qaDenyClipboard = true; });
    await page.getByRole('button', { name: '기준 복사', exact: true }).click();
    const manualCopy = page.getByLabel('개인 첨삭에 복사할 주제 기준', { exact: true });
    await manualCopy.waitFor({ state: 'visible' });
    assert.equal(await manualCopy.inputValue(), personalPrompt);
    await page.evaluate(() => { window.qaDenyClipboard = false; });
    await page.getByRole('button').filter({ hasText: '나학생' }).filter({ hasText: '1차 제출완료' }).click();
    await page.getByRole('button', { name: '기준 복사', exact: true }).click();
    assert.equal(await page.evaluate(() => window.qaCopiedFeedback), personalPrompt);
    await page.getByLabel('선생님의 종합 첨삭 노트', { exact: true }).fill('나학생에게 쓰는 중인 개인 조언');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(process.env.BATCH_FEEDBACK_QA_DIR || root, 'feedback-individual-clean.png'), fullPage: true });
    await openBatch();
    const candidateTwo = roster.getByRole('checkbox', { name: /2번 나학생/ });
    assert.equal(await roster.getByRole('checkbox', { name: /3번 다학생/ }).isDisabled(), true);
    assert.equal(await panel.getByRole('checkbox', { name: /묶음 대상 선택/ }).count(), 0);
    await candidateTwo.uncheck();
    await openIndividual(); await openBatch();
    assert.equal(await candidateTwo.isChecked(), false);
    await candidateTwo.check();
    await panel.getByRole('button', { name: '선택한 2명 폴더 준비' }).click();
    await page.getByText('2명 중 1명의 제출본을 준비했습니다.', { exact: false }).waitFor();
    await page.getByRole('button', { name: '준비 실패·중단 문서 다시 준비' }).click();
    await page.getByText('2명 중 2명의 제출본을 준비했습니다.', { exact: false }).waitFor();
    assert.equal(files.length, 3);
    await panel.getByRole('button', { name: '기준 복사', exact: true }).click();
    assert.equal(await page.evaluate(() => window.qaCopiedFeedback), personalPrompt);
    await page.getByRole('button', { name: '피드백 기준', exact: true }).click();
    await page.getByLabel('이번 수업의 목표', { exact: true }).fill('다음 단계의 새 목표');
    await page.screenshot({ path: path.join(process.env.BATCH_FEEDBACK_QA_DIR || root, 'feedback-criteria-dialog.png'), fullPage: true });
    await modal.getByRole('button', { name: '저장하기', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });
    await panel.getByText('현재 주제 기준이 변경되었습니다.', { exact: false }).waitFor();
    await panel.getByRole('button', { name: '기준 복사', exact: true }).click();
    assert.equal(await page.evaluate(() => window.qaCopiedFeedback), personalPrompt);
    await openIndividual();
    await roster.getByRole('button').filter({ hasText: '나학생' }).click();
    await page.waitForFunction(() => document.getElementById('individual-feedback-note')?.value === '나학생에게 쓰는 중인 개인 조언');
    assert.equal(await page.getByLabel('선생님의 종합 첨삭 노트', { exact: true }).inputValue(), '나학생에게 쓰는 중인 개인 조언');
    await page.getByRole('button', { name: '기준 복사', exact: true }).click();
    assert.match(await page.evaluate(() => window.qaCopiedFeedback), /다음 단계의 새 목표/);
    await openBatch();
    await roster.getByRole('button').filter({ hasText: '가학생' }).click();
    assert.equal(originalDocRequests.length, 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.equal(state.students[2].status, 'STAGE_1_WRITING');
    for (const file of files.filter((item) => item.mimeType.endsWith('document'))) feedbackDocs.add(file.id);
    await page.getByRole('button', { name: '전체 첨삭 다시 확인' }).click();
    await page.getByText('가져옴 2명', { exact: false }).waitFor();
    const sendButton = page.getByRole('button', { name: '이 학생에게 보내고 다음 학생', exact: true });
    assert.equal(await sendButton.isDisabled(), true);
    const review = page.getByRole('checkbox', { name: /학생의 제출본과 조언을 읽고 확인했습니다/ });
    await review.check();
    await page.getByLabel('학생에게 보낼 종합 조언', { exact: true }).fill('교사가 보완한 조언입니다. 어떤 소리가 들렸나요?');
    assert.equal(await review.isChecked(), false);
    await review.check();
    await openIndividual(); await openBatch();
    assert.equal(await review.isChecked(), true);
    await page.getByRole('button', { name: '전체 첨삭 다시 확인' }).click();
    await page.getByText('가져옴 0명', { exact: false }).waitFor();
    assert.match(await page.getByLabel('학생에게 보낼 종합 조언', { exact: true }).inputValue(), /교사가 보완한/);
    assert.equal(state.students[0].teacherNote, undefined);
    assert.equal(trashEvents.length, 0, 'importing alone must not trash anything');
    await page.reload();
    await openWorkspace();
    await openBatch();
    assert.match(await page.getByLabel('학생에게 보낼 종합 조언', { exact: true }).inputValue(), /교사가 보완한/);
    await page.getByRole('checkbox', { name: /학생의 제출본과 조언을 읽고 확인했습니다/ }).check();
    await page.getByRole('button', { name: '이 학생에게 보내고 다음 학생', exact: true }).click();
    await roster.getByRole('button').filter({ hasText: '가학생' }).filter({ hasText: '전송 완료' }).waitFor();
    assert.equal(state.students[0].status, 'FEEDBACK_DONE');
    assert.equal(state.students[0].locked, false);
    assert.match(state.students[0].teacherNote, /교사가 보완한/);
    assert.equal(state.students[1].status, 'STAGE_1_SUBMITTED');
    assert.equal(state.students[2].status, 'STAGE_1_WRITING');
    assert.equal(originalDocRequests.length, 0);
    await page.getByText('전송한 학생의 임시 독스를 정리했습니다.', { exact: false }).waitFor();
    assert.equal(files.find((item) => item.name.startsWith('1번')).trashed, true);
    assert.notEqual(files.find((item) => item.name.startsWith('2번')).trashed, true);
    assert.notEqual(files.find((item) => item.mimeType.endsWith('folder')).trashed, true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(process.env.BATCH_FEEDBACK_QA_DIR || root, 'batch-feedback-desktop.png'), fullPage: true });
    // The local screen still has the submitted status; the send must recheck the server.
    state.students[1].status = 'STAGE_1_WRITING';
    state.students[1].locked = false;
    state.students[1].updatedAtIso = new Date(Date.now() + 1000).toISOString();
    await page.getByRole('checkbox', { name: /학생의 제출본과 조언을 읽고 확인했습니다/ }).check();
    await page.getByRole('button', { name: '이 학생에게 보내고 다음 학생', exact: true }).click();
    await page.getByText('학생의 제출 상태가 바뀌었습니다. 최신 제출본을 확인하고 다시 준비해 주세요.', { exact: true }).waitFor();
    assert.equal(state.students[1].teacherNote, undefined);
    await page.getByText('학생이 제출을 회수하거나 새 글을 제출했거나, 이미 다른 경로로 피드백을 받았습니다.', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: '이 학생에게 보내고 다음 학생', exact: true }).isDisabled(), true);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(process.env.BATCH_FEEDBACK_QA_DIR || root, 'batch-feedback-mobile.png'), fullPage: true });
    assert.equal(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth), true);
    await page.getByRole('button', { name: '피드백 기준', exact: true }).click();
    await modal.waitFor({ state: 'visible' });
    assert.equal(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth), true);
    const saveBounds = await modal.getByRole('button', { name: '저장하기', exact: true }).boundingBox();
    assert.ok(saveBounds.y >= 0 && saveBounds.y + saveBounds.height <= 812);
    await page.screenshot({ path: path.join(process.env.BATCH_FEEDBACK_QA_DIR || root, 'feedback-criteria-mobile.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: '피드백 기준', exact: true }).evaluate((element) => element === document.activeElement), true);
    // A second clean run exercises approving and returning an entire small batch.
    state = structuredClone(seed);
    files.length = 0; docs.clear(); feedbackDocs.clear();
    await page.evaluate(() => localStorage.clear());
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.reload(); await openWorkspace();
    await openBatch();
    await panel.getByRole('button', { name: '선택한 2명 폴더 준비' }).click();
    await page.getByText('2명 중 2명의 제출본을 준비했습니다.', { exact: false }).waitFor();
    for (const file of files.filter((item) => item.mimeType.endsWith('document'))) feedbackDocs.add(file.id);
    await page.getByRole('button', { name: '전체 첨삭 다시 확인' }).click();
    await page.getByText('가져옴 2명', { exact: false }).waitFor();
    await page.getByRole('checkbox', { name: /학생의 제출본과 조언을 읽고 확인했습니다/ }).check();
    await roster.getByRole('button').filter({ hasText: '나학생' }).click();
    await page.getByRole('checkbox', { name: /학생의 제출본과 조언을 읽고 확인했습니다/ }).check();
    failCleanupSecondDoc = true;
    await page.getByRole('button', { name: '교사가 확인한 2명 함께 전송' }).click();
    await page.getByText('2명에게 피드백을 전송했습니다.', { exact: false }).waitFor();
    assert.equal(state.students[0].status, 'FEEDBACK_DONE');
    assert.equal(state.students[1].status, 'FEEDBACK_DONE');
    assert.equal(state.students[2].status, 'STAGE_1_WRITING');
    await page.getByText('피드백은 전송됐지만 임시 자료 정리가 남았습니다.', { exact: false }).waitFor();
    assert.notEqual(files.find((file) => file.mimeType.endsWith('folder')).trashed, true);
    failCleanupSecondDoc = false;
    await page.getByRole('button', { name: '임시 자료 정리 다시 시도', exact: true }).click();
    await page.getByText('전송과 임시 자료 정리가 끝난 묶음입니다.', { exact: false }).waitFor();
    assert.equal(files.every((file) => file.trashed), true);
    assert.equal(await panel.getByRole('link', { name: '이 제출본 독스 열기' }).count(), 0);
    assert.match(await page.getByLabel('학생에게 보낼 종합 조언', { exact: true }).inputValue(), /장면을 순서대로/);
    // Previous completed batches can be removed together without touching originals.
    const oldBatch = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((key) => key.startsWith('sseudam_feedback_batches_v1:'));
      const batches = JSON.parse(localStorage.getItem(key));
      const old = { ...batches[0], id: 'QA_OLD_BATCH', label: '이전 완료 묶음', folderId: 'QA_OLD_FOLDER', folderUrl: '', cleanedAt: '', cleanupError: '', entries: [{ ...batches[0].entries[0], id: 'QA_OLD_ENTRY', docId: 'QA_OLD_DOC', docUrl: '', docTrashedAt: '' }] };
      localStorage.setItem(key, JSON.stringify([...batches, old]));
      return old;
    });
    files.push({ id: oldBatch.folderId, mimeType: 'application/vnd.google-apps.folder', appProperties: { sseudamBatchId: oldBatch.id } },
      { id: 'QA_OLD_DOC', name: 'previous completed doc', mimeType: 'application/vnd.google-apps.document', parents: [oldBatch.folderId], appProperties: { sseudamBatchId: oldBatch.id, sseudamEntryId: 'QA_OLD_ENTRY' } });
    await page.reload(); await openWorkspace(); await openBatch();
    await page.getByRole('button', { name: '완료 묶음 폴더 1개 정리', exact: true }).click();
    await page.getByText('완료 묶음 1개를 휴지통으로 정리했습니다.', { exact: false }).waitFor();
    assert.equal(files.every((file) => file.trashed), true);
    // A fresh personal-feedback session verifies focus-driven import and edit protection.
    state = structuredClone(seed); files.length = 0; docs.clear(); feedbackDocs.clear();
    await page.evaluate(() => localStorage.clear());
    await page.reload(); await openWorkspace();
    const openStudentDoc = async () => {
      const popupEvent = page.waitForEvent('popup');
      await page.getByRole('button', { name: '독스 열기', exact: true }).click();
      const popup = await popupEvent;
      await page.getByText('독스에서 첨삭하는 중 · 쓰담으로 돌아오면 확인합니다.', { exact: true }).waitFor();
      await popup.close();
    };
    const returnToWriting = () => page.evaluate(() => { window.qaTimeOffset = (window.qaTimeOffset || 0) + 5000; window.dispatchEvent(new Event('focus')); });
    await openStudentDoc();
    await returnToWriting();
    await page.getByText('아직 독스에 삽입된 첨삭이 없습니다.', { exact: true }).waitFor();
    feedbackDocs.add('ORIGINAL_1');
    await page.getByRole('button', { name: '다시 확인', exact: true }).click();
    await page.getByText('브릭스트 첨삭을 바로 불러왔습니다.', { exact: true }).waitFor();
    assert.match(await page.getByLabel('선생님의 종합 첨삭 노트', { exact: true }).inputValue(), /장면을 순서대로/);
    await page.getByLabel('선생님의 종합 첨삭 노트', { exact: true }).fill('교사가 직접 쓴 소중한 조언');
    feedbackTextByDoc.set('ORIGINAL_1', '독스의 새로운 첨삭');
    await openStudentDoc(); await returnToWriting();
    await page.getByText('브릭스트 첨삭을 바로 불러왔습니다.', { exact: true }).waitFor();
    const appended = await page.getByLabel('선생님의 종합 첨삭 노트', { exact: true }).inputValue();
    assert.match(appended, /^교사가 직접 쓴 소중한 조언/);
    assert.match(appended, /독스의 새로운 첨삭/);
    await openStudentDoc();
    let releaseOriginalRead;
    originalReadGate = new Promise((resolve) => { releaseOriginalRead = resolve; });
    await returnToWriting();
    await page.getByText('독스 첨삭을 확인하는 중…', { exact: true }).waitFor();
    await roster.getByRole('button').filter({ hasText: '나학생' }).click();
    await page.waitForFunction(() => document.getElementById('individual-feedback-note')?.value === '');
    originalReadGate = null; releaseOriginalRead();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.getByLabel('선생님의 종합 첨삭 노트', { exact: true }).inputValue(), '');
    assert.equal(await page.getByText('가져온 첨삭 보기', { exact: true }).count(), 0);
    // Exercise a classroom-sized roster without adding a second student list.
    for (let number = 4; number <= 27; number++) state.students.push({ classId: 'QA_CLASS', number: String(number), name: `테스트학생${number}`, status: 'STAGE_1_WRITING', locked: false });
    await page.evaluate((items) => localStorage.setItem('sseudam_students_v7', JSON.stringify(items)), state.students);
    await page.reload(); await openWorkspace();
    await openBatch();
    assert.equal(await page.getByRole('region', { name: '우리 반 학생 명단', exact: true }).count(), 1);
    assert.equal(await roster.getByRole('checkbox').count(), 27);
    assert.equal(await roster.getByRole('checkbox', { name: /27번 테스트학생27/ }).isDisabled(), true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(process.env.BATCH_FEEDBACK_QA_DIR || root, 'feedback-roster-27-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    const rosterScroll = roster.locator('.overflow-y-auto');
    assert.equal(await rosterScroll.evaluate((element) => element.scrollHeight > element.clientHeight), true);
    await rosterScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await roster.getByRole('button').filter({ hasText: '테스트학생27' }).waitFor({ state: 'visible' });
    await rosterScroll.evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: path.join(process.env.BATCH_FEEDBACK_QA_DIR || root, 'feedback-roster-27-mobile.png'), fullPage: true });
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ passed: true, checks: ['common roster mode control', 'equal header button heights', 'keyboard mode navigation', 'individual draft preserved per student', 'batch selection and review preserved across modes', 'criteria dialog reuse and save', 'unsaved dialog changes protected', 'existing batch criteria retained after settings change', 'personal criteria copy across students', 'clipboard denial fallback', 'partial preparation retry', 'source docs preserved during batch', 'teacher review gate', 'manual edits retained', 'browser reload recovery', 'send selected student only', 'remote recall rejected and refreshed', 'mobile panel and dialog fit', 'dialog focus restored', 'reviewed batch send', 'trash only after persisted feedback', 'keep unsent files', 'cleanup failure retry', 'completed batch bulk cleanup', 'focus-driven doc import', 'retry only when needed', 'teacher edits preserved with immediate merge', 'late doc response cannot affect another student', '27-student common roster fits desktop and mobile'], pageErrors }));
  } catch (error) {
    await page.screenshot({ path: path.join(process.env.BATCH_FEEDBACK_QA_DIR || process.cwd(), 'batch-feedback-failure.png'), fullPage: true });
    throw error;
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
