import { hasFeedbackContent, isFeedbackBatchComplete } from '../utils/batchFeedback.js';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const DOCS = 'https://docs.googleapis.com/v1/documents';
const MARKER = '━━━ [학생 작성 본문] ━━━';

function notebookRequests(entry) {
  const title = entry.pieceTitle || '제목 없음';
  const author = entry.name || '';
  const text = `${MARKER}\n${title}\n${author}\n\n${String(entry.text).replace(/\r\n/g, '\n')}\n`;
  const titleStart = MARKER.length + 2;
  const authorStart = titleStart + title.length + 1;
  const bodyStart = authorStart + author.length + 2;
  return [
    { insertText: { location: { index: 1 }, text } },
    { updateTextStyle: {
      range: { startIndex: 1, endIndex: text.length + 1 },
      textStyle: { weightedFontFamily: { fontFamily: 'Noto Serif KR' }, fontSize: { magnitude: 14.5, unit: 'PT' } },
      fields: 'weightedFontFamily,fontSize'
    } },
    { updateTextStyle: {
      range: { startIndex: 1, endIndex: MARKER.length + 2 },
      textStyle: { fontSize: { magnitude: 1, unit: 'PT' }, foregroundColor: { color: { rgbColor: { red: 1, green: 1, blue: 1 } } } },
      fields: 'fontSize,foregroundColor'
    } },
    { updateParagraphStyle: {
      range: { startIndex: 1, endIndex: MARKER.length + 2 },
      paragraphStyle: { spaceAbove: { magnitude: 0, unit: 'PT' }, spaceBelow: { magnitude: 0, unit: 'PT' }, lineSpacing: 100 },
      fields: 'spaceAbove,spaceBelow,lineSpacing'
    } },
    { updateTextStyle: {
      range: { startIndex: titleStart, endIndex: titleStart + title.length },
      textStyle: { bold: true, fontSize: { magnitude: 18, unit: 'PT' } }, fields: 'bold,fontSize'
    } },
    { updateParagraphStyle: {
      range: { startIndex: titleStart, endIndex: authorStart },
      paragraphStyle: { alignment: 'CENTER', spaceBelow: { magnitude: 9, unit: 'PT' } }, fields: 'alignment,spaceBelow'
    } },
    ...(author ? [{ updateTextStyle: {
      range: { startIndex: authorStart, endIndex: authorStart + author.length },
      textStyle: { bold: true }, fields: 'bold'
    } }, { updateParagraphStyle: {
      range: { startIndex: authorStart, endIndex: authorStart + author.length + 1 },
      paragraphStyle: { alignment: 'END', spaceBelow: { magnitude: 16, unit: 'PT' } }, fields: 'alignment,spaceBelow'
    } }] : []),
    { updateParagraphStyle: {
      range: { startIndex: bodyStart, endIndex: text.length + 1 },
      paragraphStyle: { lineSpacing: 160 }, fields: 'lineSpacing'
    } }
  ];
}

// request is the existing authenticated Google request adapter. No AI service is called.
export async function prepareFeedbackBatch(request, batch, onProgress = () => {}) {
  if (batch.cleanedAt) throw new Error('정리한 묶음은 다시 준비할 수 없습니다. 새 제출본으로 묶음을 만들어 주세요.');
  let result = { ...batch, entries: batch.entries.map((entry) => ({ ...entry })) };
  if (!result.folderId) {
    const folderQuery = encodeURIComponent(`trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='sseudamBatchId' and value='${batch.id}' }`);
    const found = await request(`${FILES}?q=${folderQuery}&fields=files(id)`);
    const folder = found.files?.[0] || await request(FILES, {
      method: 'POST', body: JSON.stringify({
        name: `[쓰담 묶음 피드백] ${batch.topicTitle} · ${batch.label}`,
        mimeType: 'application/vnd.google-apps.folder',
        appProperties: { sseudamBatchId: batch.id },
        ...(batch.parentFolderId ? { parents: [batch.parentFolderId] } : {})
      })
    });
    result.folderId = folder.id;
    result.folderUrl = `https://drive.google.com/drive/folders/${folder.id}`;
    onProgress(result);
  }
  for (let index = 0; index < result.entries.length; index++) {
    const entry = { ...result.entries[index] };
    if (entry.prepared) continue;
    try {
      if (!entry.docId) {
        const fileQuery = encodeURIComponent(`trashed = false and '${result.folderId}' in parents and appProperties has { key='sseudamEntryId' and value='${entry.id}' }`);
        const found = await request(`${FILES}?q=${fileQuery}&fields=files(id)`);
        const file = found.files?.[0] || await request(FILES, {
          method: 'POST', body: JSON.stringify({
            name: `${entry.number}번 ${entry.name} · ${entry.round}차 · ${entry.pieceTitle || '제목 없음'}`,
            mimeType: 'application/vnd.google-apps.document', parents: [result.folderId],
            appProperties: { sseudamBatchId: batch.id, sseudamEntryId: entry.id }
          })
        });
        entry.docId = file.id;
        entry.docUrl = `https://docs.google.com/document/d/${file.id}/edit`;
        result.entries[index] = { ...entry };
        onProgress({ ...result, entries: [...result.entries] });
      }
      // Read before writing: retry after an ambiguous network failure must not duplicate text
      // or erase feedback already inserted by the teacher.
      const existing = await request(`${DOCS}/${entry.docId}`);
      const content = existing.body?.content || [];
      const populated = content.some((element) => element.table || element.paragraph?.elements?.some(
        (part) => part.textRun?.content?.trim()
      ));
      if (!populated) {
        await request(`${DOCS}/${entry.docId}:batchUpdate`, {
          method: 'POST', body: JSON.stringify({ requests: notebookRequests(entry) })
        });
      }
      entry.prepared = true;
      entry.error = '';
    } catch (error) {
      entry.error = error.message || '문서를 준비하지 못했습니다. 다시 시도해 주세요.';
    }
    result.entries[index] = entry;
    result = { ...result, entries: [...result.entries] };
    onProgress(result);
  }
  return result;
}

// Only positively identified batch copies are trashed. Never permanently delete,
// and never trash a folder that still holds an unfinished or unrelated document.
export async function cleanupFeedbackBatch(request, batch, onProgress = () => {}, { protectedFileIds = [] } = {}) {
  if (!batch?.id || !batch.folderId || !batch.entries?.length) throw new Error('정리할 묶음 폴더 정보를 찾을 수 없습니다.');
  const protectedIds = new Set(protectedFileIds.filter(Boolean).map(String));
  const assertTarget = (id) => {
    if (!/^[A-Za-z0-9_-]+$/.test(String(id)) || protectedIds.has(String(id))) throw new Error('학생 원본 또는 보호된 자료이므로 정리하지 않았습니다.');
  };
  const read = (id) => request(`${FILES}/${encodeURIComponent(id)}?fields=id,mimeType,appProperties,parents,trashed`);
  const folderMatches = (file) => file.id === batch.folderId && file.mimeType === 'application/vnd.google-apps.folder' && file.appProperties?.sseudamBatchId === batch.id;
  const documentMatches = (file, entry) => file.id === entry.docId && file.mimeType === 'application/vnd.google-apps.document' && file.appProperties?.sseudamBatchId === batch.id && file.appProperties?.sseudamEntryId === entry.id && file.parents?.includes(batch.folderId);
  const trash = async (file, matches) => {
    if (file.trashed) return;
    try {
      await request(`${FILES}/${encodeURIComponent(file.id)}?fields=id,trashed`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) });
    } catch (error) {
      // A response can be lost after a successful trash operation.
      const actual = await read(file.id).catch(() => null);
      if (!actual?.trashed || !matches(actual)) throw error;
    }
  };
  if (!batch.entries.some((entry) => entry.sentAt && hasFeedbackContent(entry))) throw new Error('학생에게 전송·저장한 피드백이 없어 임시 자료를 보관했습니다.');
  assertTarget(batch.folderId);
  const folder = await read(batch.folderId);
  if (!folderMatches(folder)) throw new Error('쓰담이 만든 묶음 폴더임을 확인할 수 없어 정리하지 않았습니다.');
  let result = { ...batch, entries: batch.entries.map((entry) => ({ ...entry })), cleanupError: '' };
  const errors = [];
  for (let index = 0; index < result.entries.length; index++) {
    const entry = result.entries[index];
    if (!entry.sentAt || !hasFeedbackContent(entry) || !entry.docId || entry.docTrashedAt) continue;
    try {
      assertTarget(entry.docId);
      const file = await read(entry.docId);
      if (!documentMatches(file, entry)) throw new Error('묶음용 복사 문서임을 확인할 수 없어 보관했습니다.');
      await trash(file, (actual) => documentMatches(actual, entry));
      result.entries[index] = { ...entry, docTrashedAt: new Date().toISOString(), cleanupError: '' };
    } catch (error) {
      errors.push(`${entry.number}번 ${entry.name}: ${error.message}`);
      result.entries[index] = { ...entry, cleanupError: error.message };
    }
    onProgress({ ...result, entries: [...result.entries] });
  }
  if (isFeedbackBatchComplete(result) && !errors.length && result.entries.every((entry) => !entry.docId || entry.docTrashedAt)) {
    try {
      if (!folder.trashed) {
        let pageToken = '';
        let hasRemainingFiles = false;
        do {
          const query = encodeURIComponent(`trashed = false and '${batch.folderId}' in parents`);
          const contents = await request(`${FILES}?q=${query}&pageSize=1000&fields=nextPageToken,files(id)&pageToken=${encodeURIComponent(pageToken)}`);
          hasRemainingFiles ||= Boolean(contents.files?.length);
          pageToken = contents.nextPageToken || '';
        } while (pageToken);
        if (hasRemainingFiles) throw new Error('폴더에 다른 자료가 남아 있어 폴더는 보관했습니다. 폴더 내용을 확인해 주세요.');
        // Re-read immediately before the folder mutation as well.
        const currentFolder = await read(batch.folderId);
        if (!folderMatches(currentFolder)) throw new Error('묶음 폴더 정보가 달라져 정리하지 않았습니다.');
        await trash(currentFolder, folderMatches);
      }
      result.cleanedAt = new Date().toISOString();
    } catch (error) { errors.push(error.message); }
  }
  result.cleanupError = errors.join('\n');
  onProgress(result);
  return result;
}
