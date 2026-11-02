export async function requestSpellcheck({ title, text }, signal) {
  // Do not include the student/session/class/relay data in this request.
  const response = await fetch('/api/spellcheck', {
    method: 'POST', credentials: 'omit', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, text })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(result?.issues)) {
    throw new Error(result?.error || '지금은 맞춤법 검사에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요.');
  }
  return result;
}
