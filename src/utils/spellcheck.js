export const MAX_SPELLCHECK_LENGTH = 10000;

// Keep exact offsets: manuscript spacing and paragraph breaks are never rewritten.
export function splitSpellcheckText(text, limit = 900) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + limit, text.length);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf('\n', end - 1), text.lastIndexOf(' ', end - 1));
      if (boundary > start + limit / 2) end = boundary + 1;
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
    }
    const part = text.slice(start, end);
    if (part.trim()) chunks.push({ text: part, start });
    start = end;
  }
  return chunks;
}

function occurrences(text, token) {
  const positions = [];
  let start = text.indexOf(token);
  while (start >= 0) {
    positions.push(start);
    start = text.indexOf(token, start + 1);
  }
  return positions;
}

export function mapSpellcheckSuggestions(text, suggestions, field, offset = 0) {
  return suggestions.flatMap((item, index) => {
    if (typeof item?.token !== 'string' || !item.token.trim()) return [];
    const original = item.token;
    const replacements = [...new Set((Array.isArray(item.suggestions) ? item.suggestions : [])
      .filter((value) => typeof value === 'string' && value.trim() && value !== original))];
    if (!replacements.length) return [];
    const matches = occurrences(text, original);
    if (!matches.length) return [];
    const context = typeof item.context === 'string' ? item.context : '';
    const contexts = context ? occurrences(text, context) : [];
    const contextualMatches = contexts.length ? matches.filter((position) => contexts.some((contextStart) =>
      position >= contextStart && position + original.length <= contextStart + context.length)) : [];
    const candidates = contextualMatches.length ? contextualMatches : matches;
    // An ambiguous repeated word remains a visible suggestion, without a guessed location.
    const start = candidates.length === 1 ? offset + candidates[0] : null;
    return [{ id: `${field}:${offset}:${index}`, field, original, suggestions: replacements,
      context, start, end: start === null ? null : start + original.length, changed: false }];
  });
}

export function rebaseSpellcheckResult(result, nextDocument) {
  const previous = result.document;
  if (previous.title === nextDocument.title && previous.text === nextDocument.text) return result;
  const edits = {};
  for (const field of ['title', 'text']) {
    const before = previous[field]; const after = nextDocument[field];
    if (before === after) continue;
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
    let oldEnd = before.length; let newEnd = after.length;
    while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd -= 1; newEnd -= 1; }
    edits[field] = { start, oldEnd, delta: after.length - before.length };
  }
  const issues = result.issues.map((issue) => {
    const edit = edits[issue.field];
    if (!edit || issue.changed || issue.start === null) return issue;
    let { start, end } = issue;
    if (edit.oldEnd <= start) { start += edit.delta; end += edit.delta; }
    else if (edit.start < end) return { ...issue, start: null, end: null, changed: true };
    if (nextDocument[issue.field].slice(start, end) !== issue.original) return { ...issue, start: null, end: null, changed: true };
    return { ...issue, start, end };
  });
  return { ...result, document: nextDocument, issues, dirty: true };
}
