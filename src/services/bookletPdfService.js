import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { BOOKLET_PAGE, layoutBooklet, wrapBookletText } from '../utils/bookletLayout.js';

let fontBytesPromise;
function loadBookletFont() {
  if (!fontBytesPromise) {
    fontBytesPromise = fetch(new URL('fonts/gowun-batang/GowunBatang-Regular.ttf', new URL(import.meta.env.BASE_URL, location.origin)))
      .then((response) => {
        if (!response.ok) throw new Error('한글 글꼴을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.');
        return response.arrayBuffer();
      }).catch((error) => { fontBytesPromise = null; throw error; });
  }
  return fontBytesPromise;
}

export async function generateBookletPdf(snapshot, onProgress = () => {}) {
  onProgress('한글 글꼴을 준비하고 있어요...');
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // Keep the original glyph tables: subsetting this Korean font can produce
  // valid Unicode mappings but missing printed glyphs in PDF viewers.
  const font = await doc.embedFont(await loadBookletFont(), { subset: false });
  const supported = new Set(font.getCharacterSet());
  const unsupported = new Set();
  const clean = (value) => Array.from(String(value || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    '))
    .map((character) => {
      if (character === '\n') return character;
      if (/\p{Cc}/u.test(character)) return '';
      if (supported.has(character.codePointAt(0))) return character;
      unsupported.add(character);
      return supported.has(0x25a1) ? '\u25a1' : '?';
    }).join('');
  const printable = {
    ...snapshot, title: clean(snapshot.title), className: clean(snapshot.className),
    chapters: snapshot.chapters.map((chapter) => ({
      ...chapter, title: clean(chapter.title),
      works: chapter.works.map((work) => ({ ...work, pieceTitle: clean(work.pieceTitle), authorName: clean(work.authorName), text: clean(work.text) }))
    }))
  };
  const measure = (text, size) => font.widthOfTextAtSize(text, size);
  onProgress('문단을 나누고 목차 쪽수를 계산하고 있어요...');
  const layout = layoutBooklet(printable, measure);
  const { width, height, margin, bodySize, lineHeight } = BOOKLET_PAGE;
  const ink = rgb(0.12, 0.16, 0.2), green = rgb(0.106, 0.263, 0.196), muted = rgb(0.4, 0.45, 0.5);
  const draw = (page, text, top, size, align = 'left', color = ink, x = margin) => {
    if (!text) return;
    const textWidth = measure(text, size);
    const left = align === 'center' ? (width - textWidth) / 2 : align === 'right' ? width - margin - textWidth : x;
    page.drawText(text, { x: left, y: height - top, size, font, color });
  };
  const shortHeader = (text) => {
    const first = wrapBookletText(text, width - margin * 2 - 35, 9, measure)[0] || '';
    return first === text ? first : first + '...';
  };
  const titleBlock = (page, lines, start, size, align = 'left', color = ink) => {
    lines.forEach((line, index) => draw(page, line, start + index * (size + 11), size, align, color));
  };
  for (let index = 0; index < layout.pages.length; index++) {
    const model = layout.pages[index];
    const page = doc.addPage([width, height]);
    if (model.kind === 'cover') {
      draw(page, '우리 반 글모음', 132, 13, 'center', muted);
      let size = 30;
      let lines = model.titleLines;
      while (lines.length * (size + 11) > 235 && size > 16) { size -= 2; lines = wrapBookletText(printable.title, width - margin * 2, size, measure); }
      if (lines.length * (size + 11) > 235) throw new Error('문집 제목이 너무 길어요. 제목을 줄여 주세요.');
      titleBlock(page, lines, 248, size, 'center', green);
      page.drawLine({ start: { x: width / 2 - 28, y: height - 510 }, end: { x: width / 2 + 28, y: height - 510 }, thickness: 1, color: green });
      titleBlock(page, model.classLines, 552, 15, 'center');
      draw(page, printable.chapters.length + '개 주제 · ' + snapshot.includedCount + '편의 글', 642, 11, 'center', muted);
      draw(page, new Date(snapshot.createdAt).toLocaleDateString('ko-KR'), 696, 10, 'center', muted);
    } else if (model.kind === 'toc') {
      draw(page, '목차', 68, 25, 'left', green);
      for (const row of model.rows) {
        row.lines.forEach((line, lineIndex) => draw(page, line, row.top + lineIndex * 19, row.size, 'left', row.kind === 'chapter' ? green : ink, margin + (row.kind === 'work' ? 14 : 0)));
        draw(page, String(row.pageNumber), row.top, 11, 'right', muted);
      }
    } else if (model.kind === 'chapter') {
      draw(page, String(model.chapterIndex + 1).padStart(2, '0'), 152, 14, 'left', muted);
      let size = 25;
      let lines = model.titleLines;
      while (lines.length * (size + 11) > 350 && size > 15) { size -= 2; lines = wrapBookletText(model.chapterTitle, width - margin * 2, size, measure); }
      if (lines.length * (size + 11) > 350) throw new Error('주제 제목이 너무 길어요. 제목을 줄여 주세요.');
      titleBlock(page, lines, 220, size, 'left', green);
      draw(page, model.workCount + '편의 글', 650, 12, 'left', muted);
    } else {
      draw(page, shortHeader(model.chapterTitle), 32, 9, 'left', muted);
      model.titleLines.forEach((line, lineIndex) => draw(page, line, 60 + lineIndex * (model.titleSize + 8), model.titleSize, 'center'));
      const authorTop = 60 + model.titleLines.length * (model.titleSize + 8) + 12;
      model.authorLines.forEach((line, lineIndex) => draw(page, line, authorTop + lineIndex * 19, 12, 'right', muted));
      model.lines.forEach((line, lineIndex) => draw(page, line, model.bodyTop + lineIndex * lineHeight, bodySize));
    }
    if (index > 0) draw(page, String(index + 1), height - 30, 10, 'center', muted);
    if (index % 10 === 0) {
      onProgress((index + 1) + ' / ' + layout.pages.length + '쪽을 만들고 있어요...');
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  doc.setTitle(printable.title);
  doc.setAuthor(printable.className);
  doc.setCreator('쓰담 글쓰기 스튜디오');
  doc.setCreationDate(new Date(snapshot.createdAt));
  onProgress('PDF 파일을 저장하고 있어요...');
  const bytes = await doc.save();
  const filename = (snapshot.title + '.pdf').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  return { blob: new Blob([bytes], { type: 'application/pdf' }), filename, pageCount: layout.pages.length, unsupportedCharacters: [...unsupported] };
}
