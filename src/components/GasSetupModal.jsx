import React, { useState } from 'react';
import {
  HandDrawnNotebookLogo,
  HandDrawnCheckIcon,
  HandDrawnSparkleIcon,
  HandDrawnLockIcon
} from './HandDrawnIcons';
import { X, Copy, Check, Link2, ExternalLink, RefreshCw } from 'lucide-react';
import gasCodeRaw from '../../gas/Code.gs?raw';

export default function GasSetupModal({
  isOpen,
  onClose,
  gasUrl,
  onSaveGasUrl,
  onTestConnection,
  onAutoSetup,
  isSyncing
}) {
  const [inputUrl, setInputUrl] = useState(gasUrl || '');
  const [copied, setCopied] = useState(false);
  const [showCodePreview, setShowCodePreview] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoMsg, setAutoMsg] = useState('');
  const [autoStatus, setAutoStatus] = useState('');

  if (!isOpen) return null;

  const handleAutoSetup = async () => {
    setAutoBusy(true);
    setAutoMsg('');
    try {
      const res = await onAutoSetup();
      setAutoStatus(res?.status || '');
      if (res?.status === 'api-disabled') {
        setAutoMsg('구글 설정에서 Apps Script API를 켜 주세요. 켠 뒤 다시 눌러 주세요.');
      } else if (res?.status === 'failed') {
        setAutoMsg('자동 연결에 실패했습니다. 아래 직접 연결하기를 이용해 주세요.');
      } else if (res?.gasUrl) {
        setInputUrl(res.gasUrl);
      }
    } finally {
      setAutoBusy(false);
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(gasCodeRaw);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      alert('클립보드 복사에 실패했습니다. 코드 미리보기를 열어 복사해 주세요.');
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    onSaveGasUrl(inputUrl.trim());
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl sketch-card bg-white p-5 sm:p-6 my-8 max-h-[90dvh] overflow-y-auto">
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between gap-3 pb-4 border-b border-[#E2E8F0]">
          <div className="flex items-center gap-2.5">
            <HandDrawnNotebookLogo size={38} isOpen={true} />
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#1B4332]">
                학생 제출용 Google Apps Script 연결
              </h2>
              <p className="text-xs text-[#475569]">
                학생은 Google 로그인 없이 번호와 이름으로 입장하고, 시트는 비공개로 유지합니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-[#64748B] hover:text-[#1E293B] hover:bg-[#F1F5F9] transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 자동 연결 */}
        <div className="mt-4 p-4 rounded-2xl bg-[#F2F9F5] border border-[#52B788] space-y-2.5">
          <div className="text-sm font-bold text-[#1B4332]">
            {gasUrl ? '학생 제출이 연결되어 있어요' : '버튼 한 번으로 학생 제출을 자동 연결해요'}
          </div>
          <p className="text-xs text-[#475569] leading-relaxed">
            선생님 구글 드라이브에 학생 제출용 중계기를 자동으로 만들고 배포합니다.
            코드 복사나 배포 설정은 필요 없습니다.
          </p>
          {onAutoSetup && !gasUrl && (
            <button
              type="button"
              disabled={isSyncing || autoBusy}
              onClick={handleAutoSetup}
              className="sketch-btn-primary px-4 py-2.5 text-xs sm:text-sm font-bold disabled:opacity-60"
            >
              {autoBusy ? '연결 중...' : '자동으로 연결하기'}
            </button>
          )}
          {autoMsg && (
            <div className="text-xs text-[#92400E] bg-[#FFFBEB] border border-[#F59E0B] rounded-xl p-2.5 leading-relaxed">
              {autoMsg}
              {autoStatus === 'api-disabled' && (
                <a
                  href="https://script.google.com/home/usersettings"
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 font-bold underline"
                >
                  Apps Script 설정 열기
                </a>
              )}
            </div>
          )}
          {gasUrl && (
            <div className="text-xs text-[#2D6A4F] leading-relaxed">
              처음 한 번은 아래 버튼으로 승인해 주세요. 열린 창에서 계정 선택 후
              [고급] → [이동] → [허용]을 누르면 끝입니다.
              <a
                href={gasUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-1 font-bold underline"
              >
                1회 승인하러 가기
              </a>
            </div>
          )}
        </div>

        {/* 수동 연결 안내 (자동 연결이 안 될 때만 펼쳐서 사용) */}
        <details className="mt-3">
          <summary className="text-xs font-semibold text-[#64748B] cursor-pointer">
            자동 연결이 안 되나요? 직접 연결하기
          </summary>
        <div className="mt-3 space-y-3">
          {/* 1단계 */}
          <div className="p-3.5 rounded-2xl bg-[#FBFBF9] border border-[#D8F3DC] flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
            <div className="flex items-start gap-2.5">
              <span className="w-6 h-6 rounded-full bg-[#1B4332] text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                1
              </span>
              <div className="text-xs sm:text-sm">
                  <div className="font-bold text-[#1B4332]">쓰담 데이터 시트에서 Apps Script 열기</div>
                <p className="text-[#475569] mt-0.5">
                    쓰담이 자동 생성한 데이터 시트를 연 뒤 상단 메뉴 <strong>[확장 프로그램] → [Apps Script]</strong>를 클릭합니다.
                </p>
              </div>
            </div>
            <a
              href="https://script.google.com/home"
              target="_blank"
              rel="noreferrer"
              className="sketch-btn-secondary px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 shrink-0 whitespace-nowrap"
            >
              <span>Apps Script 관리 열기</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {/* 2단계 */}
          <div className="p-3.5 rounded-2xl bg-[#FBFBF9] border border-[#D8F3DC]">
            <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
              <div className="flex items-start gap-2.5">
                <span className="w-6 h-6 rounded-full bg-[#1B4332] text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  2
                </span>
                <div className="text-xs sm:text-sm">
                  <div className="font-bold text-[#1B4332]">쓰담 전용 GAS 백엔드 코드 붙여넣기</div>
                  <p className="text-[#475569] mt-0.5">
                    우측 버튼을 눌러 코드를 복사한 뒤 <code>Code.gs</code>에 붙여넣고 저장(Ctrl+S)합니다.
                    <br />
                    <span className="text-[11px] text-[#2D6A4F]">
                      * 기존 배포를 수정하는 경우 코드를 저장한 뒤 반드시 <strong>새 버전으로 배포</strong>해 주세요.
                      독스 댓글 수집을 쓰려면 서비스(+)에서 <strong>Google Drive API (v3)</strong>도 추가합니다.
                    </span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowCodePreview(!showCodePreview)}
                  className="px-2.5 py-1.5 rounded-xl border border-[#CBD5E1] bg-white text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC] cursor-pointer"
                >
                  {showCodePreview ? '코드 접기' : '코드 보기'}
                </button>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="sketch-btn-primary px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? '복사 완료!' : 'Code.gs 전체 복사'}</span>
                </button>
              </div>
            </div>

            {showCodePreview && (
              <pre className="mt-3 p-3 rounded-xl bg-[#1E293B] text-[#E2E8F0] text-[11px] overflow-x-auto max-h-48 leading-relaxed">
                {gasCodeRaw}
              </pre>
            )}
          </div>

          {/* 3단계 */}
          <div className="p-3.5 rounded-2xl bg-[#F2F9F5] border border-[#52B788]">
            <div className="flex items-start gap-2.5">
              <span className="w-6 h-6 rounded-full bg-[#1B4332] text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                3
              </span>
              <div className="text-xs sm:text-sm w-full">
                <div className="font-bold text-[#1B4332]">
                  웹 앱 배포 (선생님 1회 OAuth 승인 · 학생 로그인 불필요)
                </div>
                <p className="text-[#2D6A4F] mt-0.5">
                  우측 상단 <strong>[배포] → [새 배포] → 유형: 웹 앱</strong> 선택 후 아래 두 가지를 설정하세요:
                </p>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded-xl bg-white border border-[#B7E4C7] flex items-center gap-2">
                    <HandDrawnCheckIcon size={15} color="#1B4332" />
                    <span>
                      실행 주체: <strong>나 (교사 계정)</strong>
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-white border border-[#B7E4C7] flex items-center gap-2">
                    <HandDrawnLockIcon size={15} locked={false} color="#1B4332" />
                    <span>
                      액세스 권한: <strong>모든 사용자</strong>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        </details>

        {/* URL 입력 폼 */}
        <form onSubmit={handleSave} className="mt-5 pt-4 border-t border-[#E2E8F0]">
          <label className="block text-xs sm:text-sm font-bold text-[#1B4332] mb-1.5">
            배포된 구글 앱스 스크립트 웹 앱 URL 입력
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Link2 className="w-4 h-4 text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="url"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-[#CBD5E1] text-xs sm:text-sm focus:outline-none focus:border-[#1B4332] bg-[#FBFBF9]"
              />
            </div>
            <button
              type="submit"
              className="sketch-btn-primary px-4 py-2.5 text-xs sm:text-sm font-bold whitespace-nowrap"
            >
              URL 저장 및 연결
            </button>
          </div>
          <div className="mt-2.5 flex items-center justify-between text-xs text-[#64748B] flex-wrap gap-2">
            <span>
               * URL을 비워두면 교사 화면은 로컬에서 체험할 수 있지만, 학생 기기의 글은 교사에게 전송되지 않습니다.
               Apps Script 및 Google 서비스 사용량 한도가 적용될 수 있습니다.
            </span>
            {gasUrl && (
              <button
                type="button"
                onClick={onTestConnection}
                disabled={isSyncing}
                className="text-[#1B4332] font-semibold underline flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>지금 시트와 동기화</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
