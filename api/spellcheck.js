import { checkWriting, validateSpellcheckInput } from '../server/spellcheck.js';

// Best-effort throttling per running function; no manuscript content is stored or logged.
export function createSpellcheckHandler(check = checkWriting) {
  const recentRequests = new Map();
  let inFlight = 0;
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (status, value) => res.status(status).json(value);
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(405, { error: 'POST 요청만 지원합니다.' }); }
    let origin;
    try { origin = new URL(req.headers.origin); } catch { /* Reject missing and malformed origins. */ }
    if (!origin || origin.host !== req.headers.host || !['https:', 'http:'].includes(origin.protocol)) {
      return reply(403, { error: '쓰담에서 다시 검사해 주세요.' });
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '') ||
        Number(req.headers['content-length'] || 0) > 100000) return reply(400, { error: '검사할 글을 확인해 주세요.' });
    let input;
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      input = validateSpellcheckInput(body);
    } catch (error) {
      return reply(400, { error: error.message === 'TOO_LONG' ? '제목과 본문을 합쳐 10,000자까지 검사할 수 있어요.' : '검사할 제목과 본문을 확인해 주세요.' });
    }
    const now = Date.now();
    for (const [key, entry] of recentRequests) if (now - entry.started > 60000) recentRequests.delete(key);
    const client = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const entry = recentRequests.get(client) || { started: now, count: 0 };
    if (entry.count >= 80 || inFlight >= 16 || recentRequests.size >= 1000) {
      res.setHeader('Retry-After', '10');
      return reply(429, { error: '잠시 뒤에 다시 검사해 주세요.' });
    }
    recentRequests.set(client, { ...entry, count: entry.count + 1 }); inFlight += 1;
    try { return reply(200, await check(input)); }
    catch { return reply(503, { error: '지금은 맞춤법 검사에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요.' }); }
    finally { inFlight -= 1; }
  };
}

export default createSpellcheckHandler();
