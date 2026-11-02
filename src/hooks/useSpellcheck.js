import { useEffect, useRef, useState } from 'react';
import { requestSpellcheck } from '../services/spellcheckService';
import { MAX_SPELLCHECK_LENGTH, rebaseSpellcheckResult } from '../utils/spellcheck';

export default function useSpellcheck({ owner, title, text, enabled }) {
  const [state, setState] = useState(null);
  const requestRef = useRef(null);
  const cachedRef = useRef(null);
  const lastRequestRef = useRef(0);
  const [clock, setClock] = useState(0);
  const [nextRequestAt, setNextRequestAt] = useState(0);
  const identity = JSON.stringify(owner);
  const current = useRef(null);
  current.current = { identity, enabled };
  useEffect(() => {
    setState(null);
    cachedRef.current = null;
    return () => { requestRef.current?.abort(); requestRef.current = null; };
  }, [identity, enabled]);
  useEffect(() => {
    if (!nextRequestAt) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= nextRequestAt) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [nextRequestAt]);
  useEffect(() => {
    setState((previous) => {
      if (!previous?.result) return previous;
      const result = rebaseSpellcheckResult(previous.result, { title, text });
      return result === previous.result ? previous : { ...previous, result };
    });
  }, [title, text, state?.result?.document]);

  const run = async () => {
    if (!enabled || requestRef.current) return;
    const cached = cachedRef.current;
    if (cached?.identity === identity && cached.document.title === title && cached.document.text === text) {
      setState({ identity, status: 'done', result: cached.result }); return;
    }
    if (Date.now() - lastRequestRef.current < 10000) return;
    if (title.length + text.length > MAX_SPELLCHECK_LENGTH) {
      setState({ identity, status: 'error', error: '제목과 본문을 합쳐 10,000자까지 검사할 수 있어요.' }); return;
    }
    const controller = new AbortController(); requestRef.current = controller;
    const now = Date.now();
    lastRequestRef.current = now; setClock(now); setNextRequestAt(now + 10000);
    const timeout = setTimeout(() => controller.abort(), 35000);
    setState({ identity, status: 'loading' });
    try {
      const result = await requestSpellcheck({ title, text }, controller.signal);
      if (current.current.identity !== identity || !current.current.enabled || requestRef.current !== controller) return;
      const checkedResult = { issues: result.issues, document: { title, text }, dirty: false };
      cachedRef.current = { identity, document: { title, text }, result: checkedResult };
      setState({ identity, status: 'done', result: checkedResult });
    } catch (error) {
      if (current.current.identity === identity && current.current.enabled && requestRef.current === controller) {
        setState({ identity, status: 'error', error: error.name === 'AbortError' ? '검사 시간이 길어지고 있어요. 잠시 뒤 다시 시도해 주세요.' : error.message });
      }
    } finally {
      clearTimeout(timeout);
      if (requestRef.current === controller) requestRef.current = null;
    }
  };
  const hasCached = cachedRef.current?.identity === identity && cachedRef.current.document.title === title && cachedRef.current.document.text === text;
  const waitSeconds = hasCached ? 0 : Math.max(0, Math.ceil((nextRequestAt - clock) / 1000));
  return { state: state?.identity === identity ? state : null, waitSeconds, run, dismiss: () => setState(null) };
}
