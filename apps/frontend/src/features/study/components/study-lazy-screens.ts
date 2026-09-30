import { lazy } from "react";

export const Practice = lazy(() => import("./sql/practice/practice-screen"));
export const ExamRunner = lazy(() => import("./sql/mock/exam-runner"));
export const MockExamHome = lazy(() => import("./sql/mock/mock-home"));
export const TheoryView = lazy(() => import("./sql/theory/theory-screen"));
export const LearningRecordsHub = lazy(() => import("./sql/records/records-screen"));
export const UserReportModal = lazy(() => import("./sql/reports/user-report-modal"));

export const Dashboard = lazy(() => import("./sql/dashboard/dashboard-screen"));
export const LearningFieldHome = lazy(() => import("./learning-field-home"));
