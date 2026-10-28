const SUBMITTED = new Set([
  'STAGE_1_SUBMITTED', 'STAGE_2_SUBMITTED', 'STAGE_3_COMPLETED', 'REVISION_SUBMITTED'
]);

export const BRISK_BATCH_FEEDBACK_URL = 'https://app.briskteaching.com/batch_feedback';
const KOREAN_FEEDBACK_INSTRUCTION = '피드백의 제목, 본문, 질문을 모두 한국어로만 작성해 주세요. 영어 항목명 대신 잘한 점, 고쳐볼 점, 생각해 볼 질문을 사용해 주세요.';

export function ensureKoreanFeedbackPrompt(prompt = '') {
  return prompt.includes(KOREAN_FEEDBACK_INSTRUCTION)
    ? prompt
    : [KOREAN_FEEDBACK_INSTRUCTION, prompt].filter(Boolean).join('\n\n');
}

export const DEFAULT_FEEDBACK_CRITERIA = {
  goal: '',
  criteria: '',
  guidance: '학생이 쓴 문장을 근거로 잘한 점 1가지와 먼저 고쳐 볼 점 1가지를 알려 주세요. 글을 대신 써 주지 말고, 스스로 고칠 수 있는 질문을 제시해 주세요.'
};

export function normalizeFeedbackCriteria(value = {}) {
  return Object.fromEntries(Object.keys(DEFAULT_FEEDBACK_CRITERIA).map((key) => [
    key, String(value?.[key] ?? DEFAULT_FEEDBACK_CRITERIA[key]).trim()
  ]));
}

export function buildFeedbackPrompt(topic, value) {
  const settings = normalizeFeedbackCriteria(value);
  return ensureKoreanFeedbackPrompt([
    '초등학생의 글을 읽고 학생 눈높이에 맞는 다정한 한국어로 피드백해 주세요.',
    `글쓰기 주제: ${topic.title || ''}`,
    topic.prompt && `학생에게 안내한 내용: ${topic.prompt}`,
    settings.goal && `이번 수업의 목표:\n${settings.goal}`,
    settings.criteria && `살펴볼 기준:\n${settings.criteria}`,
    settings.guidance && `피드백 방식:\n${settings.guidance}`,
    '각 학생의 글을 개별적으로 읽고, 해당 글에 있는 내용만 근거로 삼아 주세요.'
  ].filter(Boolean).join('\n\n'));
}

export function getFeedbackTopicRecord(student, topic, activeTopicId) {
  if (!student || !topic) return null;
  if (String(topic.id) === String(activeTopicId)) return student;
  const past = student.historyByTopic?.[topic.id] || {};
  return {
    classId: student.classId, number: student.number, name: student.name,
    ...past, status: past.status || 'STAGE_1_WRITING'
  };
}

export function getSubmissionSnapshot(record) {
  const history = Array.isArray(record?.draftHistory) && record.draftHistory.length
    ? record.draftHistory.filter((draft) => draft?.text?.trim())
    : [record?.draft1, record?.draft2, record?.draft3, record?.draft4, record?.draft5]
      .filter((text) => String(text || '').trim()).map((text) => ({ text }));
  const latest = history.at(-1);
  const text = String(latest?.text || '');
  const pieceTitle = String(record?.pieceTitle || latest?.pieceTitle || '');
  const round = history.length;
  const key = JSON.stringify([
    round, text, pieceTitle, record?.status || '',
    latest?.updatedAtIso || record?.updatedAtIso || latest?.updatedAt || record?.updatedAt || ''
  ]);
  return { text, pieceTitle, round, submissionKey: key };
}

export function isFeedbackCandidate(record) {
  return Boolean(record && SUBMITTED.has(record.status) && getSubmissionSnapshot(record).text.trim());
}

// Keep the teacher-approved edition separate from later personal revisions.
export function getCompletedWriting(record = {}) {
  const saved = record.completedWriting;
  if (saved && String(saved.text || '').trim()) {
    return { pieceTitle: String(saved.pieceTitle || ''), text: String(saved.text), completedAt: saved.completedAt || '' };
  }
  if (record.status !== 'FINAL_COMPLETED') return null;
  const latest = getSubmissionSnapshot(record);
  return latest.text.trim()
    ? { pieceTitle: latest.pieceTitle, text: latest.text, completedAt: record.updatedAtIso || '' }
    : null;
}

export function preserveCompletedWriting(record = {}) {
  const completedWriting = getCompletedWriting(record);
  return completedWriting ? { ...record, completedWriting } : record;
}

// Upgrade existing completed notebooks while the teacher has write access.
// Old relays preserve unknown fields, so later private saves retain this edition.
export function preserveStudentCompletedWritings(student) {
  let changed = false;
  const upgrade = (record) => {
    if (record?.status !== 'FINAL_COMPLETED' || record.completedWriting?.text?.trim()) return record;
    const next = preserveCompletedWriting(record);
    if (next !== record) changed = true;
    return next;
  };
  const next = upgrade(student);
  const historyByTopic = Object.fromEntries(Object.entries(student.historyByTopic || {})
    .map(([id, record]) => [id, upgrade(record)]));
  return changed ? { ...next, historyByTopic, updatedAtIso: nextRecordTimestamp([student]) } : student;
}

export function getClassCompletedWritings(state, classId, topicId, viewerNumber) {
  const legacyClassId = state.classes?.[0]?.id || state.config?.activeClassId || '';
  const inClass = (item) => String(item.classId || legacyClassId) === String(classId);
  const classTopics = (state.topics || []).filter(inClass);
  if (!classTopics.some((topic) => String(topic.id) === String(topicId))) {
    throw new Error('글쓰기 주제를 찾을 수 없습니다.');
  }
  const activeTopic = classTopics.find((topic) => topic.isActive) || classTopics[0];
  return (state.students || []).filter((student) => inClass(student) &&
    String(student.number).trim() !== String(viewerNumber).trim()).flatMap((student) => {
    const record = String(activeTopic?.id) === String(topicId)
      ? student : student.historyByTopic?.[topicId] || {};
    const writing = getCompletedWriting(record);
    return writing ? [{ number: String(student.number), name: String(student.name || ''), ...writing }] : [];
  }).sort((a, b) => a.number.localeCompare(b.number, 'ko', { numeric: true }));
}

export function isMatchingSubmission(record, entry) {
  return isFeedbackCandidate(record) &&
    String(record.number) === String(entry.number) &&
    String(record.classId || '') === String(entry.classId || '') &&
    getSubmissionSnapshot(record).submissionKey === entry.submissionKey;
}

export function hasFeedbackContent(entry) {
  return Boolean(entry.note?.trim() || entry.comments?.some((item) => item.comment?.trim()));
}

export function isFeedbackBatchComplete(batch) {
  return Boolean(batch?.entries?.length && batch.entries.every((entry) => entry.sentAt && hasFeedbackContent(entry)));
}

export function mergeImportedFeedback(current = {}, imported = {}) {
  const currentNote = String(current.note || '').trim();
  const importedNote = String(imported.note || '').trim();
  const note = !importedNote || currentNote.includes(importedNote)
    ? currentNote
    : [currentNote, importedNote].filter(Boolean).join('\n\n');
  const comments = Array.isArray(current.comments) ? [...current.comments] : [];
  const seen = new Set(comments.map((item) => JSON.stringify([
    String(item?.quote || '').trim(),
    String(item?.comment || '').trim()
  ])));
  for (const item of Array.isArray(imported.comments) ? imported.comments : []) {
    if (!String(item?.comment || '').trim()) continue;
    const key = JSON.stringify([
      String(item?.quote || '').trim(),
      String(item?.comment || '').trim()
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    comments.push(item);
  }
  return { note, comments };
}

export function nextRecordTimestamp(records = [], nowMs = Date.now()) {
  const latestRecordTime = records.reduce((latest, record) => {
    const parsed = Date.parse(record?.updatedAtIso || '');
    return Number.isFinite(parsed) ? Math.max(latest, parsed) : latest;
  }, 0);
  return new Date(Math.max(nowMs, latestRecordTime + 1)).toISOString();
}

export function updateWritingFeedbackRecord(record = {}, {
  status,
  locked,
  teacherNote,
  feedbackItems,
  updatedAtIso
}) {
  const nextFeedbackItems = Array.isArray(feedbackItems) ? feedbackItems : [];
  const nextRecord = {
    ...record,
    status: status || record.status,
    locked: locked !== undefined ? locked : record.locked,
    teacherNote: teacherNote !== undefined ? teacherNote : record.teacherNote,
    feedbackItems: feedbackItems !== undefined ? nextFeedbackItems : record.feedbackItems,
    updatedAtIso: updatedAtIso || record.updatedAtIso
  };
  if (status === 'FINAL_COMPLETED') {
    const latest = getSubmissionSnapshot(record);
    if (latest.text.trim()) nextRecord.completedWriting = {
      pieceTitle: latest.pieceTitle, text: latest.text,
      completedAt: updatedAtIso || record.updatedAtIso || ''
    };
  }
  if (Array.isArray(record.draftHistory) && record.draftHistory.length > 0 &&
      (teacherNote !== undefined || feedbackItems !== undefined)) {
    nextRecord.draftHistory = record.draftHistory.map((draft, index, all) => index === all.length - 1
      ? {
          ...draft,
          teacherNote: teacherNote !== undefined ? teacherNote : draft.teacherNote,
          feedbackItems: feedbackItems !== undefined ? nextFeedbackItems : draft.feedbackItems
        }
      : draft);
  }
  return nextRecord;
}

export function wasBatchFeedbackDelivered(record, entry) {
  return Boolean(entry?.id && record?.batchFeedbackReceipt?.entryId === entry.id);
}

export function applyFeedbackToStudent(student, { topicId, activeTopicId, entry, nowIso }) {
  const record = getFeedbackTopicRecord(student, { id: topicId }, activeTopicId);
  if (!isMatchingSubmission(record, entry)) return null;
  const feedbackItems = (entry.comments || []).filter((item) => item.comment?.trim());
  const nextRecord = {
    ...updateWritingFeedbackRecord(record, {
      status: 'FEEDBACK_DONE', locked: false, teacherNote: entry.note || '',
      feedbackItems, updatedAtIso: nowIso
    }),
    batchFeedbackReceipt: { entryId: entry.id, sentAt: nowIso }
  };
  return String(topicId) === String(activeTopicId)
    ? { ...student, ...nextRecord }
    : { ...student, historyByTopic: { ...student.historyByTopic, [topicId]: nextRecord }, updatedAtIso: nowIso };
}
