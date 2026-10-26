import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, ExternalLink, FolderPlus, RefreshCw } from 'lucide-react';
import { prepareFeedbackBatchInDrive, pullBriskFeedbackFromGoogleDoc } from '../services/googleDriveService';
import {
  buildFeedbackPrompt, getFeedbackTopicRecord, getSubmissionSnapshot, hasFeedbackContent,
  isFeedbackCandidate, isMatchingSubmission, normalizeFeedbackCriteria, wasBatchFeedbackDelivered
} from '../utils/batchFeedback';

const buttonClass = 'sketch-btn-secondary min-h-11 px-4 py-2 text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed';
const fieldClass = 'w-full rounded-xl border border-[#CBD5E1] bg-white p-3 text-base leading-relaxed focus:outline-2 focus:outline-[#2D6A4F]';

export default function BatchFeedbackPanel({ topic, topics, students, config, googleAuth, onSaveCriteria, onSendFeedback }) {
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
  const [expanded, setExpanded] = useState(false);
  const [showCriteria, setShowCriteria] = useState(false);
  const [criteria, setCriteria] = useState(() => normalizeFeedbackCriteria(topic.feedbackCriteria));
  const [selectedNumbers, setSelectedNumbers] = useState(null);
  const [activeBatchId, setActiveBatchId] = useState(workspace[0]?.id || '');
  const [activeEntryId, setActiveEntryId] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [reuseTopicId, setReuseTopicId] = useState('');
  const [copyFallback, setCopyFallback] = useState('');
  const criteriaDirty = JSON.stringify(normalizeFeedbackCriteria(criteria)) !== JSON.stringify(normalizeFeedbackCriteria(topic.feedbackCriteria));

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
  const activeEntry = activeBatch?.entries.find((entry) => entry.id === activeEntryId) || activeBatch?.entries[0];
  const otherCriteriaTopics = topics.filter((item) => item.id !== topic.id && item.feedbackCriteria);

  const run = async (label, action) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setError(''); setMessage('');
    try { await action(); }
    catch (err) { setError(err.message || '처리하지 못했습니다. 다시 시도해 주세요.'); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); setCopyFallback(''); setMessage('피드백 기준을 복사했습니다. Brisk의 피드백 요청란에 붙여 넣어 주세요.'); }
    catch { setError('복사하지 못했습니다. 아래 요청문을 직접 선택해 복사해 주세요.'); setCopyFallback(text); }
  };
  const saveCriteria = () => run('기준 저장 중', async () => {
    const result = await onSaveCriteria(topic.id, normalizeFeedbackCriteria(criteria));
    if (!result?.ok) throw new Error(result?.error || '기준을 저장하지 못했습니다.');
    setMessage('이 주제의 피드백 기준을 저장했습니다. 다른 주제에서도 불러올 수 있습니다.');
  });
  const prepare = (existingBatch) => run('학생 문서 준비 중', async () => {
    if (!googleAuth?.accessToken) throw new Error('구글 로그인 후 묶음 피드백을 준비해 주세요.');
    if (!existingBatch && criteriaDirty) throw new Error('수정한 피드백 기준을 먼저 저장해 주세요.');
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
    saveBatch(batch); setActiveBatchId(batch.id); setActiveEntryId(batch.entries[0]?.id || '');
    const result = await prepareFeedbackBatchInDrive(googleAuth.accessToken, batch, saveBatch);
    const ready = result.entries.filter((entry) => entry.prepared).length;
    setSelectedNumbers(null);
    setMessage(`${result.entries.length}명 중 ${ready}명의 제출본을 준비했습니다. 폴더를 Brisk에서 가져와 피드백을 생성·확인해 주세요.`);
  });
  const importFeedback = () => run('묶음 첨삭 가져오는 중', async () => {
    if (!googleAuth?.accessToken) throw new Error('구글 로그인 후 가져와 주세요.');
    const batch = workspaceRef.current.find((item) => item.id === activeBatchId);
    let imported = 0; let empty = 0; let failed = 0; let stale = 0;
    for (const entry of batch.entries) {
      // Teacher edits and already imported feedback are retained on a repeated import.
      if (!entry.prepared || entry.sentAt || hasFeedbackContent(entry)) continue;
      if (!isMatchingSubmission(recordFor(entry.number), entry)) { stale++; continue; }
      try {
        const result = await pullBriskFeedbackFromGoogleDoc(googleAuth.accessToken, entry.docId, entry.text, { strictComments: true });
        if (!result) throw new Error('문서에서 첨삭을 읽지 못했습니다.');
        if (!result.pulledNote?.trim() && !result.pulledComments?.length) {
          empty++; updateEntry(batch.id, entry.id, { importError: '독스에 삽입된 첨삭이 아직 없습니다. Brisk에서 문서에 삽입한 뒤 다시 가져와 주세요.' });
        } else {
          updateEntry(batch.id, entry.id, { note: result.pulledNote || '', comments: result.pulledComments || [], reviewed: false, importError: '' });
          imported++;
        }
      } catch (err) { failed++; updateEntry(batch.id, entry.id, { importError: err.message }); }
    }
    setMessage(`가져옴 ${imported}명 · 첨삭 없음 ${empty}명 · 제출 변경 ${stale}명 · 오류 ${failed}명. 기존에 가져오거나 직접 작성한 첨삭은 유지했습니다.`);
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
    setMessage(`${sent}명에게 피드백을 전송했습니다.${failed ? ` ${failed}명은 전송하지 못했습니다. 학생별 안내를 확인해 주세요.` : ' 학생은 공책에서 조언을 읽고 고쳐 쓸 수 있습니다.'}`);
    const next = workspaceRef.current.find((item) => item.id === batchId)?.entries.find((entry) => !entry.sentAt);
    if (next) setActiveEntryId(next.id);
  });

  const editActive = (changes) => updateEntry(activeBatch.id, activeEntry.id, { ...changes, reviewed: false, sendError: '' });
  const activeStale = activeEntry && !activeEntry.sentAt && !isMatchingSubmission(recordFor(activeEntry.number), activeEntry);
  const reviewedEntries = activeBatch?.entries.filter((entry) => entry.reviewed && !entry.sentAt && hasFeedbackContent(entry) && isMatchingSubmission(recordFor(entry.number), entry)) || [];

  return (
    <section className="sketch-card bg-white p-4 sm:p-5" aria-label="묶음 피드백">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="min-h-11 text-left flex items-center gap-3 font-bold text-[#1B4332] cursor-pointer" aria-expanded={expanded} aria-controls="batch-feedback-workspace" onClick={() => setExpanded(!expanded)}>
          <FolderPlus aria-hidden="true" className="w-5 h-5" />
          <span>제출한 학생 묶어서 피드백 <span className="text-sm font-normal">· 새 대기 {candidates.length}명</span></span>
          {expanded ? <ChevronUp aria-hidden="true" className="w-4 h-4" /> : <ChevronDown aria-hidden="true" className="w-4 h-4" />}
        </button>
        <button type="button" className={buttonClass} onClick={() => { setExpanded(true); setShowCriteria(!showCriteria); }}>주제별 피드백 기준{topic.feedbackCriteria ? ' · 저장됨' : ''}</button>
      </div>
      {expanded && <div id="batch-feedback-workspace" className="mt-4 space-y-5">
        <p className="text-sm text-[#475569]">① 제출본만 폴더로 준비 → ② Brisk에서 기준을 붙여 넣고 묶음 피드백 생성·문서에 삽입 → ③ 여기서 첨삭을 가져와 확인·전송합니다. 다른 학생은 계속 작성할 수 있습니다.</p>
        {showCriteria && <div className="rounded-2xl border border-[#D8F3DC] bg-[#F2F9F5] p-4 space-y-3">
          <h2 className="font-bold text-[#1B4332]">이 주제의 피드백 기준</h2>
          {otherCriteriaTopics.length > 0 && <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-0 text-sm font-bold">다른 주제의 기준 불러오기
              <select className={`${fieldClass} mt-1`} value={reuseTopicId} onChange={(event) => setReuseTopicId(event.target.value)}>
                <option value="">주제를 선택하세요</option>
                {otherCriteriaTopics.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>
            <button type="button" disabled={!reuseTopicId || Boolean(busy)} className={buttonClass} onClick={() => setCriteria(normalizeFeedbackCriteria(topics.find((item) => item.id === reuseTopicId)?.feedbackCriteria))}>불러오기</button>
          </div>}
          <div className="grid md:grid-cols-2 gap-3">
            <div><label htmlFor="feedback-criteria-goal" className="text-sm font-bold">이번 수업의 목표</label><textarea id="feedback-criteria-goal" className={`${fieldClass} mt-1`} rows={3} value={criteria.goal} onChange={(event) => setCriteria({ ...criteria, goal: event.target.value })} placeholder="예: 경험한 일을 순서대로 생생하게 표현하기" /></div>
            <div><label htmlFor="feedback-criteria-items" className="text-sm font-bold">살펴볼 기준</label><textarea id="feedback-criteria-items" className={`${fieldClass} mt-1`} rows={3} value={criteria.criteria} onChange={(event) => setCriteria({ ...criteria, criteria: event.target.value })} placeholder="예: 사건의 순서 / 구체적인 장면 / 생각과 느낌" /></div>
          </div>
          <div><label htmlFor="feedback-criteria-guidance" className="block text-sm font-bold">피드백 방식</label><textarea id="feedback-criteria-guidance" className={`${fieldClass} mt-1`} rows={3} value={criteria.guidance} onChange={(event) => setCriteria({ ...criteria, guidance: event.target.value })} /></div>
          <div className="flex flex-wrap gap-2 items-center">
            <button type="button" className="sketch-btn-primary min-h-11 px-4 py-2 text-sm font-bold disabled:opacity-50" disabled={Boolean(busy) || !criteriaDirty} onClick={saveCriteria}>이 주제에 기준 저장</button>
            <button type="button" className={buttonClass} onClick={() => copyText(buildFeedbackPrompt(topic, criteria))}><Copy aria-hidden="true" className="w-4 h-4" />기준 복사</button>
            <span className="text-sm text-[#475569]">{criteriaDirty ? '수정한 기준을 저장해 주세요.' : '기준은 학급 데이터와 함께 저장됩니다.'}</span>
          </div>
          <details className="text-sm"><summary className="cursor-pointer py-2">Brisk에 넣을 전체 요청문 보기</summary><pre className="whitespace-pre-wrap font-sans bg-white rounded-xl p-3 select-text">{buildFeedbackPrompt(topic, criteria)}</pre></details>
        </div>}

        <div className="rounded-2xl border border-[#CBD5E1] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-[#1B4332]">새 묶음 준비 · {chosen.length}명 선택</h2>
            <div className="flex gap-2"><button type="button" className="min-h-11 px-2 text-sm underline cursor-pointer" disabled={Boolean(busy)} onClick={() => setSelectedNumbers(null)}>전체 선택</button><button type="button" className="min-h-11 px-2 text-sm underline cursor-pointer" disabled={Boolean(busy)} onClick={() => setSelectedNumbers([])}>선택 해제</button></div>
          </div>
          {candidates.length ? <div className="flex flex-wrap gap-2">{candidates.map((record) => <label key={record.number} className="min-h-11 px-3 py-2 flex items-center gap-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-sm cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-[#1B4332]" disabled={Boolean(busy)} checked={selectedNumbers === null || selectedNumbers.includes(String(record.number))} onChange={(event) => {
              const numbers = selectedNumbers || candidates.map((item) => String(item.number));
              setSelectedNumbers(event.target.checked ? [...numbers, String(record.number)] : numbers.filter((number) => number !== String(record.number)));
            }} />{record.number}번 {record.name} · {getSubmissionSnapshot(record).round}차
          </label>)}</div> : <p className="text-sm text-[#64748B]">새로 묶을 제출본이 없습니다. 이미 준비한 학생은 아래 작업 기록에서 이어갈 수 있습니다.</p>}
          <button type="button" className="sketch-btn-primary min-h-11 px-4 py-2 text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed" disabled={Boolean(busy) || !chosen.length || criteriaDirty || !googleAuth?.accessToken} onClick={() => prepare()}><FolderPlus aria-hidden="true" className="w-4 h-4" />선택한 {chosen.length}명 폴더 준비</button>
          {!googleAuth?.accessToken && <p className="text-sm text-[#92400E]">구글 로그인 후 폴더를 준비할 수 있습니다.</p>}
          {criteriaDirty && <p className="text-sm text-[#92400E]">주제별 피드백 기준의 변경 내용을 먼저 저장해 주세요.</p>}
        </div>

        {workspace.length > 0 && <div className="space-y-4">
          <label className="block text-sm font-bold">준비한 묶음 이어하기<select className={`${fieldClass} mt-1`} value={activeBatchId} disabled={Boolean(busy)} onChange={(event) => { setActiveBatchId(event.target.value); setActiveEntryId(''); }}>
            {workspace.map((batch) => <option key={batch.id} value={batch.id}>{batch.label} · {batch.entries.length}명 · 전송 {batch.entries.filter((entry) => entry.sentAt).length}명</option>)}
          </select></label>
          {activeBatch && <>
            <div className="flex flex-wrap gap-2">
              {activeBatch.folderUrl && <a className={buttonClass} href={activeBatch.folderUrl} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" className="w-4 h-4" />묶음 폴더 열기</a>}
              <a className={buttonClass} href="https://app.briskteaching.com/" target="_blank" rel="noopener noreferrer">Brisk 열기</a>
              <button type="button" className={buttonClass} onClick={() => copyText(activeBatch.prompt)}><Copy aria-hidden="true" className="w-4 h-4" />이 묶음의 기준 복사</button>
              {activeBatch.entries.some((entry) => !entry.prepared) && <button type="button" className={buttonClass} disabled={Boolean(busy)} onClick={() => prepare(activeBatch)}>준비 실패·중단 문서 다시 준비</button>}
              <button type="button" className={buttonClass} disabled={Boolean(busy) || !activeBatch.entries.some((entry) => entry.prepared && !entry.sentAt)} onClick={importFeedback}><RefreshCw aria-hidden="true" className="w-4 h-4" />묶음 첨삭 가져오기</button>
            </div>
            <p className="text-sm text-[#475569]">Brisk에서 이 폴더의 학생 문서를 선택하세요. 생성한 피드백을 각 문서에 삽입한 뒤 가져올 수 있습니다. 검토 중인 기준은 묶음을 준비한 시점의 기준입니다.</p>
            <div className="grid lg:grid-cols-[240px_minmax(0,1fr)] gap-4">
              <div className="flex flex-col gap-2" aria-label="묶음 학생 목록">{activeBatch.entries.map((entry) => {
                const stale = !entry.sentAt && !isMatchingSubmission(recordFor(entry.number), entry);
                const status = entry.sentAt ? '전송 완료' : stale ? '제출 변경 · 전송 불가' : entry.error ? '문서 준비 오류' : !entry.prepared ? '문서 준비 대기' : entry.reviewed ? '교사 확인 완료' : hasFeedbackContent(entry) ? '교사 확인 대기' : 'Brisk 첨삭 대기';
                return <button type="button" key={entry.id} disabled={Boolean(busy)} aria-pressed={entry.id === activeEntry?.id} onClick={() => setActiveEntryId(entry.id)} className={`min-h-16 p-3 text-left rounded-xl border cursor-pointer ${entry.id === activeEntry?.id ? 'border-[#1B4332] bg-[#F2F9F5]' : 'border-[#CBD5E1] bg-white'}`}><span className="block font-bold">{entry.number}번 {entry.name} · {entry.round}차</span><span className="block text-sm text-[#475569]">{status}</span></button>;
              })}</div>
              {activeEntry && <div className="min-w-0 rounded-2xl border border-[#CBD5E1] p-4 space-y-4">
                <div className="flex flex-wrap gap-2 items-center justify-between"><h3 className="font-bold text-[#1B4332]">{activeEntry.name} · {activeEntry.pieceTitle || '제목 없음'}</h3>{activeEntry.docUrl && <a href={activeEntry.docUrl} target="_blank" rel="noopener noreferrer" className="text-sm underline min-h-11 flex items-center">이 제출본 독스 열기</a>}</div>
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
        {busy && <p role="status" className="text-sm font-bold text-[#1B4332]">{busy}… 창을 열어 둔 채 기다려 주세요.</p>}
        {message && <p role="status" className="text-sm font-bold text-[#1B4332] whitespace-pre-wrap">{message}</p>}
        {error && <p role="alert" className="text-sm text-[#B91C1C] whitespace-pre-wrap break-words">{error}</p>}
        {copyFallback && <label className="block text-sm font-bold">복사할 피드백 요청문<textarea readOnly className={`${fieldClass} mt-1`} rows={6} value={copyFallback} onFocus={(event) => event.target.select()} /></label>}
        {storageError && <p role="alert" className="text-sm text-[#B91C1C]">{storageError}</p>}
        <p className="text-xs text-[#64748B]">묶음 작업 기록·검토 중인 조언은 현재 브라우저에 자동 저장되고, 준비한 독스는 내 Drive에 보관됩니다. 전송한 조언과 주제별 기준은 학급 데이터에 저장됩니다.</p>
      </div>}
    </section>
  );
}
