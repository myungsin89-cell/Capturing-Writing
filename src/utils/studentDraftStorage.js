export const STUDENT_DRAFT_PREFIX = 'sseudam_local_draft_v2:';
export const MAX_DRAFT_HISTORY = 12;
const CHECKPOINT_MS = 30000;

export function getDraftOwner({ spreadsheetId = '', classId = '', student, topicId }) {
  if (!student?.number || !topicId) return null;
  return {
    spreadsheetId: String(spreadsheetId), classId: String(student.classId || classId),
    studentId: String(student.studentId || ''), number: String(student.number).trim(),
    name: String(student.name || '').trim().normalize('NFC'), topicId: String(topicId)
  };
}

export function getStudentDraftKey(owner) {
  return owner ? STUDENT_DRAFT_PREFIX + encodeURIComponent(JSON.stringify(owner)) : '';
}

export function getDraftBase(record = {}) {
  const history = Array.isArray(record.draftHistory) && record.draftHistory.length
    ? record.draftHistory.filter((draft) => String(draft?.text || '').trim())
    : [record.draft1, record.draft2, record.draft3, record.draft4, record.draft5]
      .filter((text) => String(text || '').trim()).map((text) => ({ text }));
  const latest = history.at(-1);
  const text = String(latest?.text || '');
  const pieceTitle = String(record.pieceTitle ?? latest?.pieceTitle ?? '');
  const key = JSON.stringify([history.length, pieceTitle, text, latest?.updatedAtIso || latest?.updatedAt || '']);
  return { key, text, pieceTitle };
}

export function sameDraftContent(a, b) {
  return Boolean(a && b && a.text === b.text && a.pieceTitle === b.pieceTitle);
}

export function readStudentDraft(storage, owner) {
  const raw = storage.getItem(getStudentDraftKey(owner));
  if (!raw) return { version: 2, owner, current: null, history: [] };
  const value = JSON.parse(raw);
  if (value.version !== 2 || JSON.stringify(value.owner) !== JSON.stringify(owner) || !Array.isArray(value.history)) {
    throw new Error('이 기기의 임시 글 정보를 읽지 못했습니다. 현재 글을 복사해 보관해 주세요.');
  }
  return value;
}

function addHistory(history, snapshot, reason) {
  if (!snapshot || (!snapshot.text && !snapshot.pieceTitle)) return history;
  if (history.some((item) => item.id === snapshot.id)) return reason === 'submitted'
    ? history.map((item) => item.id === snapshot.id ? { ...item, reason } : item) : history;
  return [{ ...snapshot, reason }, ...history].slice(0, MAX_DRAFT_HISTORY);
}

export function writeStudentDraft(storage, owner, draft, { expectedId, force = false, checkpoint = false, preserveSnapshot, reason = 'writing', now = Date.now(), id = globalThis.crypto.randomUUID() } = {}) {
  const previous = readStudentDraft(storage, owner);
  if (!force && expectedId !== undefined && (previous.current?.id || null) !== expectedId) {
    const error = new Error('다른 창에서 같은 공책을 수정했습니다. 글을 복사해 두고 한 창에서 이어 써 주세요.');
    error.code = 'DRAFT_CONFLICT';
    throw error;
  }
  const unchanged = sameDraftContent(previous.current, draft) && previous.current.baseKey === draft.baseKey && Boolean(previous.current.editingCompleted) === Boolean(draft.editingCompleted);
  let history = previous.history;
  if (preserveSnapshot) history = addHistory(history, preserveSnapshot, 'before-restore');
  const shrinking = previous.current?.text && draft.text.length < previous.current.text.length / 2;
  const removedTitle = previous.current?.pieceTitle && !draft.pieceTitle;
  const oldText = previous.current?.text || '';
  let prefix = 0; let suffix = 0;
  while (prefix < oldText.length && prefix < draft.text.length && oldText[prefix] === draft.text[prefix]) prefix++;
  while (suffix < oldText.length - prefix && suffix < draft.text.length - prefix && oldText.at(-1 - suffix) === draft.text.at(-1 - suffix)) suffix++;
  const replaced = oldText.length >= 8 && oldText.length - prefix - suffix >= Math.min(20, oldText.length / 2);
  const baseChanged = previous.current && previous.current.baseKey !== draft.baseKey;
  const lastHistoryTime = history[0]?.savedAt || 0;
  if (!unchanged && previous.current && (force || checkpoint || shrinking || removedTitle || replaced || baseChanged || now - lastHistoryTime >= CHECKPOINT_MS)) {
    history = addHistory(history, previous.current, reason);
  }
  const current = unchanged ? previous.current : { ...draft, id, savedAt: now };
  if (checkpoint) history = addHistory(history, current, reason);
  const bundle = { version: 2, owner, current, history };
  storage.setItem(getStudentDraftKey(owner), JSON.stringify(bundle));
  return bundle;
}

export function archiveSubmittedDraft(storage, owner, submitted, expectedId) {
  const bundle = readStudentDraft(storage, owner);
  const history = addHistory(bundle.history, submitted, 'submitted');
  const canClear = bundle.current?.id === expectedId && sameDraftContent(bundle.current, submitted);
  const next = { ...bundle, history, current: canClear ? null : bundle.current };
  storage.setItem(getStudentDraftKey(owner), JSON.stringify(next));
  return next;
}

export function getDraftRecoveryItems(bundle) {
  const seen = new Set();
  return [bundle.current, ...bundle.history].filter((item) => {
    if (!item || (!item.text && !item.pieceTitle)) return false;
    const key = JSON.stringify([item.pieceTitle, item.text]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function readLegacyStudentDraft(storage, number, topicId) {
  const raw = storage.getItem(`sseudam_local_draft_${String(number).trim()}_${topicId}`);
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object') return null;
  return { id: 'legacy', text: String(value.text || ''), pieceTitle: String(value.pieceTitle || ''), savedAt: Number(value.savedAt) || 0, reason: 'legacy' };
}
