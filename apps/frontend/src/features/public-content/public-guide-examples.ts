import type { PublicGuideSlug } from "./public-guide-links";

export type GuideExample = {
  title: string;
  context: string;
  steps: string[];
  code: string;
  result: string;
  pitfall: string;
  next: string;
  source: { label: string; href: string };
};

// Explanatory examples, not the authenticated question bank or a grading UI.
export const GUIDE_EXAMPLES: Partial<Record<PublicGuideSlug, GuideExample>> = {
  sqld: {
    title: "LEFT JOIN에서 ON과 WHERE는 왜 다른 결과를 만들까요?",
    context: "회원 1·2·3이 있고, 회원 1에게만 결제 완료 주문 101과 취소 주문 102가 있습니다. 목표는 ‘모든 회원을 남기면서 결제 완료 주문 수를 세기’입니다. 실제 회원 정보가 아닌, 결과를 직접 추적하기 위해 만든 작은 예시입니다.",
    steps: [
      "먼저 결과의 단위를 회원 한 명으로 정합니다. 결제 완료 주문이 없는 회원 2·3도 최종 결과에 있어야 하므로 회원을 왼쪽에 둡니다.",
      "ON에서 회원 번호와 결제 상태를 함께 검사하면 회원 1에는 주문 101만 연결됩니다. 회원 2·3은 연결할 주문이 없어 오른쪽 주문 열이 NULL인 행으로 남습니다.",
      "COUNT(o.id)는 NULL인 주문 번호를 세지 않아 1·0·0을 반환합니다. COUNT(*)로 바꾸면 외부 조인이 보존한 행도 세므로 세 회원 모두 1이 됩니다. 무엇을 세는지에 따라 집계 대상을 선택해야 합니다.",
      "결제 상태 조건을 WHERE로 옮기면 NULL로 보존된 행은 조건을 만족하지 않아 사라집니다. 이 예시에서는 회원 1만 남으므로 ‘모든 회원’이라는 요구를 충족하지 못합니다.",
    ],
    code: "WITH members(id) AS (VALUES (1), (2), (3)),\norders(id, member_id, status) AS (\n  VALUES (101, 1, 'paid'), (102, 1, 'cancelled')\n)\nSELECT m.id, COUNT(o.id) AS paid_count\nFROM members AS m\nLEFT JOIN orders AS o\n  ON o.member_id = m.id AND o.status = 'paid'\nGROUP BY m.id\nORDER BY m.id;",
    result: "id | paid_count\n1  | 1\n2  | 0\n3  | 0",
    pitfall: "WHERE에 ‘OR o.id IS NULL’을 붙이면 항상 해결된다는 생각도 주의하세요. 회원 2에게 취소 주문만 있는 경우, 조인 자체는 성공했으므로 NULL 보존 행이 생기지 않습니다. 결제 완료 주문을 연결하는 조건은 ON에 두는 편이 이 요구를 정확하게 표현합니다.",
    next: "회원 1에게 결제 완료 주문을 하나 더 넣으면 2·0·0이 됩니다. 입력 행이 늘 때 결과 행 수와 집계 값 중 무엇이 바뀌는지 분리해 설명하면 조인과 집계를 함께 이해할 수 있습니다. 예제는 SQLite에서 재현하며, 실제 시험에서 지정한 DBMS의 문법 차이는 별도로 확인하세요.",
    source: { label: "SQLite 공식 문서: SELECT와 외부 조인의 처리", href: "https://www.sqlite.org/lang_select.html" },
  },
  "big-data-analysis": {
    title: "결측값 평균 대체도 검증 데이터 누수가 될 수 있습니다.",
    context: "학습 자료의 관측값은 10·20이고 세 번째 값은 비어 있습니다. 검증 자료에는 100이 있습니다. 모델 성능을 정직하게 평가하려면 검증 자료가 전처리 기준을 정하는 데 참여하지 않아야 합니다. 아래 수치는 원리를 보이기 위한 합성 예시이며 시험 성적이나 실제 모델의 측정 결과가 아닙니다.",
    steps: [
      "데이터를 학습과 검증으로 나누기 전에 전체 평균을 계산하면 (10 + 20 + 100) / 3 ≈ 43.33이 됩니다. 학습 자료의 결측값에 검증 자료의 정보가 들어간 셈입니다.",
      "먼저 나눈 뒤 학습 자료만으로 평균을 구하면 (10 + 20) / 2 = 15입니다. 학습 자료는 10·20·15로 바뀌며, 검증 자료에도 이 15라는 기준을 그대로 적용합니다.",
      "스케일러·특성 선택도 같은 원칙입니다. 학습 자료에는 fit 또는 fit_transform, 검증 자료에는 transform을 사용합니다. 교차검증에서는 각 폴드의 학습 부분 안에서 전처리를 다시 학습해야 합니다.",
      "시계열이나 동일 사람의 반복 측정에서는 단순 무작위 분할 자체가 부적절할 수도 있습니다. 미래 정보나 같은 사람의 정보가 검증 경계를 넘는지 먼저 확인한 뒤 모델을 비교합니다.",
    ],
    code: "from statistics import mean\n\ntrain = [10, 20, None]\nvalidation = [100]\nfill_value = mean(x for x in train if x is not None)\nfilled_train = [fill_value if x is None else x for x in train]\nfilled_validation = [fill_value if x is None else x for x in validation]\nprint(fill_value)\nprint(filled_train)\nprint(filled_validation)",
    result: "15\n[10, 20, 15]\n[100]",
    pitfall: "검증 점수가 높다는 사실만으로 전처리가 올바르다고 판단하지 마세요. 검증 자료를 보고 반복적으로 전처리와 모델을 고르면 그 검증 세트에도 과적합할 수 있습니다. 최종 평가 자료는 모델 선택과 분리해야 합니다.",
    next: "검증 자료의 100을 1000으로 바꿔도 학습 자료의 대체값은 15여야 합니다. 이 불변성을 확인하면 전처리 코드가 검증 데이터에 의존하는지 쉽게 찾을 수 있습니다. 실제 구현에서는 전처리와 모델을 Pipeline으로 묶고 분할 전략도 함께 검토하세요.",
    source: { label: "scikit-learn 공식 문서: 데이터 누수와 전처리", href: "https://scikit-learn.org/stable/common_pitfalls.html" },
  },
  "software-major": {
    title: "리스트를 복사했는데 원본이 바뀌는 이유",
    context: "Python에서 표를 중첩 리스트로 표현했다고 가정합니다. 바깥 리스트를 복사한 뒤 첫 행의 값을 바꾸면 원본도 달라질 수 있습니다. ‘복사했다’는 표현보다 어떤 객체를 공유하는지 추적하는 것이 중요합니다.",
    steps: [
      "original은 바깥 리스트와 두 개의 행 리스트로 구성됩니다. shallow = original.copy()는 바깥 리스트만 새로 만들고 안쪽 행 객체는 공유합니다.",
      "shallow[0][0] = 99는 공유 중인 첫 번째 행 객체를 수정합니다. 따라서 original[0][0]도 99가 됩니다. 변수 이름이 다르다고 안쪽 데이터까지 독립적인 것은 아닙니다.",
      "deepcopy로 만든 isolated는 이 예시의 행 리스트까지 별도로 복사합니다. isolated[1][0]을 77로 바꾸어도 original의 두 번째 행은 3·4로 유지됩니다.",
      "반대로 shallow[0] = [7, 8]은 새 바깥 리스트의 참조를 교체하는 연산입니다. 공유 행 자체를 수정하는 연산과 구별해야 원본에 미치는 영향을 예측할 수 있습니다.",
    ],
    code: "from copy import deepcopy\n\noriginal = [[1, 2], [3, 4]]\nshallow = original.copy()\nisolated = deepcopy(original)\nshallow[0][0] = 99\nisolated[1][0] = 77\nprint(original)\nprint(shallow)\nprint(isolated)",
    result: "[[99, 2], [3, 4]]\n[[99, 2], [3, 4]]\n[[1, 2], [77, 4]]",
    pitfall: "모든 경우에 deepcopy를 쓰라는 뜻은 아닙니다. 큰 자료를 깊게 복사하면 비용이 증가하고 의도한 공유 관계도 달라질 수 있습니다. 이 설명은 중첩된 숫자 리스트에 대한 것이며 사용자 정의 객체나 외부 자원은 별도 동작을 확인해야 합니다.",
    next: "디버깅할 때는 원본과 복사본의 바깥 객체뿐 아니라 문제가 생긴 안쪽 객체의 동일성도 확인하세요. ‘공유 객체 변경’과 ‘참조 교체’를 구분하는 방법은 함수 인자와 상태 관리의 오류를 추적할 때도 사용할 수 있습니다.",
    source: { label: "Python 공식 문서: 얕은 복사와 깊은 복사", href: "https://docs.python.org/3/library/copy.html" },
  },
};
