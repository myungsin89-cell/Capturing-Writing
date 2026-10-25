import QRCode from 'qrcode';

/**
 * ============================================================================
 * 순수 JS 기반 표준 QR 코드(ISO/IEC 18004) 생성기 & A4 15개 QR PDF 다운로드 헬퍼
 * 외부 서버나 인터넷 연결 없이도 100% 스마트폰 카메라로 스캔되는 실제 QR 코드와
 * 즉시 인쇄 가능한 A4 규격 PDF(3열 x 5행 = 15개) 파일을 생성합니다.
 * ============================================================================
 */

// Version 1~5 (ECC Level L, 단일 블록) 스펙 테이블
const QR_VERSIONS = [
  null,
  { v: 1, size: 21, totalCodewords: 26, ecCodewords: 7, align: [] },
  { v: 2, size: 25, totalCodewords: 44, ecCodewords: 10, align: [6, 18] },
  { v: 3, size: 29, totalCodewords: 70, ecCodewords: 15, align: [6, 22] },
  { v: 4, size: 33, totalCodewords: 100, ecCodewords: 20, align: [6, 26] },
  { v: 5, size: 37, totalCodewords: 134, ecCodewords: 26, align: [6, 30] }
];

// GF(256) 지수/로그 테이블 (원시 다항식 0x11d)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function getGeneratorPoly(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function computeReedSolomon(dataBytes, ecCount) {
  const gen = getGeneratorPoly(ecCount);
  const msg = new Uint8Array(dataBytes.length + ecCount);
  msg.set(dataBytes, 0);

  for (let i = 0; i < dataBytes.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return msg.slice(dataBytes.length);
}

/**
 * 입력 문자열(URL)을 표준 QR 2D 불리언 행렬(matrix[r][c])로 변환합니다.
 */
function generateLegacyQrMatrix(text = 'https://example.com') {
  const utf8Bytes = new TextEncoder().encode(text);
  // 106바이트 초과 시 앞부분 보존
  const payload = utf8Bytes.length > 104 ? utf8Bytes.slice(0, 104) : utf8Bytes;

  // 적절한 버전 선택
  let spec = QR_VERSIONS[5];
  for (let v = 1; v <= 5; v++) {
    const candidate = QR_VERSIONS[v];
    const maxDataBytes = candidate.totalCodewords - candidate.ecCodewords - 2;
    if (payload.length <= maxDataBytes) {
      spec = candidate;
      break;
    }
  }

  const dataCapacity = spec.totalCodewords - spec.ecCodewords;
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  // Byte mode (0100) + 글자 길이(8bit)
  pushBits(0b0100, 4);
  pushBits(payload.length, 8);
  for (let i = 0; i < payload.length; i++) {
    pushBits(payload[i], 8);
  }

  // 종료자(최대 4비트 0)
  const maxBits = dataCapacity * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) {
    bits.push(0);
  }
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  // 패딩 바이트 (0xEC, 0x11 교차)
  const dataBytes = new Uint8Array(dataCapacity);
  const byteLen = bits.length / 8;
  for (let i = 0; i < byteLen; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bits[i * 8 + j];
    }
    dataBytes[i] = b;
  }
  let padToggle = true;
  for (let i = byteLen; i < dataCapacity; i++) {
    dataBytes[i] = padToggle ? 0xec : 0x11;
    padToggle = !padToggle;
  }

  const ecBytes = computeReedSolomon(dataBytes, spec.ecCodewords);
  const allCodewords = new Uint8Array(spec.totalCodewords);
  allCodewords.set(dataBytes, 0);
  allCodewords.set(ecBytes, dataCapacity);

  const N = spec.size;
  const matrix = Array.from({ length: N }, () => new Array(N).fill(false));
  const reserved = Array.from({ length: N }, () => new Array(N).fill(false));

  const setFunctionModule = (r, c, isDark) => {
    if (r < 0 || r >= N || c < 0 || c >= N) return;
    matrix[r][c] = Boolean(isDark);
    reserved[r][c] = true;
  };

  // Finder 패턴 (좌상, 우상, 좌하)
  const drawFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r0 + dr;
        const cc = c0 + dc;
        if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const isBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const isInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunctionModule(rr, cc, inOuter && (isBorder || isInner));
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, N - 7);
  drawFinder(N - 7, 0);

  // Timing 패턴
  for (let i = 8; i < N - 8; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  // Alignment 패턴 (Version 2 이상)
  if (spec.align.length > 0) {
    const coords = spec.align;
    for (const r of coords) {
      for (const c of coords) {
        if (
          (r === 6 && c === 6) ||
          (r === 6 && c === N - 7) ||
          (r === N - 7 && c === 6)
        ) {
          continue;
        }
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const isDark =
              Math.abs(dr) === 2 ||
              Math.abs(dc) === 2 ||
              (dr === 0 && dc === 0);
            setFunctionModule(r + dr, c + dc, isDark);
          }
        }
      }
    }
  }

  // Dark 모듈 및 포맷 정보 영역 예약
  setFunctionModule(4 * spec.v + 9, 8, true);
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      if (!reserved[8][i]) reserved[8][i] = true;
      if (!reserved[i][8]) reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][N - 1 - i]) reserved[8][N - 1 - i] = true;
    if (!reserved[N - 1 - i][8]) reserved[N - 1 - i][8] = true;
  }

  // 데이터 비트 배치 (지그재그)
  let bitIdx = 0;
  const totalBits = allCodewords.length * 8;
  let upward = true;

  for (let right = N - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < N; vert++) {
      const r = upward ? N - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!reserved[r][c]) {
          let dark = false;
          if (bitIdx < totalBits) {
            const byteVal = allCodewords[bitIdx >>> 3];
            dark = ((byteVal >>> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          // Mask 0: (r + c) % 2 === 0
          if ((r + c) % 2 === 0) dark = !dark;
          matrix[r][c] = dark;
        }
      }
    }
    upward = !upward;
  }

  // Format Info (ECC Level L = 01, Mask 0 = 000 -> data = 01000 -> BCH + XOR 0x5412 = 0x77C4)
  const formatBits = 0x77c4;
  const getFmtBit = (i) => ((formatBits >>> i) & 1) === 1;

  for (let i = 0; i <= 5; i++) matrix[8][i] = getFmtBit(i);
  matrix[8][7] = getFmtBit(6);
  matrix[8][8] = getFmtBit(7);
  matrix[7][8] = getFmtBit(8);
  for (let i = 9; i < 15; i++) matrix[14 - i][8] = getFmtBit(i);

  for (let i = 0; i < 8; i++) matrix[8][N - 1 - i] = getFmtBit(i);
  for (let i = 8; i < 15; i++) matrix[N - 15 + i][8] = getFmtBit(i);

  return matrix;
}

/**
 * 긴 GAS 연결 주소도 자르지 않고 표준 QR 행렬로 변환합니다.
 */
export function generateQrMatrix(text = 'https://example.com') {
  try {
    const qr = QRCode.create(String(text), { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    const matrix = Array.from({ length: size }, () => Array(size).fill(false));
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        matrix[row][column] = Boolean(qr.modules.data[row * size + column]);
      }
    }
    return matrix;
  } catch (error) {
    console.warn('QR 생성 실패, 기본 QR로 대체합니다:', error);
    return generateLegacyQrMatrix('https://example.com');
  }
}

/**
 * 캔버스 위에 QR 코드를 선명하게 그리는 헬퍼
 */
export function drawQrOnCanvas(ctx, matrix, x, y, size, darkColor = '#1B4332') {
  const n = matrix.length;
  const quietZone = 2;
  const totalModules = n + quietZone * 2;
  const cell = size / totalModules;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(x, y, size, size);

  ctx.fillStyle = darkColor;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        const rx = Math.round(x + (c + quietZone) * cell);
        const ry = Math.round(y + (r + quietZone) * cell);
        const rw = Math.ceil(cell);
        const rh = Math.ceil(cell);
        ctx.fillRect(rx, ry, rw, rh);
      }
    }
  }
}

/**
 * 1. 단일 고해상도 QR 카드 PNG 이미지 다운로드
 */
export function downloadSingleQrPng(url, className = '우리 반 글쓰기 스튜디오') {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 860;
  const ctx = canvas.getContext('2d');

  // 배경
  ctx.fillStyle = '#FBFBF9';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 테두리 카드
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#1B4332';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(36, 36, canvas.width - 72, canvas.height - 72, 28);
  ctx.fill();
  ctx.stroke();

  // 상단 학급명
  ctx.fillStyle = '#1B4332';
  ctx.font = 'bold 34px Pretendard, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(className, canvas.width / 2, 115);

  ctx.fillStyle = '#2D6A4F';
  ctx.font = '600 22px Pretendard, sans-serif';
  ctx.fillText('쓰담 · 내 글쓰기 책장 입장 QR코드', canvas.width / 2, 158);

  // QR 코드 본체
  const matrix = generateQrMatrix(url);
  drawQrOnCanvas(ctx, matrix, 130, 195, 460, '#1B4332');

  // 하단 안내문
  ctx.fillStyle = '#1E293B';
  ctx.font = 'bold 24px Pretendard, sans-serif';
  ctx.fillText('카메라로 스캔한 뒤 [출석 번호 + 이름]을 입력해요!', canvas.width / 2, 715);

  ctx.fillStyle = '#64748B';
  ctx.font = '500 18px monospace';
  ctx.fillText(url.slice(0, 56), canvas.width / 2, 765);

  const dataUrl = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `쓰담_${className.replace(/\s+/g, '_')}_입장QR.png`;
  a.click();
}

/**
 * 2. A4 1장 안에 학생 배포용 QR 카드 15개(3열 × 5행)가 들어간 실제 PDF 파일 생성 및 즉시 다운로드!
 */
export function download15QrSheetPdf(url, className = '우리 반 글쓰기 스튜디오') {
  // A4 고해상도 캔버스 (1654 x 2339 px)
  const W = 1654;
  const H = 2339;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // 상단 시트 제목
  ctx.fillStyle = '#1B4332';
  ctx.font = 'bold 34px Pretendard, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    `${className} · 학생 책상/공책 부착용 입장 QR 시트 (15개)`,
    W / 2,
    68
  );

  ctx.fillStyle = '#64748B';
  ctx.font = '500 20px Pretendard, sans-serif';
  ctx.fillText(
    '점선을 따라 오려서 학생들의 태블릿 케이스나 글쓰기 공책 표지에 붙여 주세요.',
    W / 2,
    104
  );

  const matrix = generateQrMatrix(url);

  const cols = 3;
  const rows = 5;
  const marginX = 72;
  const topY = 135;
  const gridW = W - marginX * 2;
  const gridH = H - topY - 60;
  const cellW = gridW / cols;
  const cellH = gridH / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c + 1;
      const x = marginX + c * cellW;
      const y = topY + r * cellH;
      const pad = 12;
      const boxX = x + pad;
      const boxY = y + pad;
      const boxW = cellW - pad * 2;
      const boxH = cellH - pad * 2;

      // 오리기용 점선 테두리
      ctx.save();
      ctx.strokeStyle = '#94A3B8';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(boxX, boxY, boxW, boxH);
      ctx.restore();

      // 상단 학급명 & 번호칸
      ctx.fillStyle = '#1B4332';
      ctx.font = 'bold 21px Pretendard, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(className.slice(0, 18), boxX + boxW / 2, boxY + 36);

      ctx.fillStyle = '#2D6A4F';
      ctx.font = '600 17px Pretendard, sans-serif';
      ctx.fillText(`쓰담 글쓰기 책장 (#${idx})`, boxX + boxW / 2, boxY + 62);

      // 가운데 QR 코드
      const qrSize = 240;
      drawQrOnCanvas(
        ctx,
        matrix,
        boxX + (boxW - qrSize) / 2,
        boxY + 74,
        qrSize,
        '#1B4332'
      );

      // 하단 번호·이름 기입란 안내
      ctx.fillStyle = '#1E293B';
      ctx.font = 'bold 17px Pretendard, sans-serif';
      ctx.fillText('카메라 스캔 → [번호 + 이름] 입력', boxX + boxW / 2, boxY + 340);

      ctx.fillStyle = '#475569';
      ctx.font = '500 16px Pretendard, sans-serif';
      ctx.fillText('이름: _______________', boxX + boxW / 2, boxY + 375);
    }
  }

  // 캔버스 JPEG 바이트를 표준 PDF 1.4(A4 595.28 x 841.89 pt) 바이너리로 래핑하여 즉시 .pdf 다운로드
  const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const base64 = jpegDataUrl.split(',')[1];
  const imgBinaryStr = atob(base64);
  const imgBytes = new Uint8Array(imgBinaryStr.length);
  for (let i = 0; i < imgBinaryStr.length; i++) {
    imgBytes[i] = imgBinaryStr.charCodeAt(i);
  }

  const pdfBlob = buildSinglePageJpegPdfBlob(imgBytes, W, H);
  const blobUrl = URL.createObjectURL(pdfBlob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = `쓰담_${className.replace(/\s+/g, '_')}_QR스티커_15개.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
}

/**
 * JPEG 바이트 배열을 A4 1페이지 표준 PDF 1.4 Blob으로 변환
 */
function buildSinglePageJpegPdfBlob(jpegBytes, imgW, imgH) {
  const pageW = 595.28;
  const pageH = 841.89;
  const enc = new TextEncoder();
  const chunks = [];
  let offset = 0;
  const offsets = [0];

  const pushStr = (s) => {
    const b = enc.encode(s);
    chunks.push(b);
    offset += b.length;
  };
  const pushBytes = (b) => {
    chunks.push(b);
    offset += b.length;
  };

  pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

  // 1: Catalog
  offsets.push(offset);
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // 2: Pages
  offsets.push(offset);
  pushStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  // 3: Page
  offsets.push(offset);
  pushStr(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  );

  // 4: Image XObject
  offsets.push(offset);
  pushStr(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
  );
  pushBytes(jpegBytes);
  pushStr('\nendstream\nendobj\n');

  // 5: Page Content Stream
  const contentStream = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
  offsets.push(offset);
  pushStr(
    `5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`
  );

  // xref
  const xrefStart = offset;
  pushStr(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let i = 1; i < offsets.length; i++) {
    const offStr = String(offsets[i]).padStart(10, '0');
    pushStr(`${offStr} 00000 n \n`);
  }

  pushStr(
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  );

  return new Blob(chunks, { type: 'application/pdf' });
}
