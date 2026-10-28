const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const driveUrl = pathToFileURL(path.join(__dirname, '../src/services/batchFeedbackDrive.js')).href;
const helperUrl = pathToFileURL(path.join(__dirname, '../src/utils/batchFeedback.js')).href;
const makeBatch = () => ({ id: 'B1', folderId: 'FOLDER', folderUrl: 'folder-url', entries: [
  { id: 'E1', docId: 'DOC1', number: '1', name: '가학생', note: '첫 조언', sentAt: 'SENT', prepared: true },
  { id: 'E2', docId: 'DOC2', number: '2', name: '나학생', note: '둘째 조언', sentAt: 'SENT', prepared: true }
] });

function makeDrive() {
  const files = new Map([
    ['FOLDER', { id: 'FOLDER', mimeType: 'application/vnd.google-apps.folder', appProperties: { sseudamBatchId: 'B1' }, parents: ['ROOT'], trashed: false }],
    ...['DOC1', 'DOC2'].map((id, index) => [id, { id, mimeType: 'application/vnd.google-apps.document', appProperties: { sseudamBatchId: 'B1', sseudamEntryId: 'E' + (index + 1) }, parents: ['FOLDER'], trashed: false }]),
    ['ORIGINAL', { id: 'ORIGINAL', mimeType: 'application/vnd.google-apps.document', appProperties: {}, parents: ['ROOT'], trashed: false }]
  ]);
  const calls = [];
  const fail = new Set();
  const lost = new Set();
  let paginate = false;
  const request = async (target, options = {}) => {
    const url = new URL(target), method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, method, body });
    if (url.pathname === '/drive/v3/files') {
      if (paginate && !url.searchParams.get('pageToken')) return { files: [], nextPageToken: 'later' };
      return { files: [...files.values()].filter((file) => file.parents?.includes('FOLDER') && !file.trashed) };
    }
    const id = url.pathname.split('/').at(-1);
    const file = files.get(id);
    if (!file) throw Object.assign(new Error('not found'), { status: 404 });
    if (method === 'PATCH') {
      assert.deepEqual(body, { trashed: true });
      if (fail.has(id)) throw Object.assign(new Error('권한 오류'), { status: 403 });
      file.trashed = true;
      if (lost.delete(id)) throw new Error('응답 유실');
    }
    return structuredClone(file);
  };
  return { files, calls, request, fail, lost, setPagination: () => { paginate = true; }, patches: () => calls.filter((call) => call.method === 'PATCH') };
}

test('가져오기만 한 조언은 삭제하지 않고 전송 완료를 따로 확인한다', async () => {
  const { cleanupFeedbackBatch } = await import(driveUrl);
  const { isFeedbackBatchComplete } = await import(helperUrl);
  const batch = makeBatch();
  batch.entries.forEach((entry) => { delete entry.sentAt; });
  const drive = makeDrive();
  assert.equal(isFeedbackBatchComplete(batch), false);
  assert.equal(isFeedbackBatchComplete({ entries: [] }), false);
  await assert.rejects(cleanupFeedbackBatch(drive.request, batch), /전송/);
  assert.equal(drive.patches().length, 0);
});

test('일부 전송이면 완료한 독스만 정리하고 모든 전송 후에 폴더까지 정리한다', async () => {
  const { cleanupFeedbackBatch } = await import(driveUrl);
  const batch = makeBatch(); delete batch.entries[1].sentAt;
  const drive = makeDrive();
  const partial = await cleanupFeedbackBatch(drive.request, batch);
  assert.equal(drive.files.get('DOC1').trashed, true);
  assert.equal(drive.files.get('DOC2').trashed, false);
  assert.equal(drive.files.get('FOLDER').trashed, false);
  assert.ok(partial.entries[0].docTrashedAt);
  partial.entries[1].sentAt = 'NOW_SENT';
  const complete = await cleanupFeedbackBatch(drive.request, partial);
  assert.ok(complete.cleanedAt);
  assert.equal(drive.files.get('FOLDER').trashed, true);
  assert.equal(drive.files.get('ORIGINAL').trashed, false);
  assert.deepEqual(complete.entries.map((entry) => entry.note), ['첫 조언', '둘째 조언']);
  assert.equal(drive.calls.some((call) => call.method === 'DELETE'), false);
});

test('다른 폴더·다른 묶음 문서는 식별 정보를 검증해 보관한다', async () => {
  const { cleanupFeedbackBatch } = await import(driveUrl);
  const drive = makeDrive();
  drive.files.get('DOC1').parents = ['OTHER'];
  drive.files.get('DOC2').appProperties.sseudamBatchId = 'ANOTHER_BATCH';
  const result = await cleanupFeedbackBatch(drive.request, makeBatch());
  assert.ok(result.cleanupError);
  assert.equal(drive.patches().length, 0);
  drive.files.get('FOLDER').appProperties.sseudamBatchId = 'NOT_OURS';
  await assert.rejects(cleanupFeedbackBatch(drive.request, makeBatch()), /묶음 폴더/);
  assert.equal(drive.patches().length, 0);
});

test('보호된 원본 파일은 잘못된 묶음 식별 정보가 붙어도 정리하지 않는다', async () => {
  const { cleanupFeedbackBatch } = await import(driveUrl);
  const drive = makeDrive();
  const result = await cleanupFeedbackBatch(drive.request, makeBatch(), () => {}, { protectedFileIds: ['DOC1'] });
  assert.equal(drive.files.get('DOC1').trashed, false);
  assert.equal(drive.files.get('FOLDER').trashed, false);
  assert.match(result.cleanupError, /원본|보호/);
});

test('폴더에 다른 자료가 있으면 페이지 끝까지 확인하고 폴더는 보관한다', async () => {
  const { cleanupFeedbackBatch } = await import(driveUrl);
  const drive = makeDrive();
  drive.setPagination();
  drive.files.set('OTHER', { id: 'OTHER', parents: ['FOLDER'], trashed: false });
  const result = await cleanupFeedbackBatch(drive.request, makeBatch());
  assert.equal(drive.files.get('DOC1').trashed, true);
  assert.equal(drive.files.get('OTHER').trashed, false);
  assert.equal(drive.files.get('FOLDER').trashed, false);
  assert.match(result.cleanupError, /다른 자료/);
  assert.ok(drive.calls.some((call) => call.url.searchParams.get('pageToken') === 'later'));
});

test('권한 실패 때 영구 삭제로 우회하지 않고 다시 시도하면 이어서 정리한다', async () => {
  const { cleanupFeedbackBatch } = await import(driveUrl);
  const drive = makeDrive(); drive.fail.add('DOC2');
  const first = await cleanupFeedbackBatch(drive.request, makeBatch());
  assert.ok(first.entries[0].docTrashedAt);
  assert.equal(first.entries[1].docTrashedAt, undefined);
  assert.match(first.cleanupError, /권한/);
  assert.equal(drive.files.get('FOLDER').trashed, false);
  drive.fail.clear();
  const second = await cleanupFeedbackBatch(drive.request, first);
  assert.ok(second.cleanedAt);
  assert.equal(second.cleanupError, '');
  assert.equal(drive.calls.some((call) => call.method === 'DELETE'), false);
});

test('휴지통 이동 응답이 유실되어도 실제 상태를 재확인하고 중복 정리하지 않는다', async () => {
  const { cleanupFeedbackBatch } = await import(driveUrl);
  const drive = makeDrive(); drive.lost.add('DOC1'); drive.lost.add('FOLDER');
  const first = await cleanupFeedbackBatch(drive.request, makeBatch());
  assert.ok(first.cleanedAt);
  const count = drive.patches().length;
  const again = await cleanupFeedbackBatch(drive.request, first);
  assert.ok(again.cleanedAt);
  assert.equal(drive.patches().length, count);
});
