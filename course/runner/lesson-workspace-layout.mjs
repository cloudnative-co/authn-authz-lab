export const LESSON_WORKSPACE_FILES = Object.freeze({
  '01': Object.freeze(['exercise.json', 'submission.json']),
  '02': Object.freeze(['runtime.json', 'submission.json']),
  '03': Object.freeze(['runtime.json', 'submission.json']),
  '04': Object.freeze(['runtime.json', 'submission.json']),
  '05': Object.freeze(['runtime.json', 'submission.json']),
  '06': Object.freeze(['runtime.json', 'submission.json']),
  '07': Object.freeze(['runtime.json', 'submission.json']),
  '08': Object.freeze(['runtime.json', 'submission.json']),
  '09': Object.freeze(['runtime.json', 'submission.json']),
  '10': Object.freeze(['runtime.json', 'submission.json']),
  '11': Object.freeze(['runtime.json', 'submission.json']),
  '12': Object.freeze(['runtime.json', 'submission.json']),
  '13': Object.freeze(['runtime.json', 'submission.json']),
  '14': Object.freeze(['runtime.json', 'submission.json']),
  '15': Object.freeze(['runtime.json', 'submission.json']),
  capstone: Object.freeze(['runtime.json', 'submission.json']),
});

export function workspaceFilesForLesson(lessonId) {
  const files = LESSON_WORKSPACE_FILES[lessonId];
  if (!files) throw new TypeError(`unsupported lesson workspace: ${lessonId}`);
  return files;
}
