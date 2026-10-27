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
