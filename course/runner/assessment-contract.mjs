export class AssessmentContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssessmentContractError';
    this.reasonCode = 'COURSE_ASSESSMENT_CONTRACT';
  }
}

export function bindImplementedAssessmentChecks({ courseContract, lessonId, implementedCheckIds } = {}) {
  if (!courseContract || !Array.isArray(courseContract.lessons)) {
    throw new TypeError('validated courseContract is required');
  }
  if (typeof lessonId !== 'string' || lessonId.length === 0) throw new TypeError('lessonId is required');
  if (!Array.isArray(implementedCheckIds)
      || implementedCheckIds.length === 0
      || new Set(implementedCheckIds).size !== implementedCheckIds.length) {
    throw new TypeError('implementedCheckIds must be a non-empty unique array');
  }
  const lesson = courseContract.lessons.find(({ id }) => id === lessonId);
  if (!lesson) throw new AssessmentContractError(`course contractにlesson ${lessonId}がありません`);
  if (!Array.isArray(lesson.assessments) || lesson.assessments.length !== 1) {
    throw new AssessmentContractError(`lesson ${lessonId}はassessmentを1件だけ持つ必要があります`);
  }
  const required = lesson.assessments[0].requiredCheckIds;
  const exact = Array.isArray(required)
    && required.length === implementedCheckIds.length
    && required.every((checkId, index) => checkId === implementedCheckIds[index]);
  if (!exact) {
    throw new AssessmentContractError(
      `lesson ${lessonId}のrequired checkとrunner実装が一致しません`,
    );
  }
  return Object.freeze([...required]);
}
