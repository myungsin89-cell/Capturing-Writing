import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import { prepareFeedbackBatchInDrive, pullBriskFeedbackFromGoogleDoc, cleanupFeedbackBatchInDrive } from '../services/googleDriveService';
import {
  BRISK_BATCH_FEEDBACK_URL, buildFeedbackPrompt, ensureKoreanFeedbackPrompt, getFeedbackTopicRecord, getSubmissionSnapshot, hasFeedbackContent,
  isFeedbackCandidate, isMatchingSubmission, wasBatchFeedbackDelivered, isFeedbackBatchComplete
} from '../utils/batchFeedback';

const buttonClass = 'sketch-btn-secondary min-h-11 px-4 py-2 text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed';
const fieldClass = 'w-full rounded-xl border border-[#CBD5E1] bg-white p-3 text-base leading-relaxed focus:outline-2 focus:outline-[#2D6A4F]';

export function BatchFeedbackWorkspace({ topic, students, config, googleAuth, onSendFeedback, selectedStudentNumber, onSelectStudent, children }) {
  const storageKey = `sseudam_feedback_batches_v1:${googleAuth?.user?.email || config.spreadsheetId || 'local'}:${config.activeClassId}:${topic.id}`;
  const [workspace, setWorkspace] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(saved) ? saved.filter((batch) => batch?.id && Array.isArray(batch.entries)) : [];
    } catch { return []; }
  });
  const workspaceRef = useRef(workspace);
  const currentRef = useRef({ students, config });
  currentRef.current = { students, config };
  const busyRef = useRef(false);
  const [selectedNumbers, setSelectedNumbers] = useState(null);
  const [activeBatchId, setActiveBatchId] = useState(workspace[0]?.id || '');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [copyFallback, setCopyFallback] = useState('');
  const [awaitingBriskBatchId, setAwaitingBriskBatchId] = useState('');
  const briskOpenedAtRef = useRef(0);

  const storeWorkspace = (next) => {
    workspaceRef.current = next;
    setWorkspace(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setStorageError(''); }
    catch { setStorageError('이 브라우저에 작업 기록을 저장하지 못했습니다. 창을 닫기 전에 피드백을 전송하거나 내용을 복사해 보관해 주세요.'); }
  };
  const saveBatch = (batch) => {
    const all = workspaceRef.current;
    storeWorkspace(all.some((item) => item.id === batch.id)
      ? all.map((item) => item.id === batch.id ? batch : item) : [batch, ...all]);
  };
  const updateEntry = (batchId, entryId, changes) => {
    const batch = workspaceRef.current.find((item) => item.id === batchId);
    if (batch) saveBatch({ ...batch, entries: batch.entries.map((entry) => entry.id === entryId ? { ...entry, ...changes } : entry) });
  };
  const recordFor = (number) => {
    const current = currentRef.current;
    const student = current.students.find((item) => String(item.number) === String(number));
    return getFeedbackTopicRecord(student && { ...student, classId: student.classId || current.config.activeClassId }, topic, current.config.activeTopicId);
  };
  useEffect(() => {
    let changed = false;
    const reconciled = workspaceRef.current.map((batch) => ({ ...batch, entries: batch.entries.map((entry) => {
      const record = recordFor(entry.number);
      if (!entry.sentAt && wasBatchFeedbackDelivered(record, entry)) {
        changed = true;
        return { ...entry, sentAt: record.batchFeedbackReceipt.sentAt, sendError: '' };
      }
      if (!entry.sentAt && entry.reviewed && !isMatchingSubmission(record, entry)) {
        changed = true;
        return { ...entry, reviewed: false };
      }
      return entry;
    }) }));
    if (changed) storeWorkspace(reconciled);
  }, [students, config.activeTopicId]);
  const candidates = students.map((student) => getFeedbackTopicRecord({ ...student, classId: student.classId || config.activeClassId }, topic, config.activeTopicId))
    .filter(isFeedbackCandidate)
    .filter((record) => !workspace.some((batch) => batch.entries.some((entry) => !entry.sentAt && isMatchingSubmission(record, entry))));
  const chosen = candidates.filter((record) => selectedNumbers === null || selectedNumbers.includes(String(record.number)));
  const activeBatch = workspace.find((batch) => batch.id === activeBatchId);
  const completedBatches = workspace.filter((batch) => isFeedbackBatchComplete(batch) && !batch.cleanedAt);
  const activeEntry = activeBatch?.entries.find((entry) => String(entry.number) === String(selectedStudentNumber));
  const criteriaChanged = activeBatch && activeBatch.prompt !== buildFeedbackPrompt(topic, topic.feedbackCriteria);

  const run = async (label, action) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setError(''); setMessage('');
    try { await action(); }
    catch (err) { setError(err.message || '처리하지 못했습니다. 다시 시도해 주세요.'); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const copyText = async (text) => {
    const koreanPrompt = ensureKoreanFeedbackPrompt(text);
    try { await navigator.clipboard.writeText(koreanPrompt); setCopyFallback(''); setMessage('한국어 피드백 기준을 복사했습니다. Brisk에서 언어를 Korean(한국어)으로 선택하고 피드백 요청란에 붙여 넣어 주세요.'); }
    catch { setError('복사하지 못했습니다. 아래 요청문을 직접 선택해 복사해 주세요.'); setCopyFallback(koreanPrompt); }
  };
  const prepare = (existingBatch) => run('학생 문서 준비 중', async () => {
    if (!googleAuth?.accessToken) throw new Error('구글 로그인 후 묶음 피드백을 준비해 주세요.');
    if (!existingBatch && !chosen.length) return;
    const batch = existingBatch || {
      id: crypto.randomUUID(), topicId: topic.id, classId: config.activeClassId,
      topicTitle: topic.title, label: new Date().toLocaleString('ko-KR'),
      parentFolderId: config.driveFolderId || '',
      prompt: buildFeedbackPrompt(topic, topic.feedbackCriteria),
      entries: chosen.map((record) => ({
        id: crypto.randomUUID(), classId: record.classId || config.activeClassId,
        number: record.number, name: record.name, ...getSubmissionSnapshot(record),
        note: '', comments: [], reviewed: false
      }))
    };
    saveBatch(batch); setActiveBatchId(batch.id); onSelectStudent(batch.entries[0]?.number || selectedStudentNumber);
    const result = await prepareFeedbackBatchInDrive(googleAuth.accessToken, batch, saveBatch);
    const ready = result.entries.filter((entry) => entry.prepared).length;
    setSelectedNumbers(null);
    setMessage(`${result.entries.length}명 중 ${ready}명의 제출본을 준비했습니다. 폴더를 Brisk에서 가져와 피드백을 생성·확인해 주세요.`);
  });
  const importFeedback = ({ batchId = activeBatchId, automatic = false } = {}) => run('묶음 첨삭 가져오는 중', async () => {
    if (!googleAuth?.accessToken) throw new Error('구글 로그인 후 가져와 주세요.');
    const batch = workspaceRef.current.find((item) => item.id === batchId);
    if (!batch) throw new Error('가져올 묶음을 먼저 준비해 주세요.');
    if (batch.cleanedAt) { setMessage('이 묶음은 전송과 임시 자료 정리가 끝났습니다. 저장된 조언을 아래에서 볼 수 있습니다.'); return; }
    let imported = 0; let empty = 0; let failed = 0; let stale = 0; let retained = 0;
    for (const entry of batch.entries) {
      // Teacher edits and already imported feedback are retained on a repeated import.
      if (!entry.prepared || entry.sentAt) continue;
      if (hasFeedbackContent(entry)) { retained++; continue; }
      if (!isMatchingSubmission(recordFor(entry.number), entry)) { stale++; continue; }
      try {
        const result = await pullBriskFeedbackFromGoogleDoc(googleAuth.accessToken, entry.docId, entry.text, { strictComments: true, sourceTitle: entry.pieceTitle, authorName: entry.name });
        if (!result) throw new Error('문서에서 첨삭을 읽지 못했습니다.');
        if (!isMatchingSubmission(recordFor(entry.number), entry)) { stale++; continue; }
        if (!result.pulledNote?.trim() && !result.pulledComments?.length) {
          empty++; updateEntry(batch.id, entry.id, { importError: '아직 Google Docs에 첨삭이 없습니다. Brisk에서 결과를 검토하고 문서에 삽입한 뒤 다시 확인해 주세요.' });
        } else {
          updateEntry(batch.id, entry.id, { note: result.pulledNote || '', comments: result.pulledComments || [], reviewed: false, importError: '' });
          imported++;
        }
      } catch (err) { failed++; updateEntry(batch.id, entry.id, { importError: err.message }); }
    }
    setMessage(`${automatic ? 'Brisk에서 돌아와 자동으로 확인했습니다. ' : ''}가져옴 ${imported}명 · 기존 첨삭 유지 ${retained}명 · 독스에 첨삭 없음 ${empty}명 · 제출 변경 ${stale}명 · 오류 ${failed}명.${empty ? ' Brisk 화면에서 생성만 한 결과는 읽을 수 없습니다. 결과를 문서에 삽입한 뒤 ‘전체 첨삭 다시 확인’을 눌러 주세요.' : ''}`);
  });

  const openBrisk = () => {
    if (!activeBatch || activeBatch.cleanedAt || busyRef.current) return;
    briskOpenedAtRef.current = Date.now();
    setAwaitingBriskBatchId(activeBatch.id);
    copyText(activeBatch.prompt || buildFeedbackPrompt(topic, topic.feedbackCriteria));
  };
  useEffect(() => {
    if (!awaitingBriskBatchId) return;
    let inFlight = false;
    let lastChecked = 0;
    const onReturn = () => {
      const now = Date.now();
      if (inFlight || document.hidden || busyRef.current || now - briskOpenedAtRef.current < 2000 || now - lastChecked < 10000) return;
      inFlight = true;
      lastChecked = now;
      importFeedback({ batchId: awaitingBriskBatchId, automatic: true }).finally(() => {
        inFlight = false;
        const batch = workspaceRef.current.find((item) => item.id === awaitingBriskBatchId);
        const pending = batch?.entries.some((entry) => entry.prepared && !entry.sentAt && !hasFeedbackContent(entry) && isMatchingSubmission(recordFor(entry.number), entry));
        if (!pending) setAwaitingBriskBatchId((current) => current === awaitingBriskBatchId ? '' : current);
      });
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => { window.removeEventListener('focus', onReturn); document.removeEventListener('visibilitychange', onReturn); };
  }, [awaitingBriskBatchId, googleAuth?.accessToken]);

  const cleanupOne = async (batchId) => {
    const batch = workspaceRef.current.find((item) => item.id === batchId);
    if (!batch || batch.cleanedAt) return batch;
    const current = currentRef.current;
    const protectedIds = [current.config.spreadsheetId, current.config.driveFolderId,
      ...current.students.flatMap((student) => [student.docId, ...Object.values(student.historyByTopic || {}).map((record) => record.docId)])];
    try {
      const cleaned = await cleanupFeedbackBatchInDrive(googleAuth?.accessToken, batch, saveBatch, protectedIds);
      if (cleaned.cleanedAt) setAwaitingBriskBatchId((id) => id === batchId ? '' : id);
      return cleaned;
    } catch (cause) {
      const preserved = { ...workspaceRef.current.find((item) => item.id === batchId), cleanupError: cause.message || '임시 자료를 정리하지 못했습니다.' };
      saveBatch(preserved);
      return preserved;
    }
  };
  const cleanupCompleted = () => run('완료한 묶음 폴더 정리 중', async () => {
    if (!googleAuth?.accessToken) throw new Error('구글 로그인 후 정리해 주세요.');
    const batches = workspaceRef.current.filter((batch) => isFeedbackBatchComplete(batch) && !batch.cleanedAt);
    let cleaned = 0;
    for (const batch of batches) if ((await cleanupOne(batch.id))?.cleanedAt) cleaned++;
    setMessage(`완료 묶음 ${cleaned}개를 휴지통으로 정리했습니다.${batches.length > cleaned ? ` ${batches.length - cleaned}개는 보관했습니다. 해당 묶음의 정리 안내를 확인해 주세요.` : ' 학생 글과 전송한 피드백은 학급 데이터에 그대로 남습니다.'}`);
  });
  const retryCleanup = () => run('임시 자료 정리 중', async () => {
    const cleaned = await cleanupOne(activeBatchId);
    setMessage(cleaned?.cleanedAt ? '완료한 묶음 폴더와 임시 독스를 휴지통으로 정리했습니다.' : cleaned?.cleanupError ? '임시 자료를 모두 정리하지 못했습니다. 정리 안내를 확인해 주세요.' : '전송을 마친 학생의 임시 독스를 정리했습니다. 나머지 문서는 전송이 끝날 때까지 보관합니다.');
  });
  const sendEntries = (entries) => run('확인한 피드백 전송 중', async () => {
    const batchId = activeBatch.id;
    let sent = 0; let failed = 0;
    for (const entry of entries) {
      if (!entry.reviewed || !hasFeedbackContent(entry) || entry.sentAt) continue;
      if (!isMatchingSubmission(recordFor(entry.number), entry)) {
        failed++; updateEntry(batchId, entry.id, { sendError: '학생이 제출을 회수하거나 글을 다시 제출했습니다. 새 제출본으로 준비해 주세요.' }); continue;
      }
      try {
        const result = await onSendFeedback({ topicId: topic.id, classId: activeBatch.classId, entry });
        if (!result?.ok) throw new Error(result?.error || '전송하지 못했습니다.');
        updateEntry(batchId, entry.id, { sentAt: new Date().toISOString(), sendError: '' }); sent++;
      } catch (err) { failed++; updateEntry(batchId, entry.id, { sendError: err.message }); }
    }
    const cleaned = sent > 0 ? await cleanupOne(batchId) : null;
    const cleanupMessage = cleaned?.cleanupError ? ' 피드백은 저장됐지만 임시 자료 정리는 일부 끝나지 않았습니다. 다시 정리할 수 있습니다.'
      : cleaned?.cleanedAt ? ' 묶음 폴더와 임시 독스를 휴지통으로 정리했습니다.'
      : cleaned ? ' 전송한 학생의 임시 독스를 정리했습니다. 나머지 문서는 보관합니다.' : '';
    setMessage(`${sent}명에게 피드백을 전송했습니다.${failed ? ` ${failed}명은 전송하지 못했습니다. 학생별 안내를 확인해 주세요.` : ' 학생은 공책에서 조언을 읽고 고쳐 쓸 수 있습니다.'}${cleanupMessage}`);
    const next = workspaceRef.current.find((item) => item.id === batchId)?.entries.find((entry) => !entry.sentAt);
    if (next) onSelectStudent(next.number);
  });

  const editActive = (changes) => updateEntry(activeBatch.id, activeEntry.id, { ...changes, reviewed: false, sendError: '' });
  const activeStale = activeEntry && !activeEntry.sentAt && !isMatchingSubmission(recordFor(activeEntry.number), activeEntry);
  const reviewedEntries = activeBatch?.entries.filter((entry) => entry.reviewed && !entry.sentAt && hasFeedbackContent(entry) && isMatchingSubmission(recordFor(entry.number), entry)) || [];

  const entryStatus = (entry) => {
    if (!entry) return '';
    if (entry.sentAt) return '전송 완료';
    if (!isMatchingSubmission(recordFor(entry.number), entry)) return '제출 변경 · 전송 불가';
    if (entry.error) return '문서 준비 오류';
    if (!entry.prepared) return '문서 준비 대기';
    if (entry.reviewed) return '교사 확인 완료';
    return hasFeedbackContent(entry) ? '교사 확인 대기' : 'Brisk 첨삭 대기';
  };
  const selectionFor = (number) => {
    const eligible = candidates.some((record) => String(record.number) === String(number));
    const entry = activeBatch?.entries.find((item) => String(item.number) === String(number));
    const inProgress = workspace.flatMap((batch) => batch.entries).find((item) => String(item.number) === String(number) && !item.sentAt && isMatchingSubmission(recordFor(number), item));
    return {
      eligible, checked: eligible && (selectedNumbers === null || selectedNumbers.includes(String(number))),
      status: entryStatus(entry || inProgress), inActiveBatch: Boolean(entry)
    };
  };
  const toggleCandidate = (number, checked) => {
    const numbers = selectedNumbers || candidates.map((record) => String(record.number));
    setSelectedNumbers(checked ? [...new Set([...numbers, String(number)])] : numbers.filter((item) => item !== String(number)));
  };
  const selectedRecord = recordFor(selectedStudentNumber);
  return children({
    topic, googleAuth, workspace, activeBatch, activeEntry, activeStale, criteriaChanged, candidates, chosen,
    busy, message, error, storageError, copyFallback, reviewedEntries, selectedRecord, awaitingBriskBatchId, completedBatches,
    selectionFor, toggleCandidate, selectWaiting: () => setSelectedNumbers(null), clearSelection: () => setSelectedNumbers([]),
    prepare, importFeedback, sendEntries, editActive, updateEntry, copyText, openBrisk, cleanupCompleted, retryCleanup,
    selectBatch: (id) => { setActiveBatchId(id); const batch = workspaceRef.current.find((item) => item.id === id); if (batch?.entries[0]) onSelectStudent(batch.entries[0].number); }
  });
}

export default function BatchFeedbackPanel({ model }) {
  const { topic, workspace, activeBatch, activeEntry, activeStale, criteriaChanged, chosen, selectedRecord,
    busy, message, error, storageError, copyFallback, reviewedEntries, awaitingBriskBatchId, completedBatches,
    prepare, importFeedback, sendEntries, editActive, updateEntry, copyText, openBrisk, cleanupCompleted, retryCleanup, selectBatch } = model;

  return (
    <section className="sketch-card bg-white p-4 sm:p-5" aria-label="묶음 피드백">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-bold text-[#1B4332]">묶음 피드백</h2><p className="text-sm text-[#64748B]">대상 선택 → 폴더 준비 → Brisk 일괄 첨삭 → 돌아와 확인·전송</p></div>
        <div className="flex flex-wrap gap-2">
          {completedBatches.length > 0 && <button type="button" className={buttonClass} disabled={Boolean(busy) || !model.googleAuth?.accessToken} onClick={cleanupCompleted}><Trash2 aria-hidden="true" className="w-4 h-4" />완료 묶음 폴더 {completedBatches.length}개 정리</button>}
          <button type="button" className={buttonClass} onClick={() => copyText(activeBatch?.prompt || buildFeedbackPrompt(topic, topic.feedbackCriteria))}><Copy aria-hidden="true" className="w-4 h-4" />기준 복사</button>
        </div>
      </div>
      <div className="mt-4 space-y-5">
        <div className="rounded-xl border border-[#D8F3DC] bg-[#F2F9F5] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-[#475569]">왼쪽 명단에서 {chosen.length}명을 선택했습니다.</p><button type="button" disabled={Boolean(busy) || !chosen.length || !model.googleAuth?.accessToken} onClick={() => prepare()} className="sketch-btn-primary min-h-11 px-5 py-2 text-sm font-bold disabled:opacity-50">선택한 {chosen.length}명 폴더 준비</button></div>
          {!model.googleAuth?.accessToken && <p className="text-xs text-[#92400E]">구글 로그인 후 폴더를 준비할 수 있습니다.</p>}
          {!chosen.length && activeBatch && <p className="text-xs text-[#64748B]">이미 준비한 학생은 아래 묶음에서 이어서 작업하세요. 새 제출본은 다시 선택할 수 있습니다.</p>}
        </div>

        <ol className="flex flex-wrap gap-2 text-xs font-bold text-[#475569]" aria-label="묶음 작업 순서"><li className="rounded-lg bg-[#F2F9F5] px-3 py-2">1. 명단 선택 · 폴더 준비</li><li className="rounded-lg bg-[#F8FAFC] px-3 py-2">2. Brisk 첨삭</li><li className="rounded-lg bg-[#F8FAFC] px-3 py-2">3. 확인 · 전송</li></ol>
        {!activeBatch && <p className="text-sm text-[#64748B]">위의 ‘폴더 준비’를 누르면 선택한 학생의 제출본을 별도 Google Drive 폴더에 모읍니다.</p>}

        {workspace.length > 0 && <div className="space-y-4">
          {workspace.length > 1 && <details className="text-sm"><summary className="cursor-pointer py-2 font-bold text-[#475569]">다른 묶음 선택 · 작업 기록 {workspace.length}개</summary><label className="block text-sm font-bold">준비한 묶음 이어하기<select className={`${fieldClass} mt-1`} value={activeBatch?.id || ''} disabled={Boolean(busy)} onChange={(event) => selectBatch(event.target.value)}>
            {workspace.map((batch) => <option key={batch.id} value={batch.id}>{batch.label} · {batch.entries.length}명 · 전송 {batch.entries.filter((entry) => entry.sentAt).length}명</option>)}
          </select></label></details>}
          {activeBatch && <>
            <p className="text-sm font-bold text-[#475569]">{activeBatch.label} · {activeBatch.entries.length}명 · 전송 {activeBatch.entries.filter((entry) => entry.sentAt).length}명</p>
            {activeBatch.cleanedAt && <p role="status" className="rounded-xl bg-[#F2F9F5] p-4 text-sm text-[#1B4332]">전송과 임시 자료 정리가 끝난 묶음입니다. 폴더와 묶음용 독스는 Drive 휴지통으로 옮겼고, 학생 글과 전송한 조언은 그대로 보관합니다.</p>}
            {activeBatch.cleanupError && <div className="rounded-xl bg-[#FFFBEB] p-3 space-y-2"><p role="alert" className="text-sm whitespace-pre-wrap text-[#92400E]">피드백은 전송됐지만 임시 자료 정리가 남았습니다.<br />{activeBatch.cleanupError}</p><button type="button" className={buttonClass} disabled={Boolean(busy) || !model.googleAuth?.accessToken} onClick={retryCleanup}>임시 자료 정리 다시 시도</button></div>}
            {criteriaChanged && <p className="text-sm text-[#92400E] rounded-xl bg-[#FFFBEB] p-3">현재 주제 기준이 변경되었습니다. 이 묶음의 ‘기준 복사’는 준비 당시 기준을 사용합니다.</p>}
            {!activeBatch.cleanedAt && <div className="flex flex-wrap gap-2">
              {activeBatch.folderUrl && <a className={buttonClass} href={activeBatch.folderUrl} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" className="w-4 h-4" />묶음 폴더 열기</a>}
              {activeBatch.entries.some((entry) => entry.prepared) && <a className={buttonClass} href={BRISK_BATCH_FEEDBACK_URL} target="_blank" rel="noopener noreferrer" aria-disabled={Boolean(busy)} onClick={(event) => { if (busy) event.preventDefault(); else openBrisk(); }}><ExternalLink aria-hidden="true" className="w-4 h-4" />Brisk 일괄 첨삭 열기</a>}
              {activeBatch.entries.some((entry) => !entry.prepared) && <button type="button" className={buttonClass} disabled={Boolean(busy)} onClick={() => prepare(activeBatch)}>준비 실패·중단 문서 다시 준비</button>}
              <button type="button" className={buttonClass} disabled={Boolean(busy) || !activeBatch.entries.some((entry) => entry.prepared && !entry.sentAt)} onClick={() => importFeedback()}><RefreshCw aria-hidden="true" className="w-4 h-4" />전체 첨삭 다시 확인</button>
            </div>}
            {!activeBatch.cleanedAt && <div className="rounded-xl bg-[#F8FAFC] p-4 text-sm text-[#475569] space-y-2">
              <p><b>Brisk 언어 설정:</b> 피드백 생성 단계에서 <b>Korean / 한국어</b>를 선택하고, 복사된 기준을 피드백 요청란에 붙여 넣어 주세요. 쓰담은 Brisk의 언어 선택을 직접 바꿀 수 없습니다.</p>
              <p><b>가져오기:</b> Brisk에서 결과를 검토하고 Google Docs에 삽입한 뒤 쓰담으로 돌아오면 묶음 전체를 자동으로 확인합니다. 쓰담에서 학생별로 ‘피드백 입력’을 누를 필요는 없습니다.</p>
              {awaitingBriskBatchId === activeBatch.id && <p role="status" className="font-bold text-[#1B4332]">Brisk 작업 후 돌아오면 자동으로 가져옵니다.</p>}
              <a href="https://help.briskteaching.com/hc/en-us/articles/40848467709716-How-can-I-give-feedback-to-multiple-students-at-once" target="_blank" rel="noopener noreferrer" className="text-xs underline">Brisk 공식 일괄 첨삭 안내</a>
            </div>}
            <div>
              {activeEntry && <div className="min-w-0 rounded-2xl border border-[#CBD5E1] p-4 space-y-4">
                <div className="flex flex-wrap gap-2 items-center justify-between"><h3 className="font-bold text-[#1B4332]">{activeEntry.name} · {activeEntry.pieceTitle || '제목 없음'}</h3>{activeEntry.docTrashedAt ? <span className="text-xs text-[#64748B]">전송 완료 · 임시 독스 정리됨</span> : activeEntry.docUrl && <a href={activeEntry.docUrl} target="_blank" rel="noopener noreferrer" className="text-sm underline min-h-11 flex items-center">이 제출본 독스 열기</a>}</div>
                <details open><summary className="cursor-pointer font-bold text-sm py-2">피드백 대상 · {activeEntry.round}차 제출본</summary><div className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-[#FBFBF9] border border-[#E2E8F0] p-4 text-base leading-8">{activeEntry.text}</div></details>
                {activeStale && <p role="alert" className="text-sm text-[#92400E] bg-[#FFFBEB] rounded-xl p-3">학생이 제출을 회수하거나 새 글을 제출했거나, 이미 다른 경로로 피드백을 받았습니다. 이 제출본의 피드백은 전송할 수 없습니다. 최신 글을 확인해 주세요.</p>}
                {[activeEntry.error, activeEntry.importError, activeEntry.sendError].filter(Boolean).map((text, index) => <p key={index} role="alert" className="text-sm text-[#B91C1C] whitespace-pre-wrap break-words">{text}</p>)}
                <div><label htmlFor="batch-feedback-note" className="block font-bold text-sm">학생에게 보낼 종합 조언</label><textarea id="batch-feedback-note" className={`${fieldClass} mt-1`} rows={7} disabled={Boolean(busy) || Boolean(activeEntry.sentAt)} value={activeEntry.note} onChange={(event) => editActive({ note: event.target.value })} placeholder="묶음 첨삭을 가져오거나, 교사가 직접 조언을 작성·붙여 넣어 주세요." /></div>
                {activeEntry.comments?.map((comment, index) => <div className="space-y-2 rounded-xl bg-[#F8FAFC] p-3" key={comment.id || index}>
                  <label className="block text-sm font-bold">인용 문장<input className={`${fieldClass} mt-1`} value={comment.quote || ''} disabled={Boolean(busy) || Boolean(activeEntry.sentAt)} onChange={(event) => editActive({ comments: activeEntry.comments.map((item, idx) => idx === index ? { ...item, quote: event.target.value } : item) })} /></label>
                  <label className="block text-sm font-bold">문장별 조언<textarea className={`${fieldClass} mt-1`} rows={2} value={comment.comment} disabled={Boolean(busy) || Boolean(activeEntry.sentAt)} onChange={(event) => editActive({ comments: activeEntry.comments.map((item, idx) => idx === index ? { ...item, comment: event.target.value } : item) })} /></label>
                </div>)}
                {!activeEntry.sentAt && <button type="button" className={buttonClass} disabled={Boolean(busy)} onClick={() => editActive({ comments: [...(activeEntry.comments || []), { id: crypto.randomUUID(), quote: '', comment: '' }] })}>문장별 조언 추가</button>}
                <label className="flex items-start gap-3 text-sm font-bold min-h-11 py-2"><input type="checkbox" className="mt-1 w-5 h-5 accent-[#1B4332]" disabled={Boolean(busy) || Boolean(activeEntry.sentAt) || activeStale || !hasFeedbackContent(activeEntry)} checked={Boolean(activeEntry.reviewed)} onChange={(event) => updateEntry(activeBatch.id, activeEntry.id, { reviewed: event.target.checked })} /><span>학생의 제출본과 조언을 읽고 확인했습니다. 내용을 수정하면 다시 확인해야 합니다.</span></label>
                <button type="button" className="sketch-btn-primary min-h-11 px-4 py-2 font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed" disabled={Boolean(busy) || Boolean(activeEntry.sentAt) || activeStale || !activeEntry.reviewed || !hasFeedbackContent(activeEntry)} onClick={() => sendEntries([activeEntry])}>{activeEntry.sentAt ? '학생에게 전송 완료' : '이 학생에게 보내고 다음 학생'}</button>
              </div>}
            </div>
            <div className="flex flex-wrap justify-between items-center gap-3 border-t border-[#E2E8F0] pt-4">
              <p className="text-sm text-[#475569]">전송하면 해당 학생의 고쳐 쓰기가 열립니다. 전체 마감 중이면 마감을 해제해야 학생이 다시 제출할 수 있습니다.</p>
              <button type="button" className={buttonClass} disabled={Boolean(busy) || !reviewedEntries.length} onClick={() => sendEntries(reviewedEntries)}><Check aria-hidden="true" className="w-4 h-4" />교사가 확인한 {reviewedEntries.length}명 함께 전송</button>
            </div>
          </>}
        </div>}
        {!activeEntry && selectedRecord && <div className="rounded-2xl border border-[#CBD5E1] p-4 space-y-3" aria-label="선택한 학생 글 미리보기"><h3 className="font-bold text-[#1B4332]">{selectedRecord.name} · {getSubmissionSnapshot(selectedRecord).pieceTitle || '제목 없음'}</h3><p className="text-sm text-[#64748B]">{activeBatch ? '현재 묶음에 포함되지 않은 학생입니다.' : '선택한 학생의 최신 글입니다.'}</p><div className="max-h-96 overflow-y-auto whitespace-pre-wrap leading-8">{getSubmissionSnapshot(selectedRecord).text || '아직 제출한 글이 없습니다.'}</div></div>}
        {busy && <p role="status" className="text-sm font-bold text-[#1B4332]">{busy}… 창을 열어 둔 채 기다려 주세요.</p>}
        {message && <p role="status" className="text-sm font-bold text-[#1B4332] whitespace-pre-wrap">{message}</p>}
        {error && <p role="alert" className="text-sm text-[#B91C1C] whitespace-pre-wrap break-words">{error}</p>}
        {copyFallback && <label className="block text-sm font-bold">복사할 피드백 요청문<textarea readOnly className={`${fieldClass} mt-1`} rows={6} value={copyFallback} onFocus={(event) => event.target.select()} /></label>}
        {storageError && <p role="alert" className="text-sm text-[#B91C1C]">{storageError}</p>}
        <p className="text-xs text-[#64748B]">피드백을 학생에게 전송·저장하면 해당 임시 독스를 정리하고, 모두 전송한 묶음의 폴더도 Drive 휴지통으로 옮깁니다. 가져오기만 한 조언과 미전송 문서는 보관합니다. 학생 글과 전송한 피드백은 학급 데이터에 남습니다.</p>
      </div>
    </section>
  );
}
