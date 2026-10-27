import { isFinalWritingStatus } from './diffHelper.js';

// Final completion is separate from a round that has only received feedback.
export function groupTeacherRoster(entries, sortMode = 'priority') {
  const groups = { actionNeeded: [], inProgress: [], completed: [] };
  for (const entry of entries) {
    if (isFinalWritingStatus(entry.st?.status)) groups.completed.push(entry);
    else if (entry.needsAction) groups.actionNeeded.push(entry);
    else groups.inProgress.push(entry);
  }

  const byNumber = (a, b) => Number(a.st.number) - Number(b.st.number);
  const byPriority = (a, b) => (b.priorityScore || 0) - (a.priorityScore || 0) || byNumber(a, b);
  groups.actionNeeded.sort(sortMode === 'priority' ? byPriority : byNumber);
  groups.inProgress.sort(byNumber);
  // Keep unanswered questions visible within the completed group as well.
  groups.completed.sort(sortMode === 'priority' ? byPriority : byNumber);
  return groups;
}
