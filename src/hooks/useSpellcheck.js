import { useEffect, useRef, useState } from 'react';
import { requestSpellcheck } from '../services/spellcheckService';
import { MAX_SPELLCHECK_LENGTH, rebaseSpellcheckResult } from '../utils/spellcheck';

export default function useSpellcheck({ owner, title, text, enabled }) {
  const [state, setState] = useState(null);
  const requestRef = useRef(null);
  const identity = JSON.stringify(owner);
  const current = useRef(null);
  current.current = { identity, enabled };
  useEffect(() => {
    setState(null);
    return () => { requestRef.current?.abort(); requestRef.current = null; };
  }, [identity, enabled]);
  useEffect(() => {
    setState((previous) => {
      if (!previous?.result) return previous;
      const result = rebaseSpellcheckResult(previous.result, { title, text });
      return result === previous.result ? previous : { ...previous, result };
    });
  }, [title, text, state?.result?.document]);

  const run = async () => {
    if (!enabled || requestRef.current) return;
    if (title.length + text.length > MAX_SPELLCHECK_LENGTH) {
      setState({ identity, status: 'error', error: '제목과 본문을 합쳐 10,000자까지 검사할 수 있어요.' }); return;
    }
    const controller = new AbortController(); requestRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 35000);
    setState({ identity, status: 'loading' });
    try {
      const result = await requestSpellcheck({ title, text }, controller.signal);
      if (current.current.identity !== identity || !current.current.enabled || requestRef.current !== controller) return;
      setState({ identity, status: 'done', result: { issues: result.issues, document: { title, text }, dirty: false } });
    } catch (error) {
      if (current.current.identity === identity && current.current.enabled && requestRef.current === controller) {
        setState({ identity, status: 'error', error: error.name === 'AbortError' ? '검사 시간이 길어지고 있어요. 잠시 뒤 다시 시도해 주세요.' : error.message });
      }
    } finally {
      clearTimeout(timeout);
      if (requestRef.current === controller) requestRef.current = null;
    }
  };
  return { state: state?.identity === identity ? state : null, run, dismiss: () => setState(null) };
}
