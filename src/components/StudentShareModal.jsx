import React, { useEffect, useRef, useState } from 'react';
import {
  generateQrMatrix,
  drawQrOnCanvas,
  downloadSingleQrPng,
  download15QrSheetPdf
} from '../utils/qrAndPdfHelper';
import {
  X,
  Copy,
  Check,
  Download,
  FileText,
  QrCode,
  Maximize2,
  Minimize2
} from 'lucide-react';

export default function StudentShareModal({
  isOpen,
  onClose,
  className = '우리 반',
  spreadsheetId = '',
  gasUrl = '',
  classId = '',
  classAccessKey = '',
  onOpenGasSetup
}) {
  const canvasRef = useRef(null);
  const giantCanvasRef = useRef(null);
  const fullscreenContainerRef = useRef(null);

  const [copied, setCopied] = useState(false);
  const [isGiantQrOpen, setIsGiantQrOpen] = useState(false);

  const baseOrigin =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : 'https://sseudam.example.com/';

  const isBackendReady = Boolean(spreadsheetId && gasUrl && classId && classAccessKey);
  const shareParams = new URLSearchParams({ student: '1' });
  if (spreadsheetId) shareParams.set('sheetId', spreadsheetId);
  if (gasUrl) shareParams.set('gasUrl', gasUrl);
  if (classId) shareParams.set('classId', classId);
  if (classAccessKey) shareParams.set('accessKey', classAccessKey);
  const shareUrl = `${baseOrigin}?${shareParams.toString()}`;

  // 기본 모달 안의 QR 캔버스 렌더링
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const matrix = generateQrMatrix(shareUrl);
    drawQrOnCanvas(ctx, matrix, 0, 0, 220, '#1B4332');
  }, [isOpen, shareUrl]);

  // TV 화면용 초대형 QR 캔버스 렌더링
  useEffect(() => {
    if (!isGiantQrOpen || !giantCanvasRef.current) return;
    const ctx = giantCanvasRef.current.getContext('2d');
    const matrix = generateQrMatrix(shareUrl);
    drawQrOnCanvas(ctx, matrix, 0, 0, 520, '#1B4332');
  }, [isGiantQrOpen, shareUrl]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {}
  };

  const handleOpenGiantQr = async () => {
    setIsGiantQrOpen(true);
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch (e) {}
  };

  const handleCloseGiantQr = async () => {
    setIsGiantQrOpen(false);
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch (e) {}
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4 overflow-y-auto">
        <div className="w-full max-w-2xl sketch-card bg-[#FBFBF9] p-6 sm:p-8 my-6 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-[#CBD5E1]">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-[#1B4332] text-white flex items-center justify-center">
                <QrCode className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-[#1B4332]">
                  학생 입장 링크 · QR 안내
                </h2>
                <p className="text-xs text-[#64748B]">
                  학생들은 로그인 없이 아래 링크나 QR로 들어와 [번호 + 이름]만 입력하면 바로 글을 씁니다.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-white border border-[#CBD5E1] text-[#64748B] hover:text-[#1E293B] cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 1. 학생 입장 링크 복사 */}
          <div className="sketch-card bg-white p-4 sm:p-5 space-y-2">
            <div className="text-xs font-bold text-[#1B4332]">
              1. 학생 입장 주소 (링크 복사)
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={shareUrl}
                className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] text-xs sm:text-sm font-mono font-bold text-[#1E293B]"
              />
              <button
                type="button"
                onClick={handleCopy}
                disabled={!isBackendReady}
                className="sketch-btn-primary px-4 py-2.5 text-xs sm:text-sm font-bold flex items-center gap-1.5 shrink-0 disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? '링크 복사됨!' : '링크 복사'}</span>
              </button>
            </div>
          </div>

          {/* 2. QR 코드 + 크게 보기(TV 전체화면) + QR 다운로드 + 15개 PDF 다운로드 */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 items-stretch">
            {/* 왼쪽: QR 코드 & 클릭 시 TV 화면용 크게 보기 */}
            <div className="sm:col-span-5 sketch-card bg-white p-5 flex flex-col items-center justify-between text-center gap-3">
              <span className="text-xs font-bold text-[#2D6A4F]">
                교실 TV 화면용 QR 코드
              </span>

              <button
                type="button"
                onClick={handleOpenGiantQr}
                disabled={!isBackendReady}
                className="p-2.5 rounded-2xl border-2 border-[#1B4332] bg-white hover:scale-[1.02] transition cursor-pointer group relative disabled:opacity-45 disabled:cursor-not-allowed"
                title="클릭하면 교실 TV용 전체화면으로 크게 확대됩니다"
              >
                <canvas
                  ref={canvasRef}
                  width={220}
                  height={220}
                  className="w-[180px] h-[180px] sm:w-[195px] sm:h-[195px]"
                />
              </button>

              <button
                type="button"
                onClick={handleOpenGiantQr}
                disabled={!isBackendReady}
                className="w-full sketch-btn-primary py-2.5 px-3 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-45 disabled:cursor-not-allowed"
              >
                <Maximize2 className="w-4 h-4" />
                <span>QR 크게 보기 (TV 전체화면)</span>
              </button>
            </div>

            {/* 오른쪽: QR 이미지 다운로드 & 15개 PDF 다운로드 */}
            <div className="sm:col-span-7 flex flex-col justify-between gap-3.5">
              <div className="sketch-card bg-white p-4 space-y-2.5">
                <div className="text-sm font-bold text-[#1B4332]">
                  단일 QR 이미지 다운로드 (.png)
                </div>
                <p className="text-xs text-[#64748B] leading-relaxed">
                  학급 알림장이나 게시판에 올릴 수 있는 QR 카드 이미지 파일입니다.
                </p>
                <button
                  type="button"
                  onClick={() => downloadSingleQrPng(shareUrl, className)}
                  disabled={!isBackendReady}
                  className="w-full sketch-btn-secondary py-2.5 px-4 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4" />
                  <span>QR 이미지 다운로드</span>
                </button>
              </div>

              <div className="sketch-card bg-[#F2F9F5] border-2 border-[#1B4332] p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-[#1B4332]">
                    학생 배부용 15개 QR 시트 (PDF)
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-[#1B4332] text-white text-[10px] font-bold">
                    A4 3열×5행
                  </span>
                </div>
                <p className="text-xs text-[#2D6A4F] leading-relaxed">
                  A4 용지 1장에 <strong>오려 쓰는 QR 스티커 15개</strong>가 담긴 인쇄용 PDF입니다. 출력해서 학생 공책이나 태블릿에 붙여 주세요!
                </p>
                <button
                  type="button"
                  onClick={() => download15QrSheetPdf(shareUrl, className)}
                  disabled={!isBackendReady}
                  className="w-full sketch-btn-primary py-3 px-4 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <FileText className="w-4 h-4" />
                  <span>15개 QR 시트 PDF 다운로드</span>
                </button>
              </div>
            </div>
          </div>

          {!isBackendReady && (
            <div className="rounded-2xl border-2 border-[#F59E0B] bg-[#FFFBEB] p-4 text-sm text-[#92400E] font-medium leading-relaxed space-y-2.5">
              <div className="flex items-start gap-2">
                <span className="text-base shrink-0">⚠️</span>
                <div>
                  <strong className="font-bold text-[#B45309]">학생 제출 연결(GAS 웹 앱)이 아직 완료되지 않았습니다.</strong>
                  <p className="text-xs text-[#92400E] mt-0.5">
                    학생이 작성한 글이 선생님의 구글 시트로 안전하게 전송되려면 1회 연결이 필요합니다. 연결 전에는 학생 글이 유실되지 않도록 QR 발급이 안전하게 보호됩니다.
                  </p>
                </div>
              </div>
              {onOpenGasSetup && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenGasSetup();
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs"
                >
                  <span>학생 제출 연결(GAS 3단계 설정) 바로가기</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* [교실 TV 화면용] 초대형 전체화면 QR 모달 */}
      {isGiantQrOpen && (
        <div
          ref={fullscreenContainerRef}
          onClick={handleCloseGiantQr}
          className="fixed inset-0 z-[70] bg-[#FBFBF9] flex flex-col items-center justify-center p-6 select-none"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="sketch-card bg-white p-8 sm:p-12 max-w-2xl w-full flex flex-col items-center text-center gap-5 border-4 border-[#1B4332]"
          >
            <div className="space-y-1">
              <span className="px-3.5 py-1 rounded-full bg-[#F2F9F5] border border-[#52B788] text-sm font-bold text-[#1B4332]">
                {className} · 쓰담 글쓰기 책장
              </span>
              <h2 className="text-2xl sm:text-4xl font-bold text-[#1B4332] font-editorial-serif pt-2">
                카메라로 QR 코드를 찍어 입장하세요!
              </h2>
              <p className="text-base sm:text-lg text-[#475569] font-semibold">
                입장 후 자신의 <strong>[출석 번호]</strong>와 <strong>[이름]</strong>을 입력하면 내 책장이 열립니다.
              </p>
            </div>

            <div className="p-4 rounded-3xl border-4 border-[#1B4332] bg-white shadow-md">
              <canvas
                ref={giantCanvasRef}
                width={520}
                height={520}
                className="w-[320px] h-[320px] sm:w-[460px] sm:h-[460px]"
              />
            </div>

            <div className="w-full flex items-center justify-between gap-4 pt-2">
              <span className="text-sm font-mono text-[#64748B] truncate">
                {shareUrl}
              </span>
              <button
                type="button"
                onClick={handleCloseGiantQr}
                className="sketch-btn-secondary px-5 py-2.5 text-sm font-bold flex items-center gap-2 shrink-0"
              >
                <Minimize2 className="w-4 h-4" />
                <span>크게 보기 닫기 (ESC)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
