export function questionBelongsToTopic(question = {}, topicId = '') {
  if (!topicId || !question.topicId) return true;
  return String(question.topicId) === String(topicId);
}
