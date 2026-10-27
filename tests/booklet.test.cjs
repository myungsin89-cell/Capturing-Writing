const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const dataUrl = pathToFileURL(path.join(__dirname, '../src/utils/bookletData.js')).href;
const layoutUrl = pathToFileURL(path.join(__dirname, '../src/utils/bookletLayout.js')).href;
const work = (number, extra = {}) => ({ classId: 'C1', number, name: '학생' + number, status: 'FINAL_COMPLETED', pieceTitle: '작품' + number, draftHistory: [{ text: '  첫 문단\n\n  둘째 문단' }], teacherNote: '비공개 조언', feedbackItems: [{ comment: '첨삭 비공개' }], ...extra });
const topic = { id: 'T1', classId: 'C1', title: '제안하는 글', classLocked: true };
const options = (extra = {}) => ({ topics: [topic], students: [work('1')], selectedTopicIds: ['T1'], activeTopicId: 'T1', classId: 'C1', className: '4학년 1반', title: '우리들의 글', createdAt: '2026-10-27T03:00:00.000Z', ...extra });

test('문집은 같은 학급의 제목과 본문이 있는 최종 완성 글만 번호순으로 담는다', async () => {
  const { createBookletSnapshot } = await import(dataUrl);
  const snapshot = createBookletSnapshot(options({ students: [work('10'), work('2'), work('3', { status: 'FEEDBACK_DONE' }), work('4', { draftHistory: [] }), work('5', { pieceTitle: '' }), work('6', { classId: 'C2' })] }));
  assert.deepEqual(snapshot.chapters[0].works.map((entry) => entry.number), ['2', '10']);
  assert.deepEqual(snapshot.chapters[0].excluded.map((entry) => entry.reason), ['미완성', '본문 없음', '작품 제목 없음']);
  assert.equal(snapshot.includedCount, 2);
  assert.equal(snapshot.excludedCount, 3);
  assert.equal(JSON.stringify(snapshot).includes('비공개'), false);
});

test('지난 주제는 보관된 글만 사용하고 선택한 주제 순서를 유지한다', async () => {
  const { createBookletSnapshot } = await import(dataUrl);
  const student = work('1', { historyByTopic: { OLD: { status: 'FINAL_COMPLETED', pieceTitle: '옛 작품', draft1: '예전 주제 본문' } } });
  const snapshot = createBookletSnapshot(options({ topics: [topic, { ...topic, id: 'OLD', title: '지난 주제' }, { ...topic, id: 'EMPTY' }], students: [student], selectedTopicIds: ['OLD', 'T1', 'EMPTY', 'T1'] }));
  assert.deepEqual(snapshot.chapters.map((chapter) => chapter.id), ['OLD', 'T1']);
  assert.equal(snapshot.chapters[0].works[0].text, '예전 주제 본문');
  assert.equal(snapshot.chapters[1].works[0].text, '  첫 문단\n\n  둘째 문단');
  assert.equal(snapshot.omittedTopics.length, 1);
});

test('PDF 생성 시점 복사본은 뒤늦은 학생 수정이나 교사 상태 변경에 영향받지 않는다', async () => {
  const { createBookletSnapshot } = await import(dataUrl);
  const student = work('1');
  const snapshot = createBookletSnapshot(options({ students: [student] }));
  student.draftHistory[0].text = '나중에 수정한 글';
  student.status = 'REVISION_SUBMITTED';
  assert.equal(snapshot.chapters[0].works[0].text, '  첫 문단\n\n  둘째 문단');
  assert.equal(snapshot.includedCount, 1);
});

test('마감 해제·다른 학급 주제·빈 문집은 내보내지 않는다', async () => {
  const { createBookletSnapshot } = await import(dataUrl);
  assert.throws(() => createBookletSnapshot(options({ topics: [{ ...topic, classLocked: false }] })), /마감/);
  assert.throws(() => createBookletSnapshot(options({ topics: [{ ...topic, classId: 'C2' }] })), /주제/);
  assert.throws(() => createBookletSnapshot(options({ students: [work('1', { status: 'REVISION_SUBMITTED' })] })), /최종 완성/);
  assert.throws(() => createBookletSnapshot(options({ selectedTopicIds: [] })), /선택/);
});

test('문집 줄 나눔은 들여쓰기·빈 문단·글자를 잃지 않는다', async () => {
  const { wrapBookletText } = await import(layoutUrl);
  const measure = (text, size) => Array.from(text).length * size;
  assert.deepEqual(wrapBookletText('  첫 문단\n\n  둘째 문단', 200, 10, measure), ['  첫 문단', '', '  둘째 문단']);
  const text = '  긴 문장을 여러 줄로 나누되 공백과 문자가 사라지면 안 됩니다.';
  const lines = wrapBookletText(text, 80, 10, measure);
  assert.equal(lines.join(''), text);
  assert.ok(lines.every((line) => measure(line, 10) <= 80));
});

test('긴 글은 다음 쪽으로 이어지고 다음 학생은 새 쪽에서 시작한다', async () => {
  const { createBookletSnapshot } = await import(dataUrl);
  const { layoutBooklet } = await import(layoutUrl);
  const long = ('  긴 문단을 계속 이어서 씁니다.\n\n').repeat(80) + '마지막 문장 보존';
  const snapshot = createBookletSnapshot(options({ students: [work('1', { draftHistory: [{ text: long }] }), work('2')] }));
  const layout = layoutBooklet(snapshot, (text, size) => text.length * size);
  const first = layout.pages.filter((page) => page.kind === 'work' && page.titleLines.join('') === '작품1');
  assert.ok(first.length > 2);
  assert.equal(first[0].continuation, false);
  assert.ok(first.slice(1).every((page) => page.continuation));
  assert.equal(first.flatMap((page) => page.lines).join(''), long.replace(/\n/g, ''));
  assert.equal(first.at(-1).lines.at(-1), '마지막 문장 보존');
  const second = layout.pages.find((page) => page.kind === 'work' && page.titleLines.join('') === '작품2');
  assert.equal(second.continuation, false);
});

test('여러 쪽인 목차도 실제 주제·작품 시작 쪽을 가리킨다', async () => {
  const { createBookletSnapshot } = await import(dataUrl);
  const { layoutBooklet } = await import(layoutUrl);
  const snapshot = createBookletSnapshot(options({ students: Array.from({ length: 70 }, (_, i) => work(String(i + 1))) }));
  const layout = layoutBooklet(snapshot, (text, size) => text.length * size);
  assert.ok(layout.tocPageCount > 1);
  const rows = layout.pages.filter((page) => page.kind === 'toc').flatMap((page) => page.rows);
  assert.equal(rows.length, 71);
  for (const row of rows) {
    const destination = layout.pages[row.pageNumber - 1];
    assert.equal(destination.kind, row.kind);
    if (row.kind === 'work') assert.equal(destination.titleLines.join('') + ' · ' + destination.authorLines.join(''), row.title);
  }
});
