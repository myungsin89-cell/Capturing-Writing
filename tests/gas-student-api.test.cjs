const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

function makeHarness() {
  const initialState = {
    classes: [{ id: 'CLASS_A', className: '4학년 4반' }],
    topics: [
      {
        id: 'TOPIC_A',
        classId: 'CLASS_A',
        title: '기억에 남는 일',
        prompt: '자세히 써 보세요.',
        isActive: true,
        classLocked: false
      }
    ],
    students: [
      {
        classId: 'CLASS_A',
        number: '1',
        name: '가학생',
        status: 'STAGE_1_WRITING',
        locked: false,
        draft1: '',
        historyByTopic: {}
      },
      {
        classId: 'CLASS_A',
        number: '2',
        name: '나학생',
        status: 'STAGE_1_WRITING',
        locked: false,
        draft1: '다른 학생 글',
        historyByTopic: {}
      }
    ],
    questions: [
      {
        id: 'Q_OTHER',
        classId: 'CLASS_A',
        topicId: 'TOPIC_A',
        number: '2',
        name: '나학생',
        question: '다른 학생 질문'
      }
    ],
    config: {
      activeClassId: 'CLASS_A',
      activeTopicId: 'TOPIC_A',
      classAccessKeys: { CLASS_A: 'class-secret' }
    },
    updatedAt: '2026-10-25T00:00:00.000Z'
  };

  const rows = [['KEY', 'JSON_VALUE']];
  for (const [key, value] of Object.entries(initialState)) {
    rows.push([key, JSON.stringify(value)]);
  }
  while (rows.length < 100) rows.push(['', '']);

  const sheet = {
    getLastRow() {
      let last = 1;
      rows.forEach((row, index) => {
        if (row[0] || row[1]) last = index + 1;
      });
      return last;
    },
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues() {
          return rows
            .slice(row - 1, row - 1 + rowCount)
            .map((source) => source.slice(column - 1, column - 1 + columnCount));
        },
        setValues(values) {
          values.forEach((valueRow, rowOffset) => {
            valueRow.forEach((value, columnOffset) => {
              rows[row - 1 + rowOffset][column - 1 + columnOffset] = value;
            });
          });
        },
        clearContent() {
          for (let r = row - 1; r < row - 1 + rowCount; r++) {
            for (let c = column - 1; c < column - 1 + columnCount; c++) rows[r][c] = '';
          }
        }
      };
    }
  };

  const cache = new Map();
  let uuidCounter = 0;
  const context = {
    console,
    Math,
    Date,
    JSON,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    SpreadsheetApp: {
      openById(id) {
        assert.equal(id, 'spreadsheet-id-1234567890');
        return { getSheetByName: (name) => (name === 'AppState' ? sheet : null) };
      }
    },
    CacheService: {
      getScriptCache() {
        return {
          put(key, value) {
            cache.set(key, value);
          },
          get(key) {
            return cache.get(key) || null;
          }
        };
      }
    },
    Utilities: {
      getUuid() {
        uuidCounter += 1;
        return `00000000-0000-0000-0000-${String(uuidCounter).padStart(12, '0')}`;
      },
      formatDate() {
        return '2026-10-25 18:00';
      }
    }
  };
  vm.createContext(context);
  const gasSource = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');
  vm.runInContext(gasSource, context);
  return { context };
}

test('학생 공개 초기화 응답은 학생과 질문 전체를 노출하지 않는다', () => {
  const { context } = makeHarness();
  const result = context.studentBootstrapV2({
    spreadsheetId: 'spreadsheet-id-1234567890',
    classId: 'CLASS_A',
    accessKey: 'class-secret'
  });
  assert.equal(result.ok, true);
  assert.equal(result.config.className, '4학년 4반');
  assert.equal(result.students, undefined);
  assert.equal(result.questions, undefined);
  assert.equal(result.config.classAccessKeys, undefined);
});

test('번호와 이름이 일치한 학생에게만 자기 데이터와 세션을 반환한다', () => {
  const { context } = makeHarness();
  const denied = context.studentLoginV2({
    spreadsheetId: 'spreadsheet-id-1234567890',
    classId: 'CLASS_A',
    accessKey: 'class-secret',
    number: '1',
    name: '틀린이름'
  });
  assert.equal(denied.ok, false);

  const allowed = context.studentLoginV2({
    spreadsheetId: 'spreadsheet-id-1234567890',
    classId: 'CLASS_A',
    accessKey: 'class-secret',
    number: '1',
    name: '가학생'
  });
  assert.equal(allowed.ok, true);
  assert.ok(allowed.sessionToken);
  assert.equal(allowed.student.number, '1');
  assert.deepEqual(Array.from(allowed.questions), []);
});

test('학생 제출은 세션 소유 학생만 갱신한다', () => {
  const { context } = makeHarness();
  const login = context.studentLoginV2({
    spreadsheetId: 'spreadsheet-id-1234567890',
    classId: 'CLASS_A',
    accessKey: 'class-secret',
    number: '1',
    name: '가학생'
  });
  const submitted = context.submitStageV2({
    spreadsheetId: 'spreadsheet-id-1234567890',
    sessionToken: login.sessionToken,
    topicId: 'TOPIC_A',
    stage: 1,
    text: '내가 쓴 첫 번째 글'
  });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.student.draft1, '내가 쓴 첫 번째 글');
  assert.equal(submitted.student.locked, true);

  const state = context.readAppStateV2_('spreadsheet-id-1234567890').state;
  assert.equal(state.students[0].draft1, '내가 쓴 첫 번째 글');
  assert.equal(state.students[1].draft1, '다른 학생 글');
});

test('학생 질문은 세션의 학급·번호·이름으로 저장된다', () => {
  const { context } = makeHarness();
  const login = context.studentLoginV2({
    spreadsheetId: 'spreadsheet-id-1234567890',
    classId: 'CLASS_A',
    accessKey: 'class-secret',
    number: '1',
    name: '가학생'
  });
  const result = context.addQuestionV2({
    spreadsheetId: 'spreadsheet-id-1234567890',
    sessionToken: login.sessionToken,
    topicId: 'TOPIC_A',
    question: '문단을 여기서 나누나요?'
  });
  assert.equal(result.ok, true);
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].number, '1');
  assert.equal(result.questions[0].classId, 'CLASS_A');
  assert.equal(result.questions[0].topicId, 'TOPIC_A');
});

test('긴 학생 입장 주소를 자르지 않고 QR로 만든다', async () => {
  const helperUrl = pathToFileURL(
    path.join(__dirname, '..', 'src', 'utils', 'qrAndPdfHelper.js')
  ).href;
  const { generateQrMatrix } = await import(helperUrl);
  const common =
    'https://example.com/student?sheetId=' +
    'a'.repeat(50) +
    '&gasUrl=' +
    encodeURIComponent('https://script.google.com/macros/s/' + 'b'.repeat(70) + '/exec') +
    '&accessKey=' +
    'c'.repeat(36);
  const first = generateQrMatrix(common + '&student=1');
  const second = generateQrMatrix(common + '&student=2');
  assert.ok(first.length > 37, '버전 5보다 큰 QR이 선택되어야 합니다.');
  assert.notDeepEqual(first, second, '104바이트 뒤의 주소 차이도 QR에 반영되어야 합니다.');
});
