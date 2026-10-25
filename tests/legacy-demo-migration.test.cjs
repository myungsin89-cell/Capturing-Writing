const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const keys = {
  CLASSES: 'classes',
  TOPICS: 'topics',
  STUDENTS: 'students',
  QUESTIONS: 'questions',
  CONFIG: 'config'
};

function legacyDemoState() {
  return {
    classes: [
      { id: 'CLASS_1', className: '3학년 2반' },
      { id: 'CLASS_2', className: '3학년 3반 (전담)' }
    ],
    topics: ['TOPIC_1', 'TOPIC_2', 'TOPIC_3'].map((id) => ({ id })),
    students: [1, 2, 3, 4, 5].map((number) => ({
      number: String(number),
      docId: `DEMO_DOC_${number}`
    })),
    questions: [{ id: 'Q_101' }],
    config: {
      spreadsheetId: 'sheet-id',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-id/edit',
      teacherEmail: 'teacher@example.com',
      activeClassId: 'CLASS_1',
      activeTopicId: 'TOPIC_1',
      classAccessKeys: { CLASS_1: 'demo-key' }
    }
  };
}

async function loadMigrationModule() {
  const moduleUrl = pathToFileURL(
    path.join(__dirname, '..', 'src', 'utils', 'legacyDemoMigration.js')
  ).href;
  return import(moduleUrl);
}

test('개발용 데모 데이터만 빈 상태로 초기화하고 시트 연결 정보는 보존한다', async () => {
  const { removeLegacyDemoState } = await loadMigrationModule();
  const result = removeLegacyDemoState(legacyDemoState());

  assert.equal(result.migrated, true);
  assert.deepEqual(result.state.classes, []);
  assert.deepEqual(result.state.topics, []);
  assert.deepEqual(result.state.students, []);
  assert.deepEqual(result.state.questions, []);
  assert.equal(result.state.config.spreadsheetId, 'sheet-id');
  assert.equal(result.state.config.teacherEmail, 'teacher@example.com');
  assert.equal(result.state.config.activeClassId, '');
  assert.deepEqual(result.state.config.classAccessKeys, {});
});

test('실제 사용자 데이터가 하나라도 섞이면 자동 삭제하지 않는다', async () => {
  const { removeLegacyDemoState } = await loadMigrationModule();
  const state = legacyDemoState();
  state.students.push({ number: '6', name: '실제 학생', docId: 'REAL_DOC' });

  const result = removeLegacyDemoState(state);
  assert.equal(result.migrated, false);
  assert.equal(result.state, state);
});

test('브라우저 저장소 마이그레이션도 데모 영역만 비운다', async () => {
  const { migrateLegacyDemoStorage } = await loadMigrationModule();
  const state = legacyDemoState();
  const values = new Map([
    [keys.CLASSES, JSON.stringify(state.classes)],
    [keys.TOPICS, JSON.stringify(state.topics)],
    [keys.STUDENTS, JSON.stringify(state.students)],
    [keys.QUESTIONS, JSON.stringify(state.questions)],
    [keys.CONFIG, JSON.stringify(state.config)]
  ]);
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };

  assert.equal(migrateLegacyDemoStorage(storage, keys), true);
  assert.deepEqual(JSON.parse(values.get(keys.CLASSES)), []);
  assert.deepEqual(JSON.parse(values.get(keys.STUDENTS)), []);
  assert.equal(JSON.parse(values.get(keys.CONFIG)).spreadsheetId, 'sheet-id');
});
