// Measure the selected line without changing the auto-growing manuscript textarea.
export function focusWritingRange(input, start, end) {
  input.focus({ preventScroll: true });
  input.setSelectionRange(start, end);
  if (input.tagName !== 'TEXTAREA') { input.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  const style = getComputedStyle(input);
  const mirror = document.createElement('div');
  for (const property of ['box-sizing', 'padding', 'border', 'font-family', 'font-size', 'font-weight', 'font-style',
    'line-height', 'letter-spacing', 'word-spacing', 'white-space', 'word-break', 'overflow-wrap', 'tab-size', 'text-indent']) {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  }
  Object.assign(mirror.style, { position: 'fixed', top: '0', left: '-100000px', width: `${input.getBoundingClientRect().width}px`, visibility: 'hidden' });
  const marker = document.createElement('span');
  marker.textContent = input.value.slice(start, end) || '\u200b';
  mirror.append(document.createTextNode(input.value.slice(0, start)), marker, document.createTextNode(input.value.slice(end)));
  mirror.setAttribute('aria-hidden', 'true'); document.body.append(mirror);
  const lineTop = (marker.getClientRects()[0]?.top ?? mirror.getBoundingClientRect().top) - mirror.getBoundingClientRect().top;
  mirror.remove();
  const top = input.getBoundingClientRect().top + lineTop - window.innerHeight / 3;
  window.scrollBy({ top, behavior: 'smooth' });
}
