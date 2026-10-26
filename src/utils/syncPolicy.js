export function shouldAutoSaveTeacherState({
  isStudentUrlMode,
  accessToken,
  spreadsheetId
}) {
  return !isStudentUrlMode && Boolean(accessToken) && Boolean(spreadsheetId);
}
