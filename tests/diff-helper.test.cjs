const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '../src/utils/diffHelper.js')).href;

function textContent(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  return textContent(node.props?.children);
}

test('교사 확인 화면은 학생 원문의 줄바꿈과 빈 줄을 추가 여백 없이 그대로 표시한다', async () => {
  const { renderTextWithHighlight } = await import(moduleUrl);
  const original = '  첫 문단 첫 줄\n첫 문단 둘째 줄\n\n  둘째 문단\n\n\n끝';
  const rendered = renderTextWithHighlight(original, '');
  assert.equal(rendered, original);
  assert.equal(textContent(rendered), original);
});

test('문장 형광펜을 켜도 원문의 문단과 줄바꿈은 바뀌지 않는다', async () => {
  const { renderTextWithHighlight } = await import(moduleUrl);
  const original = '첫 문장\r\n\r\n  강조할 문장\r\n마지막 문장';
  const rendered = renderTextWithHighlight(original, '강조할 문장');
  assert.equal(textContent(rendered), original.replace(/\r\n/g, '\n'));
  assert.equal(rendered.filter((item) => item?.type === 'mark').length, 1);
  assert.equal(rendered.some((item) => item?.type === 'p' || item?.type === 'div'), false);
});

test('학생은 새 차수로 넘어간 뒤에도 이전 차수 피드백을 볼 수 있다', async () => {
  const { getStudentFeedbackPages } = await import(moduleUrl);
  const pages = getStudentFeedbackPages({
    draftHistory: [
      {
        round: 1,
        text: '첫 번째 글',
        teacherNote: '첫 번째 글에 대한 종합 첨삭',
        feedbackItems: [{ id: 'F1', quote: '첫 번째 글', comment: '좋아요' }]
      },
      { round: 2, text: '두 번째 글', teacherNote: '', feedbackItems: [] }
    ],
    teacherNote: '',
    feedbackItems: []
  });

  assert.equal(pages.length, 1);
  assert.equal(pages[0].round, 1);
  assert.equal(pages[0].teacherNote, '첫 번째 글에 대한 종합 첨삭');
  assert.equal(pages[0].feedbackItems[0].comment, '좋아요');
});

test('예전 형식의 최신 피드백도 마지막 차수 피드백으로 표시한다', async () => {
  const { getStudentFeedbackPages } = await import(moduleUrl);
  const pages = getStudentFeedbackPages({
    draftHistory: [{ round: 1, text: '첫 글' }],
    teacherNote: '최상위에만 남은 첨삭',
    feedbackItems: [{ id: 'F1', quote: '첫 글', comment: '잘했어요' }]
  });

  assert.equal(pages.length, 1);
  assert.equal(pages[0].round, 1);
  assert.equal(pages[0].teacherNote, '최상위에만 남은 첨삭');
  assert.equal(pages[0].feedbackItems.length, 1);
});
