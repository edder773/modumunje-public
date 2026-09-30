import MarkdownRenderer from "@frontend/features/content/components/markdown-renderer";
import { publicContentStyles as styles } from "./public-content-shell";

const CHECKLISTS: Record<string, string> = {
  "sqld": "### 결과를 검증하는 순서\n\n1. 각 Query Block이 만드는 **한 행의 의미**를 먼저 적습니다.\n2. 조건을 적용하기 전 원본 행과 적용 후 남는 행을 작은 표로 그립니다.\n3. NULL 비교가 `TRUE`, `FALSE`, `UNKNOWN` 중 무엇인지 구분합니다.\n4. 중복 제거, 그룹화, 정렬과 행 제한이 적용되는 순서를 확인합니다.\n5. 데이터가 0건·1건·여러 건일 때도 같은 규칙이 성립하는지 검증합니다.\n\n### 실무와 시험에서 함께 확인할 항목\n\n- `ORDER BY`가 없다면 결과 순서를 가정하지 않습니다.\n- 문자열·숫자·날짜 비교에서는 데이터 타입과 명시적 형변환을 확인합니다.\n- 같은 결과처럼 보이는 SQL도 NULL과 중복이 있을 때 달라질 수 있습니다.\n- 문법을 외우기 전에 샘플 데이터 3~5행으로 결과를 직접 계산합니다.\n\n### 마지막 점검\n\n- 작성 순서가 아니라 SQL의 논리적 처리 순서로 결과를 계산합니다.\n- NULL을 0이나 빈 값과 같은 것으로 취급하지 않습니다.\n- `ORDER BY`가 없는 결과 순서와 DISTINCT 없는 중복 제거를 가정하지 않습니다.\n- 비슷한 문법은 0건·다건·NULL 데이터를 넣어 결과가 정말 같은지 확인합니다.\n\n### 사례를 판별하는 순서\n\n1. 모델이 표현해야 하는 **업무 사실과 행 단위(Grain)**를 한 문장으로 정의합니다.\n2. 각 인스턴스를 유일하게 식별할 수 있는 후보와 변경 가능성을 확인합니다.\n3. 속성이 어느 사실에 종속되는지와 관계의 필수성·카디널리티를 확인합니다.\n4. 중복 저장으로 삽입·갱신·삭제 이상이 생기는지 검토합니다.\n5. 물리 성능을 이유로 구조를 바꿀 때 원천 데이터와 동기화·복구 규칙을 함께 설계합니다.\n\n### 모델 품질 확인표\n\n- 같은 업무 사실이 여러 곳에 중복 저장되지 않는가?\n- 이름과 도메인이 한 가지 의미로 사용되는가?\n- PK·FK가 실제 업무 관계와 선택성을 정확히 표현하는가?\n- 현재 화면이나 프로세스에 과도하게 종속되지 않는가?\n- 정규화와 성능 설계의 이유를 측정 가능한 근거로 설명할 수 있는가?\n\n### 마지막 점검\n\n- 화면의 입력 항목이나 현재 프로세스를 그대로 엔터티·관계로 옮기지 않습니다.\n- 한 행의 업무 사실, 후보 식별자와 함수 종속성을 먼저 확정합니다.\n- 중복과 비일관성을 만들면서 조회 편의만 얻는 설계를 정답으로 선택하지 않습니다.\n- 반정규화와 물리 설계는 측정된 성능 문제와 동기화·복구 대책이 있을 때 적용합니다.\n\n### SQL 공통 질문\n\n- 0건·1건·여러 건과 NULL·동점·중복 데이터에서 결과가 어떻게 달라지는가?\n- 비슷해 보이는 문법과 결과가 같아지는 조건, 달라지는 조건은 무엇인가?\n- 작은 샘플 데이터를 이용해 결과를 실수 없이 예측하는 순서는 무엇인가?\n\n### 데이터 모델링 공통 질문\n\n- 한 행이 나타내는 업무 사실과 유일성·필수성·변경 가능성은 무엇인가?\n- 잘못 모델링하면 어떤 중복·이상 현상·변경 영향이 발생하는가?\n- 여러 설계안 중 업무 의미와 변경 용이성을 가장 잘 보존하는 안을 어떻게 고르는가?",
  "ipe-practical": "각 단원 풀이 예시의 답을 가린 뒤, 핵심 이론의 규칙을 적용해 직접 풀어 보세요. 코드와 계산 문제는 중간값·단위·최종 출력의 순서를, 용어 문제는 지문의 핵심 단서와 답의 의미를 점검하세요. 해설과 다른 부분이 있으면 어느 조건을 놓쳤는지 확인하고 연결된 실기 문제로 다시 연습하세요."
};

export default function CommonTheoryChecklist({ slug }: { slug: string }) {
  const markdown = CHECKLISTS[slug];
  if (!markdown) return null;
  return <section className={styles.section} aria-labelledby="common-theory-checklist">
    <div className={styles.sectionHeading}><h2 id="common-theory-checklist">단원마다 활용하는 공통 점검</h2></div>
    <div className={`${styles.contentCard} rich-content`}><div className="markdown-body"><MarkdownRenderer value={markdown} /></div></div>
  </section>;
}
