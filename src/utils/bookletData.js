import { getFeedbackTopicRecord, getSubmissionSnapshot } from './batchFeedback.js';

export function isClosedBookletTopic(topic) {
  return topic?.classLocked === true || topic?.classLocked === 'TRUE';
}

const inClass = (record, classId) => !record.classId || String(record.classId) === String(classId);

export function getBookletTopicSummary(topic, students, activeTopicId, classId) {
  const works = [];
  const excluded = [];
  const ordered = students.filter((student) => inClass(student, classId)).slice().sort(
    (a, b) => String(a.number).localeCompare(String(b.number), 'ko', { numeric: true })
  );
  for (const student of ordered) {
    const record = getFeedbackTopicRecord(student, topic, activeTopicId);
    const draft = getSubmissionSnapshot(record);
    const reason = record?.status !== 'FINAL_COMPLETED' ? '미완성'
      : !draft.text.trim() ? '본문 없음'
      : !draft.pieceTitle.trim() ? '작품 제목 없음' : '';
    if (reason) excluded.push({ number: String(student.number), name: String(student.name || ''), reason });
    else works.push({
      number: String(student.number),
      authorName: String(student.name || ''),
      pieceTitle: draft.pieceTitle.trim(),
      text: draft.text.replace(/\r\n?/g, '\n'),
      round: draft.round
    });
  }
  return {
    id: String(topic.id), title: String(topic.title || '글쓰기'),
    works, excluded, includedCount: works.length, excludedCount: excluded.length
  };
}

// Copy only publishable strings. No live records, teacher notes, IDs, or questions
// are retained, so student refreshes cannot alter an in-flight book.
export function createBookletSnapshot({ topics, students, selectedTopicIds, activeTopicId, classId, className, title, createdAt = new Date().toISOString() }) {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) throw new Error('문집 제목을 적어 주세요.');
  if (cleanTitle.length > 100) throw new Error('문집 제목은 100자 이내로 적어 주세요.');
  if (!classId) throw new Error('문집을 만들 학급을 먼저 선택해 주세요.');
  const ids = [...new Set((selectedTopicIds || []).map(String))];
  if (!ids.length) throw new Error('마감한 주제를 하나 이상 선택해 주세요.');
  const chapters = ids.map((id) => {
    const topic = topics.find((item) => String(item.id) === id && inClass(item, classId));
    if (!topic || !isClosedBookletTopic(topic)) throw new Error('선택한 주제가 삭제되었거나 마감이 해제됐어요. 주제를 다시 확인해 주세요.');
    return getBookletTopicSummary(topic, students, activeTopicId, classId);
  });
  const includedCount = chapters.reduce((total, chapter) => total + chapter.includedCount, 0);
  if (!includedCount) throw new Error('선택한 주제에 제목과 본문이 있는 최종 완성 글이 없어요.');
  return {
    title: cleanTitle, className: String(className || '우리 반').trim().slice(0, 80), createdAt,
    chapters: chapters.filter((chapter) => chapter.works.length > 0),
    omittedTopics: chapters.filter((chapter) => chapter.works.length === 0).map((chapter) => chapter.title),
    includedCount,
    excludedCount: chapters.reduce((total, chapter) => total + chapter.excludedCount, 0)
  };
}
