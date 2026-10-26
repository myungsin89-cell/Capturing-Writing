const SUBMITTED = new Set([
  'STAGE_1_SUBMITTED', 'STAGE_2_SUBMITTED', 'STAGE_3_COMPLETED', 'REVISION_SUBMITTED'
]);

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
  return [
    '초등학생의 글을 읽고 학생 눈높이에 맞는 다정한 한국어로 피드백해 주세요.',
    `글쓰기 주제: ${topic.title || ''}`,
    topic.prompt && `학생에게 안내한 내용: ${topic.prompt}`,
    settings.goal && `이번 수업의 목표:\n${settings.goal}`,
    settings.criteria && `살펴볼 기준:\n${settings.criteria}`,
    settings.guidance && `피드백 방식:\n${settings.guidance}`,
    '각 학생의 글을 개별적으로 읽고, 해당 글에 있는 내용만 근거로 삼아 주세요.'
  ].filter(Boolean).join('\n\n');
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

export function isMatchingSubmission(record, entry) {
  return isFeedbackCandidate(record) &&
    String(record.number) === String(entry.number) &&
    String(record.classId || '') === String(entry.classId || '') &&
    getSubmissionSnapshot(record).submissionKey === entry.submissionKey;
}

export function hasFeedbackContent(entry) {
  return Boolean(entry.note?.trim() || entry.comments?.some((item) => item.comment?.trim()));
}

export function wasBatchFeedbackDelivered(record, entry) {
  return Boolean(entry?.id && record?.batchFeedbackReceipt?.entryId === entry.id);
}

export function applyFeedbackToStudent(student, { topicId, activeTopicId, entry, nowIso }) {
  const record = getFeedbackTopicRecord(student, { id: topicId }, activeTopicId);
  if (!isMatchingSubmission(record, entry)) return null;
  const feedbackItems = (entry.comments || []).filter((item) => item.comment?.trim());
  const nextRecord = {
    ...record, status: 'FEEDBACK_DONE', locked: false,
    teacherNote: entry.note || '', feedbackItems, updatedAtIso: nowIso,
    batchFeedbackReceipt: { entryId: entry.id, sentAt: nowIso },
    draftHistory: record.draftHistory?.map((draft, index, all) => index === all.length - 1
      ? { ...draft, teacherNote: entry.note || '', feedbackItems } : draft)
  };
  return String(topicId) === String(activeTopicId)
    ? { ...student, ...nextRecord }
    : { ...student, historyByTopic: { ...student.historyByTopic, [topicId]: nextRecord }, updatedAtIso: nowIso };
}
