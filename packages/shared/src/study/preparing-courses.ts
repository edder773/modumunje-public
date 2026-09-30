import { COURSE_DEFINITIONS, COURSE_FIELD_DEFINITIONS } from "./course-registry";

export const PREPARING_COURSES = COURSE_DEFINITIONS.filter(course => course.releaseStage === "intake");
export type PreparingCourse = typeof PREPARING_COURSES[number];

// A course is registered for content intake before it becomes a learner course.
export function preparingCoursePath(course: PreparingCourse) {
  return `/learn/${course.fieldId}/${course.courseId}/home`;
}

export const PREPARING_FIELDS = COURSE_FIELD_DEFINITIONS.filter(field => {
  const courses = COURSE_DEFINITIONS.filter(course => course.fieldId === field.id);
  return courses.length > 0 && courses.every(course => course.releaseStage === "intake");
});

export function parsePreparingLearningPath(pathname: string) {
  for (const field of PREPARING_FIELDS) {
    if (pathname === `/learn/${field.id}`) return { field, course: null };
  }
  const course = PREPARING_COURSES.find(item => preparingCoursePath(item) === pathname);
  const field = course && COURSE_FIELD_DEFINITIONS.find(item => item.id === course.fieldId);
  return field && course ? { field, course } : null;
}

export type PreparingLearningRoute = NonNullable<ReturnType<typeof parsePreparingLearningPath>>;
