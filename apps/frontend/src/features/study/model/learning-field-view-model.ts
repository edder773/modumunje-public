export type CourseCardSource = {
  id: string;
  examType: string;
  name: string;
  summary: string;
  studyMode: string;
  mockExam: string;
};

export type CourseCardViewModel<T extends CourseCardSource = CourseCardSource> = T & {
  href: string;
};

export function buildCourseCardViewModels<T extends CourseCardSource>(
  courses: readonly T[],
  hrefForCourse: (examType: T["examType"]) => string,
): CourseCardViewModel<T>[] {
  return courses.map((course) => ({
    ...course,
    href: hrefForCourse(course.examType),
  }));
}
