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
