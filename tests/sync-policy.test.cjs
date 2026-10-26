const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const moduleUrl = pathToFileURL(
  path.join(__dirname, '..', 'src', 'utils', 'syncPolicy.js')
).href;

test('student links never receive teacher autosave permission', async () => {
  const { shouldAutoSaveTeacherState } = await import(moduleUrl);

  assert.equal(
    shouldAutoSaveTeacherState({
      isStudentUrlMode: true,
      accessToken: 'teacher-token',
      spreadsheetId: 'sheet-id'
    }),
    false
  );
});

test('teacher autosave requires both authentication and a spreadsheet', async () => {
  const { shouldAutoSaveTeacherState } = await import(moduleUrl);

  assert.equal(
    shouldAutoSaveTeacherState({
      isStudentUrlMode: false,
      accessToken: 'teacher-token',
      spreadsheetId: 'sheet-id'
    }),
    true
  );
  assert.equal(
    shouldAutoSaveTeacherState({
      isStudentUrlMode: false,
      accessToken: '',
      spreadsheetId: 'sheet-id'
    }),
    false
  );
  assert.equal(
    shouldAutoSaveTeacherState({
      isStudentUrlMode: false,
      accessToken: 'teacher-token',
      spreadsheetId: ''
    }),
    false
  );
});
