export const BOOKLET_PAGE = { width: 595.28, height: 841.89, margin: 54, bottom: 62, bodySize: 13, lineHeight: 23 };

// Explicit newlines (including blank paragraphs and indentation) survive wrapping.
export function wrapBookletText(text, width, size, measure) {
  const lines = [];
  for (const paragraph of String(text).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
    let line = '';
    for (const character of paragraph) {
      if (line && measure(line + character, size) > width) {
        const lastSpace = line.lastIndexOf(' ');
        const indent = line.match(/^\s*/)[0].length;
        if (lastSpace >= indent && lastSpace < line.length - 1) {
          lines.push(line.slice(0, lastSpace + 1));
          line = line.slice(lastSpace + 1);
        } else { lines.push(line); line = ''; }
      }
      line += character;
    }
    lines.push(line);
  }
  return lines;
}

export function layoutBooklet(snapshot, measure) {
  const { width, height, margin, bottom, bodySize, lineHeight } = BOOKLET_PAGE;
  const contentWidth = width - margin * 2;
  const bodyPages = [];
  const contents = [];
  snapshot.chapters.forEach((chapter, chapterIndex) => {
    contents.push({ kind: 'chapter', title: chapter.title, bodyPage: bodyPages.length });
    bodyPages.push({ kind: 'chapter', chapterIndex, chapterTitle: chapter.title, titleLines: wrapBookletText(chapter.title, contentWidth, 25, measure), workCount: chapter.works.length });
    for (const work of chapter.works) {
      contents.push({ kind: 'work', title: work.pieceTitle + ' · ' + work.authorName, bodyPage: bodyPages.length });
      const textLines = wrapBookletText(work.text.replace(/\n+$/, ''), contentWidth, bodySize, measure);
      let offset = 0;
      let continuation = false;
      while (offset < textLines.length) {
        const titleSize = continuation ? 15 : 20;
        const titleLines = wrapBookletText(work.pieceTitle, contentWidth, titleSize, measure);
        const authorLines = wrapBookletText(work.authorName, contentWidth, 12, measure);
        const bodyTop = 60 + titleLines.length * (titleSize + 8) + 12 + authorLines.length * 19 + 28;
        const capacity = Math.floor((height - bottom - bodyTop) / lineHeight) + 1;
        if (capacity < 1) throw new Error('작품 제목이나 이름이 너무 길어 인쇄할 수 없어요. 제목과 이름을 확인해 주세요.');
        bodyPages.push({ kind: 'work', chapterTitle: chapter.title, authorLines, titleLines, titleSize, continuation, bodyTop, lines: textLines.slice(offset, offset + capacity) });
        offset += capacity;
        continuation = true;
      }
    }
  });

  const tocPages = [];
  let rows = [], top = 112;
  for (const entry of contents) {
    const size = entry.kind === 'chapter' ? 13 : 11;
    const lines = wrapBookletText(entry.title, contentWidth - 45 - (entry.kind === 'work' ? 14 : 0), size, measure);
    const rowHeight = lines.length * 19 + (entry.kind === 'chapter' ? 14 : 7);
    if (rowHeight > height - bottom - 112) throw new Error('목차에 넣을 제목이 너무 길어요. 주제나 작품 제목을 줄여 주세요.');
    if (top + rowHeight > height - bottom && rows.length) {
      tocPages.push({ kind: 'toc', rows }); rows = []; top = 112;
    }
    rows.push({ ...entry, lines, size, top });
    top += rowHeight;
  }
  if (rows.length) tocPages.push({ kind: 'toc', rows });
  const bodyStart = 1 + tocPages.length;
  tocPages.forEach((page) => page.rows.forEach((row) => { row.pageNumber = bodyStart + row.bodyPage + 1; }));
  return {
    pages: [{ kind: 'cover', titleLines: wrapBookletText(snapshot.title, contentWidth, 30, measure), classLines: wrapBookletText(snapshot.className, contentWidth, 15, measure) }, ...tocPages, ...bodyPages],
    tocPageCount: tocPages.length
  };
}
