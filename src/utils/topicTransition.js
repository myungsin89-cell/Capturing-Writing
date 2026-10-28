export function isFreshTopicRecord(record = {}) {
  if (record.status !== 'STAGE_1_WRITING' || record.recalled) return false;
  const hasCurrentDraft = [
    record.draft1,
    record.draft2,
    record.draft3,
    record.draft4,
    record.draft5
  ].some((text) => String(text || '').trim());
  return !hasCurrentDraft && !String(record.pieceTitle || '').trim();
}

export function getUsableDraftHistory(record = {}) {
  if (isFreshTopicRecord(record)) return [];
  return Array.isArray(record.draftHistory)
    ? record.draftHistory.filter((draft) => String(draft?.text || '').trim())
    : [];
}

export function transitionStudentToNewTopic(
  student,
  { previousTopicId, classId, nowIso = new Date().toISOString() }
) {
  const previousRecord = {
    status: student.status,
    locked: Boolean(student.locked),
    pieceTitle: student.pieceTitle || '',
    draft1: student.draft1 || '',
    draft2: student.draft2 || '',
    draft3: student.draft3 || '',
    draft4: student.draft4 || '',
    draft5: student.draft5 || '',
    draftHistory: Array.isArray(student.draftHistory) ? student.draftHistory : [],
    teacherNote: student.teacherNote || '',
    feedbackItems: Array.isArray(student.feedbackItems) ? student.feedbackItems : [],
    docId: student.docId,
    docUrl: student.docUrl,
    updatedAt: student.updatedAt || '',
    updatedAtIso: student.updatedAtIso || ''
  };
  if (student.completedWriting) previousRecord.completedWriting = student.completedWriting;
  if (student.completionStars !== undefined) previousRecord.completionStars = student.completionStars;
  if (student.recalled) previousRecord.recalled = true;

  const nextStudent = {
    ...student,
    classId,
    historyByTopic: {
      ...(student.historyByTopic || {}),
      ...(previousTopicId ? { [previousTopicId]: previousRecord } : {})
    },
    status: 'STAGE_1_WRITING',
    locked: false,
    pieceTitle: '',
    draft1: '',
    draft2: '',
    draft3: '',
    draft4: '',
    draft5: '',
    draftHistory: [],
    teacherNote: '',
    feedbackItems: [],
    docId: 'DEMO_DOC_' + student.number,
    docUrl: 'https://docs.google.com/document/u/0/',
    updatedAt: '방금 생성됨',
    updatedAtIso: nowIso
  };
  delete nextStudent.recalled;
  delete nextStudent.completedWriting;
  delete nextStudent.completionStars;
  return nextStudent;
}

export function repairLeakedDraftHistory(student, previousTopicId) {
  if (!isFreshTopicRecord(student) || !student.draftHistory?.length || !previousTopicId) {
    return student;
  }
  const previousRecord = student.historyByTopic?.[previousTopicId];
  if (!previousRecord) return student;
  return {
    ...student,
    draftHistory: [],
    historyByTopic: {
      ...student.historyByTopic,
      [previousTopicId]: {
        ...previousRecord,
        draftHistory: previousRecord.draftHistory?.length
          ? previousRecord.draftHistory
          : student.draftHistory
      }
    }
  };
}
