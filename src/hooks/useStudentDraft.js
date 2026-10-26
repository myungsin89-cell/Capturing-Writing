import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  archiveSubmittedDraft, getDraftRecoveryItems, getStudentDraftKey, readLegacyStudentDraft,
  readStudentDraft, sameDraftContent, writeStudentDraft
} from '../utils/studentDraftStorage';

export default function useStudentDraft({ owner, base, enabled, editable, editingCompleted, isCompleted }) {
  const key = enabled ? getStudentDraftKey(owner) : '';
  const [pieceTitle, setTitleState] = useState('');
  const [text, setTextState] = useState('');
  const [savedAt, setSavedAt] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [bundle, setBundle] = useState(null);
  const [loadState, setLoadState] = useState(null);
  const contextRef = useRef(null);
  const optionsRef = useRef(null);
  optionsRef.current = { key, editable, editingCompleted, base };

  const reportError = useCallback((err) => {
    setSavedAt(0);
    setError(err.code === 'DRAFT_CONFLICT' ? err.message : '이 기기에 저장하지 못했어요. 창을 닫지 말고 글을 복사하거나 파일로 보관해 주세요.');
  }, []);

  const persist = useCallback((draft, { checkpoint = false, reason = 'writing', force = false, preserveSnapshot } = {}) => {
    const context = contextRef.current;
    if (!context?.key || context.key !== optionsRef.current.key) return false;
    try {
      const next = writeStudentDraft(localStorage, context.owner, draft, {
        expectedId: context.expectedId, checkpoint, reason, force, preserveSnapshot
      });
      context.expectedId = next.current?.id || null;
      context.draft = next.current;
      context.dirty = false;
      setBundle(next); setSavedAt(next.current?.savedAt || 0); setError('');
      return true;
    } catch (err) { context.dirty = true; reportError(err); return false; }
  }, [reportError]);

  useLayoutEffect(() => {
    if (!key) {
      contextRef.current = null;
      setTitleState(base.pieceTitle); setTextState(base.text); setSavedAt(0);
      setBundle(null); setError(''); setNotice('');
      setLoadState({ id: crypto.randomUUID(), editingCompleted: false });
      return;
    }
    const previous = contextRef.current;
    let stored = null;
    let initial = { ...base, baseKey: base.key, editingCompleted: false };
    let message = '';
    let failure = null;
    try {
      stored = readStudentDraft(localStorage, owner);
      const current = stored.current;
      const canRestore = current && current.baseKey === base.key && (editable || (isCompleted && current.editingCompleted));
      if (canRestore) {
        initial = current;
        if (!sameDraftContent(current, base)) message = '이 기기에 보관한 임시 글을 자동으로 불러왔어요.';
      } else if (current && !sameDraftContent(current, base)) {
        message = '제출된 글과 다른 임시 글이 있어요. ‘이전 글 복구’에서 확인해 주세요.';
      }
      if (previous?.key === key && previous.dirty) {
        initial = previous.draft;
        message = '아직 저장되지 않은 작성 내용을 유지했어요. 글을 복사해 보관해 주세요.';
      }
    } catch (err) { failure = err; if (previous?.key === key) initial = previous.draft; }
    contextRef.current = {
      key, owner, expectedId: stored?.current?.id || null,
      draft: { id: initial.id, savedAt: initial.savedAt, pieceTitle: initial.pieceTitle || '', text: initial.text || '', baseKey: initial.baseKey || base.key, editingCompleted: Boolean(initial.editingCompleted) },
      dirty: Boolean(previous?.key === key && previous.dirty)
    };
    setTitleState(initial.pieceTitle || ''); setTextState(initial.text || '');
    setBundle(stored); setSavedAt(failure ? 0 : stored?.current && initial === stored.current ? stored.current.savedAt : 0);
    setError(''); setNotice(message);
    setLoadState({ id: crypto.randomUUID(), editingCompleted: Boolean(initial.editingCompleted) });
    if (failure) reportError(failure);
  }, [key, base.key]);

  const update = useCallback((changes) => {
    const context = contextRef.current;
    const options = optionsRef.current;
    if (!context || context.key !== options.key || !options.editable) return;
    const draft = { ...context.draft, ...changes, id: crypto.randomUUID(), savedAt: Date.now(), baseKey: options.base.key, editingCompleted: options.editingCompleted };
    context.draft = draft;
    if (changes.pieceTitle !== undefined) setTitleState(draft.pieceTitle);
    if (changes.text !== undefined) setTextState(draft.text);
    setNotice('');
    persist(draft);
  }, [persist]);
  const setPieceTitle = useCallback((value) => update({ pieceTitle: typeof value === 'function' ? value(contextRef.current?.draft.pieceTitle || '') : value }), [update]);
  const setText = useCallback((value) => update({ text: typeof value === 'function' ? value(contextRef.current?.draft.text || '') : value }), [update]);
  const flush = useCallback((reason = 'leaving') => {
    const context = contextRef.current;
    if (!context || (!context.draft.id && !context.dirty)) return true;
    return persist(context.draft, { checkpoint: true, reason });
  }, [persist]);

  useEffect(() => {
    if (!key) return;
    const beforeUnload = (event) => { if (!flush() || contextRef.current?.dirty) { event.preventDefault(); event.returnValue = ''; } };
    const pageHide = () => flush();
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    const storageChanged = (event) => {
      if (event.key !== key) return;
      try {
        const fresh = readStudentDraft(localStorage, contextRef.current.owner);
        if ((fresh.current?.id || null) !== contextRef.current.expectedId) {
          setBundle(fresh);
          const err = new Error('다른 창에서 같은 공책을 수정했어요. 한 창에서 이어 쓰고, 지금 글은 복사해 보관해 주세요.');
          err.code = 'DRAFT_CONFLICT'; reportError(err);
          contextRef.current.dirty = true;
        }
      } catch (err) { reportError(err); }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', pageHide);
    window.addEventListener('storage', storageChanged);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('pagehide', pageHide);
      window.removeEventListener('storage', storageChanged); document.removeEventListener('visibilitychange', visibility);
    };
  }, [key, flush, reportError]);

  const recovery = () => {
    const context = contextRef.current;
    if (!context) return { items: [], legacy: null };
    try {
      const fresh = readStudentDraft(localStorage, context.owner);
      return { items: getDraftRecoveryItems(fresh), legacy: readLegacyStudentDraft(localStorage, context.owner.number, context.owner.topicId) };
    } catch (err) { reportError(err); return { items: getDraftRecoveryItems(bundle || { current: null, history: [] }), legacy: null }; }
  };
  const restore = (snapshot, allowCompleted = false) => {
    if (!optionsRef.current.editable && !allowCompleted) return false;
    const draft = { pieceTitle: snapshot.pieceTitle || '', text: snapshot.text || '', baseKey: optionsRef.current.base.key, editingCompleted: allowCompleted || optionsRef.current.editingCompleted };
    const context = contextRef.current;
    // Preserve the visible edit even when another tab has written a newer current draft.
    if (!sameDraftContent(context.draft, snapshot)) persist(context.draft, { checkpoint: true, reason: 'before-restore' });
    if (!persist(draft, { checkpoint: true, reason: 'restored', force: true, preserveSnapshot: { ...context.draft, id: context.draft.id || crypto.randomUUID(), savedAt: context.draft.savedAt || Date.now() } })) return false;
    setTitleState(draft.pieceTitle); setTextState(draft.text); setNotice('선택한 임시 글을 복구했어요. 복구 전 글도 보관했어요.');
    return true;
  };
  const captureSubmission = () => {
    flush('before-submit');
    const context = contextRef.current;
    return context ? { owner: context.owner, key: context.key, draft: { ...context.draft, id: context.draft.id || crypto.randomUUID(), savedAt: context.draft.savedAt || Date.now() }, expectedId: context.expectedId } : null;
  };
  const submitted = (capture) => {
    if (!capture) return;
    try {
      const next = archiveSubmittedDraft(localStorage, capture.owner, capture.draft, capture.expectedId);
      if (contextRef.current?.key === capture.key) {
        contextRef.current.expectedId = next.current?.id || null;
        contextRef.current.dirty = false; setBundle(next); setSavedAt(0); setNotice('');
      }
    } catch (err) { reportError(err); }
  };
  return { pieceTitle, text, setPieceTitle, setText, savedAt, error, notice, loadState, flush, recovery, restore, captureSubmission, submitted, dismissNotice: () => setNotice(''), retry: () => flush('retry') };
}
