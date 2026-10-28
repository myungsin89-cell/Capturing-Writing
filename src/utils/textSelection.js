export const normalizeWritingText = (text = '') => String(text).replace(/\r\n?/g, '\n');

export function textFingerprint(text = '') {
  const value = normalizeWritingText(text);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return `${value.length}:${hash >>> 0}`;
}

export function createTextSelection(text, start, end) {
  const value = normalizeWritingText(text);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > value.length || start >= end) return null;
  const raw = value.slice(start, end);
  start += raw.length - raw.trimStart().length;
  end -= raw.length - raw.trimEnd().length;
  if (start >= end) return null;
  return { quote: value.slice(start, end), anchor: { start, end, textKey: textFingerprint(value) } };
}

export function resolveTextSelection(text, selection) {
  const value = normalizeWritingText(text);
  const quote = String(typeof selection === 'string' ? selection : selection?.quote || '').trim();
  if (!quote) return null;
  const anchor = typeof selection === 'object' ? selection?.anchor : null;
  if (anchor) {
    const { start, end, textKey } = anchor;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > value.length || start >= end ||
      textKey !== textFingerprint(value) || value.slice(start, end) !== quote) return null;
    return { start, end };
  }
  // Old/imported feedback has no position. Highlight only an unambiguous match.
  const start = value.indexOf(quote);
  return start >= 0 && value.indexOf(quote, start + 1) < 0 ? { start, end: start + quote.length } : null;
}

export function captureTextSelection(element, selection, text) {
  if (!element || !selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer) ||
    normalizeWritingText(element.textContent) !== normalizeWritingText(text)) return null;
  const prefix = element.ownerDocument.createRange();
  prefix.selectNodeContents(element);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = normalizeWritingText(prefix.toString()).length;
  return createTextSelection(text, start, start + normalizeWritingText(range.toString()).length);
}
