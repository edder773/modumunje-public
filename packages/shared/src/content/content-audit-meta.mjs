import { REVIEWED_QUESTION_BANK_MANIFEST } from "./question-bank-manifest.mjs";
import { SW_CONTENT_MANIFEST } from "./sw-content-manifest.mjs";
import { SW_OFFICIAL_RELEASE_IMPORT_MANIFEST } from "./sw-official-release-import-manifest.mjs";
import { SQLP_SUBJECT3_COPYRIGHT_REWRITE_MANIFEST } from "./sqlp-subject3-copyright-rewrite-manifest.mjs";

const SW_JAVA_SUPPLEMENT_QUESTION_COUNT = 80;

export const CONTENT_AUDIT_META = Object.freeze({
  reviewedAt: SQLP_SUBJECT3_COPYRIGHT_REWRITE_MANIFEST.reviewedAt,
  sql: Object.freeze({
    questions: REVIEWED_QUESTION_BANK_MANIFEST.count,
    theories: REVIEWED_QUESTION_BANK_MANIFEST.theoryCount,
    contentHash: REVIEWED_QUESTION_BANK_MANIFEST.normalizedSha256,
    copyrightRewrites: SQLP_SUBJECT3_COPYRIGHT_REWRITE_MANIFEST.questionsRewritten,
  }),
  softwareMajor: Object.freeze({
    questions: SW_CONTENT_MANIFEST.imported.questions
      + SW_JAVA_SUPPLEMENT_QUESTION_COUNT
      + SW_OFFICIAL_RELEASE_IMPORT_MANIFEST.imported,
    theories: SW_CONTENT_MANIFEST.imported.theories,
  }),
});
