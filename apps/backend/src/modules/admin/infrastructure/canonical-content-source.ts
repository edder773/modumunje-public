export type CanonicalQuestionFilter = {
  ids?: number[];
  search?: string;
  examScope?: string;
  category?: string;
  kind?: string;
  difficulty?: string;
  active?: string;
};

export type CanonicalTheoryFilter = {
  category?: string;
  examScope?: string;
  topic?: string;
  active?: string;
};

export type CanonicalContentHealth = {
  available: boolean;
  source: "release-or-backup";
  questionCount: number;
  theoryCount: number;
  questionChecksum: string;
  theoryChecksum: string;
};

export interface CanonicalContentSource {
  health(): Promise<CanonicalContentHealth>;
  loadQuestions(filter: CanonicalQuestionFilter): Promise<Record<string, unknown>[]>;
  loadTheories(filter: CanonicalTheoryFilter): Promise<Record<string, unknown>[]>;
}

/** Restore content through a verified private release or backup before exporting.
 * A deployment must never silently substitute an obsolete embedded question bank. */
class PrivateRecoveryContentSource implements CanonicalContentSource {
  async health(): Promise<CanonicalContentHealth> {
    return { available: false, source: "release-or-backup", questionCount: 0,
      theoryCount: 0, questionChecksum: "", theoryChecksum: "" };
  }
  async loadQuestions(_filter: CanonicalQuestionFilter): Promise<Record<string, unknown>[]> {
    void _filter;
    throw new Error("문제 콘텐츠가 없습니다. 검증된 비공개 콘텐츠 릴리스 또는 백업을 복원한 뒤 내보내세요.");
  }
  async loadTheories(_filter: CanonicalTheoryFilter): Promise<Record<string, unknown>[]> {
    void _filter;
    throw new Error("이론 콘텐츠가 없습니다. 검증된 비공개 콘텐츠 릴리스 또는 백업을 복원한 뒤 내보내세요.");
  }
}

export const canonicalContentSource: CanonicalContentSource = new PrivateRecoveryContentSource();
