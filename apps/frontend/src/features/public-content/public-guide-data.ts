import { SKCT_PERSONAL_GUIDE, SKCT_GUIDE_COURSE } from "./skct-personal-guide";
import { learningCourse, learningField, learningPath } from "@shared/study/learning-catalog";
import { releasedLocalPracticeCourses, localPracticePath, localPracticeWorkbooks } from "@shared/study/local-practice";
import type { ExamType } from "@shared/study/study-domain";
import type { PublicGuideSlug } from "./public-guide-links";

export type PublicCourseGuide = {
  slug: PublicGuideSlug;
  examType?: ExamType;
  eyebrow: string;
  title: string;
  description: string;
  audience: string[];
  subjectGuidance: Record<string, {
    focus: string;
    practice: string;
  }>;
  learningSteps: Array<{
    label: string;
    title: string;
    description: string;
  }>;
  checkpoints: string[];
  closing: string;
};

export const PUBLIC_COURSE_GUIDES: Record<PublicGuideSlug, PublicCourseGuide> = {
  "skct-personal": SKCT_PERSONAL_GUIDE,
  sqld: {
    slug: "sqld",
    examType: "SQLD",
    eyebrow: "SQL 자격 학습 · 기본 과정",
    title: "SQLD는 결과를 외우기보다 데이터가 변하는 과정을 설명하는 공부가 중요합니다.",
    description: "SQLD 학습은 모델링 용어와 SQL 문법을 따로 암기하는 일이 아닙니다. 테이블 구조가 왜 그렇게 설계됐는지 이해하고, 한 SQL이 어떤 행을 남기고 묶고 정렬하는지 차례대로 설명할 수 있어야 안정적인 문제 풀이로 이어집니다.",
    audience: [
      "SQL을 처음 체계적으로 정리하거나 단편적으로 사용해 온 학습자",
      "조인·집계·서브쿼리의 실행 결과를 예측할 때 자주 흔들리는 학습자",
      "데이터 모델링 개념을 실제 테이블과 SQL 문제에 연결하고 싶은 학습자",
    ],
    subjectGuidance: {
      "data-modeling": {
        focus: "엔터티, 속성, 관계, 식별자와 정규화 개념을 용어 정의가 아니라 테이블 구조의 이유로 이해합니다.",
        practice: "업무 문장을 읽고 엔터티 후보, 기본키, 관계의 선택성과 카디널리티를 직접 표시해 봅니다.",
      },
      "sql-basics": {
        focus: "조회 순서, NULL, 조인, 집계, 집합 연산과 분석 함수가 결과 행에 주는 영향을 추적합니다.",
        practice: "작은 표를 손으로 만들고 FROM·WHERE·GROUP BY·HAVING·SELECT 순서에 따라 중간 결과를 적어 봅니다.",
      },
    },
    learningSteps: [
      {
        label: "1단계",
        title: "용어를 구조와 연결하기",
        description: "정의만 외우지 말고 하나의 주문·회원 예시를 정해 모델, 키, 관계와 정규화를 같은 사례 안에서 연결합니다.",
      },
      {
        label: "2단계",
        title: "SQL 결과를 표로 추적하기",
        description: "정답을 바로 고르기 전에 조인으로 늘어난 행, 조건으로 제외된 행, 집계 후 남은 행을 차례대로 확인합니다.",
      },
      {
        label: "3단계",
        title: "오답 원인을 규칙으로 남기기",
        description: "문제 번호 대신 NULL 비교, 외부 조인 조건 위치, GROUP BY 범위처럼 다시 적용할 수 있는 판단 규칙을 기록합니다.",
      },
      {
        label: "4단계",
        title: "시간 제한 안에서 재현하기",
        description: "모의고사 뒤에는 점수만 보지 않고 오래 걸린 문제와 확신 없이 맞힌 문제까지 복습 대상으로 포함합니다.",
      },
    ],
    checkpoints: [
      "외부 조인의 조건이 ON 절과 WHERE 절에 있을 때 결과 차이를 설명할 수 있는가?",
      "NULL이 포함된 비교와 집계에서 제외되는 값을 구분할 수 있는가?",
      "GROUP BY 전후의 행 수 변화를 작은 예제로 계산할 수 있는가?",
      "정규화의 장점과 조회 성능을 위한 반정규화 판단을 구분할 수 있는가?",
    ],
    closing: "SQLD에서는 낯선 문법을 많이 아는 것보다 기본 규칙을 일관되게 적용하는 힘이 중요합니다. 틀린 문제를 다시 볼 때 정답 문장만 읽지 말고, 같은 규칙이 다른 표와 조건에서도 유지되는지 확인하세요.",
  },
  sqlp: {
    slug: "sqlp",
    examType: "SQLP",
    eyebrow: "SQL 자격 학습 · 전문가 과정",
    title: "SQLP는 문법 지식을 실행 구조와 성능 판단으로 확장하는 과정입니다.",
    description: "SQLP에서는 같은 결과를 내는 SQL이라도 데이터 분포, 인덱스 구조와 조인 방식에 따라 비용이 달라집니다. 튜닝 기법의 이름을 외우기보다 병목을 관찰하고 가설을 세운 뒤 실행 계획과 실제 처리량으로 검증하는 흐름을 익혀야 합니다.",
    audience: [
      "SQLD 범위를 이해하고 실행 계획과 성능 문제로 학습을 확장하려는 학습자",
      "인덱스와 조인 방식의 선택 이유를 말로 설명하는 데 어려움이 있는 학습자",
      "객관식 판단과 서술형 답안을 하나의 분석 과정으로 연결하고 싶은 학습자",
    ],
    subjectGuidance: {
      "data-modeling": {
        focus: "모델의 구조적 선택이 SQL 복잡도, 데이터 무결성과 변경 비용에 주는 영향을 함께 봅니다.",
        practice: "정규화·반정규화 후보를 찾고 데이터 중복, 갱신 범위와 주요 조회 패턴을 근거로 선택을 설명합니다.",
      },
      "sql-basics": {
        focus: "복잡한 SQL도 논리적 처리 단계와 집합 변환으로 분해해 결과의 정확성을 먼저 검증합니다.",
        practice: "서브쿼리, 집합 연산, 분석 함수를 대체 표현과 비교하고 NULL 및 중복 처리 차이를 기록합니다.",
      },
      "sql-advanced-tuning": {
        focus: "인덱스 액세스, 조인 방식, 옵티마이저 판단과 실행 계획을 데이터 분포 및 처리량과 연결합니다.",
        practice: "선택도, 예상·실제 건수, 랜덤 액세스와 정렬 비용을 근거로 병목과 개선안을 짧은 문장으로 작성합니다.",
      },
    },
    learningSteps: [
      {
        label: "1단계",
        title: "정확한 결과를 먼저 보장하기",
        description: "튜닝 전에 SQL이 업무 조건을 정확히 표현하는지 확인합니다. 결과가 다른 재작성은 성능 개선으로 볼 수 없습니다.",
      },
      {
        label: "2단계",
        title: "처리량과 선택도를 수치로 보기",
        description: "테이블 전체 건수, 조건 결과 건수와 조인 후 증가량을 추정해 어느 구간에서 작업이 커지는지 찾습니다.",
      },
      {
        label: "3단계",
        title: "실행 계획을 근거로 가설 검증하기",
        description: "연산자 이름만 보고 결론 내리지 않고 액세스 범위, 선행 집합, 반복 횟수와 실제 건수를 함께 확인합니다.",
      },
      {
        label: "4단계",
        title: "서술형 답안을 진단 구조로 만들기",
        description: "현상, 원인, 확인 근거, 개선안과 부작용 순서로 답안을 작성해 단순 키워드 나열을 피합니다.",
      },
    ],
    checkpoints: [
      "인덱스가 존재해도 전체 스캔이 더 유리할 수 있는 조건을 설명할 수 있는가?",
      "NL·소트 머지·해시 조인의 선행 집합과 비용 특성을 비교할 수 있는가?",
      "예상 건수와 실제 건수의 차이가 다음 연산에 미치는 영향을 찾을 수 있는가?",
      "튜닝 제안의 성능 이점뿐 아니라 쓰기 비용과 운영 위험도 함께 적을 수 있는가?",
    ],
    closing: "SQLP 학습의 기준은 기법의 개수가 아니라 판단 근거의 품질입니다. 실행 계획 한 줄을 볼 때마다 왜 이 방식이 선택됐는지, 데이터가 달라지면 선택도 달라질지를 설명하는 습관을 들이세요.",
  },
  dasp: {
    slug: "dasp",
    examType: "DASP",
    eyebrow: "데이터 아키텍처 · 준전문가 과정",
    title: "DAsP는 아키텍처 원칙이 요건과 표준, 모델로 이어지는 흐름을 잡는 과정입니다.",
    description: "DAsP 범위는 과목마다 용어가 많지만 서로 독립된 암기 목록이 아닙니다. 조직의 목표와 원칙이 데이터 요건으로 구체화되고, 표준을 거쳐 모델에 반영되는 연결 관계를 중심으로 공부하면 비슷한 개념을 구분하기 쉬워집니다.",
    audience: [
      "데이터 모델링 경험을 기업 차원의 데이터 관리 관점으로 넓히려는 학습자",
      "아키텍처·요건·표준화 용어 사이의 관계가 혼동되는 학습자",
      "업무 사례를 데이터 구조와 관리 원칙으로 바꾸는 기초를 익히려는 학습자",
    ],
    subjectGuidance: {
      "enterprise-architecture": {
        focus: "전사 관점의 원칙, 참조 모델, 거버넌스와 이행 계획이 각각 어떤 의사결정을 지원하는지 구분합니다.",
        practice: "조직의 현재 상태와 목표 상태를 나누고 원칙, 표준, 전환 과제를 한 장의 흐름도로 정리합니다.",
      },
      "data-requirements": {
        focus: "요구사항 수집부터 분석, 명세, 검증과 변경 관리까지 산출물의 목적과 책임을 연결합니다.",
        practice: "모호한 업무 요청을 데이터 항목, 규칙, 품질 기준과 추적 가능한 요구사항으로 바꿔 봅니다.",
      },
      "data-standardization": {
        focus: "단어, 용어, 도메인, 코드와 표준 항목의 관계를 이해하고 표준이 모델 품질에 주는 효과를 봅니다.",
        practice: "동일 의미의 여러 명칭과 동일 명칭의 다른 의미를 찾아 표준화 원칙과 예외 처리 근거를 작성합니다.",
      },
      "data-modeling-practice": {
        focus: "개념·논리·물리 모델의 목적을 구분하고 엔터티, 관계, 식별자와 정규화를 업무 규칙에 맞게 적용합니다.",
        practice: "업무 시나리오에서 핵심 엔터티와 관계를 찾고 모델 변경이 데이터 무결성에 미치는 영향을 설명합니다.",
      },
    },
    learningSteps: [
      {
        label: "1단계",
        title: "전사 관점의 큰 흐름 세우기",
        description: "목표, 원칙, 현행·목표 아키텍처, 이행 계획의 순서를 먼저 잡아 세부 용어가 어느 단계에 속하는지 표시합니다.",
      },
      {
        label: "2단계",
        title: "산출물과 책임 연결하기",
        description: "각 활동이 무엇을 입력으로 받아 어떤 산출물을 만들고 누가 검토하는지 표로 정리합니다.",
      },
      {
        label: "3단계",
        title: "하나의 업무 사례로 네 과목 통합하기",
        description: "회원·주문 같은 사례를 정해 요건 수집, 용어 표준화와 데이터 모델링까지 같은 맥락에서 이어 봅니다.",
      },
      {
        label: "4단계",
        title: "유사 개념의 경계 복습하기",
        description: "정답뿐 아니라 다른 선택지가 어느 단계와 역할에 해당하는지 설명해 표현이 바뀐 문제에 대비합니다.",
      },
    ],
    checkpoints: [
      "원칙, 표준, 모델과 이행 계획의 역할을 서로 바꾸지 않고 설명할 수 있는가?",
      "요구사항 명세와 검증, 변경 관리 산출물을 구분할 수 있는가?",
      "표준 단어·용어·도메인·코드의 관계를 예제로 만들 수 있는가?",
      "업무 규칙이 관계, 식별자와 정규화 선택에 반영되는 과정을 설명할 수 있는가?",
    ],
    closing: "DAsP는 범위를 잘게 나눠 외우는 것보다 하나의 데이터가 조직의 원칙에서 모델까지 어떻게 관리되는지 반복해서 연결하는 공부가 효과적입니다. 오답은 과목명이 아니라 흐름에서 놓친 단계로 분류해 보세요.",
  },
  dap: {
    slug: "dap",
    examType: "DAP",
    eyebrow: "데이터 아키텍처 · 전문가 과정",
    title: "DAP는 원칙을 실제 설계 판단으로 바꾸고 그 근거를 설명하는 과정입니다.",
    description: "DAP 학습에서는 전사아키텍처와 요건, 표준, 모델링, 데이터베이스 설계와 품질 관리가 하나의 운영 체계로 연결됩니다. 개별 기법의 정의뿐 아니라 상충하는 요구를 조정하고 선택의 장단점을 설명하는 능력이 필요합니다.",
    audience: [
      "데이터 모델러·아키텍트 역할에 필요한 전 범위의 판단 체계를 정리하려는 학습자",
      "객관식 지식을 실기형 설계 설명과 개선안으로 전환하려는 학습자",
      "성능, 무결성, 표준과 운영 가능성 사이의 균형을 연습하려는 학습자",
    ],
    subjectGuidance: {
      "enterprise-architecture": {
        focus: "거버넌스, 참조 모델과 전환 계획이 조직의 데이터 의사결정을 어떻게 통제하고 지원하는지 봅니다.",
        practice: "현행 문제, 목표 원칙, 전환 과제, 측정 지표를 연결해 실행 가능한 로드맵으로 표현합니다.",
      },
      "data-requirements": {
        focus: "기능 요구뿐 아니라 데이터 품질, 보안, 이력과 추적성 요구까지 모델 입력으로 구체화합니다.",
        practice: "서로 충돌하는 이해관계자의 요구를 찾아 우선순위, 수용 기준과 변경 영향으로 정리합니다.",
      },
      "data-standardization": {
        focus: "표준 체계의 제정, 적용, 예외와 준수 점검이 실제 모델 및 시스템에 정착되는 조건을 학습합니다.",
        practice: "표준 위반 사례를 찾고 즉시 변경이 어려운 경우의 예외 승인과 전환 계획까지 작성합니다.",
      },
      "data-modeling-practice": {
        focus: "업무 규칙, 생명주기와 이력을 반영하는 모델을 만들고 대안 구조의 장단점을 비교합니다.",
        practice: "동일 요구를 두 가지 모델로 설계한 뒤 무결성, 조회, 변경과 확장 비용을 근거로 선택합니다.",
      },
      "database-design-and-use": {
        focus: "논리 모델을 저장 구조, 인덱스, 파티션과 접근 패턴으로 전환하면서 성능과 운영 조건을 검토합니다.",
        practice: "주요 조회와 변경 작업을 기준으로 물리 설계 후보를 만들고 병목, 복구와 확장 위험을 함께 점검합니다.",
      },
      "data-quality-management": {
        focus: "품질 기준, 측정, 원인 분석과 개선 활동을 일회성 정제가 아닌 지속적인 관리 체계로 이해합니다.",
        practice: "정확성·완전성·일관성 같은 품질 기준을 측정 가능한 규칙과 책임자, 개선 주기로 바꿉니다.",
      },
    },
    learningSteps: [
      {
        label: "1단계",
        title: "전 범위 의사결정 지도를 만들기",
        description: "전사 원칙에서 요건, 표준, 모델, 물리 설계와 품질 관리까지 산출물과 피드백 관계를 한 번에 정리합니다.",
      },
      {
        label: "2단계",
        title: "대안 비교의 기준 세우기",
        description: "정답처럼 보이는 하나의 설계에 머물지 않고 무결성, 성능, 변경, 운영과 비용 관점의 대안을 비교합니다.",
      },
      {
        label: "3단계",
        title: "실기형 답안을 구조화하기",
        description: "문제 상황, 핵심 원인, 설계 원칙, 구체적 개선안, 검증 방법과 부작용 순서로 답안을 작성합니다.",
      },
      {
        label: "4단계",
        title: "모의고사로 범위 전환 연습하기",
        description: "과목별 풀이 시간과 실기형 작성 시간을 분리해 기록하고, 약한 지식보다 느린 판단 과정을 먼저 보완합니다.",
      },
    ],
    checkpoints: [
      "서로 충돌하는 품질, 성능과 운영 요구를 대안 비교표로 설명할 수 있는가?",
      "논리 모델의 선택이 물리 설계와 데이터 품질 관리에 주는 영향을 추적할 수 있는가?",
      "실기형 답안에 원인, 원칙, 개선안, 검증과 부작용이 모두 포함되는가?",
      "표준 예외와 모델 변경을 일회성 처리하지 않고 거버넌스 절차로 연결할 수 있는가?",
    ],
    closing: "DAP에서는 넓은 범위를 모두 같은 깊이로 외우기보다, 하나의 설계 결정을 여러 과목의 기준으로 검토하는 연습이 중요합니다. 답안을 읽는 사람이 선택의 이유와 검증 방법까지 따라갈 수 있도록 작성하세요.",
  },
  "big-data-analysis": {
    slug: "big-data-analysis",
    examType: "BAE",
    eyebrow: "빅데이터분석기사 · 필기 과정",
    title: "빅데이터분석기사 필기는 분석 목적에서 결과 해석까지 한 흐름으로 연결해야 합니다.",
    description: "빅데이터분석기사 필기 네 과목은 독립된 암기 범위가 아닙니다. 해결할 문제와 데이터를 정의하고, 데이터를 탐색해 적절한 모델을 선택한 뒤, 평가 결과를 업무 판단으로 설명하는 분석 생애주기를 중심으로 공부하면 개념과 계산식을 함께 정리할 수 있습니다.",
    audience: [
      "빅데이터분석기사 필기 네 과목의 넓은 범위를 처음 구조화하는 학습자",
      "통계 계산과 머신러닝 용어를 실제 분석 절차에 연결하기 어려운 학습자",
      "공식과 모델 이름을 외우기보다 적용 조건과 결과 해석을 함께 익히려는 학습자",
    ],
    subjectGuidance: {
      "big-data-analysis-planning": {
        focus: "분석 과제 정의, 데이터 확보, 프로젝트 계획과 개인정보·윤리를 분석 목적 및 제약 조건과 연결합니다.",
        practice: "업무 요청을 목표 지표, 필요한 데이터, 검증 기준과 위험 요소가 포함된 분석 과제로 바꿔 봅니다.",
      },
      "big-data-exploration": {
        focus: "데이터 유형, 표본과 분포, 전처리 및 탐색적 분석이 이후 모델링 판단에 주는 영향을 이해합니다.",
        practice: "결측값·이상값·척도와 분포를 확인하고 각 처리 선택이 정보 손실과 편향에 미치는 영향을 설명합니다.",
      },
      "big-data-modeling": {
        focus: "통계적 추론과 머신러닝 모델의 가정, 목적, 학습 방식과 과적합 위험을 구분합니다.",
        practice: "문제 유형과 데이터 조건을 보고 후보 모델을 비교한 뒤 선택 근거와 검증 방법을 짧게 작성합니다.",
      },
      "big-data-result-interpretation": {
        focus: "평가 지표, 혼동행렬, 회귀·분류 결과와 시각화를 분석 목적에 맞게 해석합니다.",
        practice: "정확도 하나에 의존하지 않고 오류 비용, 데이터 불균형과 일반화 성능을 함께 고려해 결론을 내립니다.",
      },
    },
    learningSteps: [
      {
        label: "1단계",
        title: "분석 생애주기로 과목 연결하기",
        description: "기획, 데이터 탐색, 모델링과 결과 해석을 하나의 분석 사례에 배치해 각 개념이 쓰이는 시점을 먼저 정리합니다.",
      },
      {
        label: "2단계",
        title: "공식의 입력과 의미 확인하기",
        description: "계산 공식을 외우기 전에 각 항이 나타내는 값, 적용 전제와 결과가 커지거나 작아질 때의 의미를 설명합니다.",
      },
      {
        label: "3단계",
        title: "비슷한 모델을 선택 기준으로 구분하기",
        description: "회귀·분류·군집 모델을 이름으로 나누지 말고 목표 변수, 데이터 형태, 가정과 평가 방법으로 비교합니다.",
      },
      {
        label: "4단계",
        title: "오답을 분석 단계로 되돌리기",
        description: "틀린 문제를 과목명만으로 분류하지 않고 목표 정의, 전처리, 모델 선택, 평가 또는 해석 중 놓친 판단 단계에 연결합니다.",
      },
    ],
    checkpoints: [
      "분석 과제의 목표, 데이터 범위와 성공 기준을 서로 모순 없이 설명할 수 있는가?",
      "결측값과 이상값 처리 방법을 데이터 분포와 분석 목적에 따라 선택할 수 있는가?",
      "모델의 가정과 과적합 방지 방법을 평가 지표와 연결해 설명할 수 있는가?",
      "불균형 분류 문제에서 정확도 외의 지표가 필요한 이유를 혼동행렬로 설명할 수 있는가?",
    ],
    closing: "빅데이터분석기사 필기는 용어와 공식을 따로 외우는 시험처럼 보이지만, 실제로는 분석 과정에서 다음 판단을 고르는 문제의 비중이 큽니다. 문제를 풀 때마다 어떤 분석 단계의 선택인지 먼저 표시하고 정답 근거를 데이터 조건과 결과 해석으로 남겨 보세요.",
  },
  "big-data-practical": {
  "slug": "big-data-practical",
  "eyebrow": "빅데이터분석기사 · 실기",
  "title": "데이터를 읽고, 직접 실행하고, 요구한 결과를 확인하세요.",
  "description": "작업형 세 유형은 공통 환경을 사용하지만 산출물이 다릅니다. 1유형은 요구한 값, 2유형은 예측 CSV, 3유형은 소문항별 통계량을 만드는 흐름으로 연습합니다.",
  "audience": [
    "Python 문법은 알지만 데이터가 주어지면 시작 순서가 막히는 학습자",
    "예제 코드를 읽는 단계에서 직접 실행하는 단계로 넘어가려는 학습자"
  ],
  "subjectGuidance": {
    "type-1": {
      "focus": "조건 필터, 결측 처리, 그룹 집계와 통계량의 계산 순서를 이해합니다.",
      "practice": "같은 CSV의 문제들을 이어서 풀되 각 문제는 원본 데이터에서 다시 시작합니다. 평균 대체와 중앙값 대체를 구별하세요."
    },
    "type-2": {
      "focus": "목표변수, 평가지표, 전처리와 검증의 역할을 연결합니다.",
      "practice": "해당 문제의 학습·평가 CSV와 노트북을 내려받고, 학습 자료로 검증한 뒤 지정된 파일명·열·행 수로 예측값을 저장합니다."
    },
    "type-3": {
      "focus": "귀무·대립가설, 검정 방향, 표본 가정과 모형 계수의 의미를 구분합니다.",
      "practice": "결측 처리와 비교 방향을 확인하고 소문항별 수치를 계산합니다. 중간값은 유지하고 마지막에만 자릿수를 맞춥니다."
    }
  },
  "learningSteps": [
    {
      "label": "1단계",
      "title": "환경 준비",
      "description": "문제의 실습 파일을 내려받아 압축을 풀고 노트북의 설치·버전 확인·CSV 읽기 셀부터 실행합니다."
    },
    {
      "label": "2단계",
      "title": "요구사항만 읽고 풀이",
      "description": "참고 풀이를 접어 둔 상태에서 필요한 열과 결과물을 먼저 정합니다. 전체 문제집이나 정답은 다운로드 파일에 들어 있지 않습니다."
    },
    {
      "label": "3단계",
      "title": "출력과 근거 비교",
      "description": "사이트의 정답·참고 코드와 실제 출력을 비교합니다. 실행 성공뿐 아니라 단위, 검정 방향과 제출 형식도 점검합니다."
    },
    {
      "label": "4단계",
      "title": "처음부터 재현",
      "description": "커널을 재시작해 위에서 아래로 다시 실행합니다. 이전 문제의 변수나 수작업 수정에 의존하지 않는지 확인합니다."
    }
  ],
  "checkpoints": [
    "1유형에서 필터링과 결측 처리 순서가 결과에 주는 영향을 설명할 수 있는가?",
    "2유형에서 목표변수나 평가 자료의 정보를 전처리 학습에 섞지 않았는가?",
    "3유형에서 단측·양측 p값과 비교 방향, 출력 자릿수가 요구사항과 일치하는가?"
  ],
  "closing": "사이트는 실습 자료와 참고 풀이를 제공합니다. 실습 문제와 참고 풀이 화면은 로그인 후 이용하며, 코드는 자신의 Python 환경에서 실행합니다. 이 공개 가이드는 로그인 없이 읽을 수 있습니다."
},
  "ipe-written": {
  "slug": "ipe-written",
  "examType": "IPEW",
  "eyebrow": "정보처리기사 · 필기",
  "title": "다섯 과목을 개발 과정 안에서 연결하세요.",
  "description": "설계에서 구현, 데이터 저장, 실행 환경과 운영으로 이어지는 관계를 먼저 정리합니다. 단원별 이론을 읽은 뒤 문제로 확인하고, 모의고사에서 드러난 약점을 해당 단원으로 되돌립니다.",
  "audience": [
    "정보처리기사 필기 범위를 처음 정리하는 학습자",
    "용어는 외웠지만 유사한 개념과 선택지를 구분하기 어려운 학습자"
  ],
  "subjectGuidance": {
    "ipe-software-design": {
      "focus": "요구사항, 설계 모델과 인터페이스의 역할을 구분합니다.",
      "practice": "하나의 서비스 예시에 요구사항과 설계 원칙을 연결해 설명합니다."
    },
    "ipe-software-development": {
      "focus": "자료구조, 구현, 테스트와 형상관리의 연결을 이해합니다.",
      "practice": "테스트 기준과 오류 상황을 비교하고 자료구조의 연산 결과를 추적합니다."
    },
    "ipe-database-construction": {
      "focus": "키·정규화·관계·SQL·트랜잭션을 함께 정리합니다.",
      "practice": "작은 테이블로 조인·집계 결과와 무결성 조건을 직접 확인합니다."
    },
    "ipe-programming-language-utilization": {
      "focus": "언어의 실행 규칙과 운영체제·네트워크 기초를 구분합니다.",
      "practice": "변수와 참조, 반복문의 상태를 순서대로 기록하고 프로토콜 계층을 비교합니다."
    },
    "ipe-information-system-construction-management": {
      "focus": "개발 방법, 운영·보안과 시스템 구성의 목적을 이해합니다.",
      "practice": "비슷한 보안 용어를 공격 원인·방어 방법·적용 위치로 비교합니다."
    }
  },
  "learningSteps": [
    {
      "label": "1단계",
      "title": "단원 구조 파악",
      "description": "다섯 과목의 이론 목록에서 알고 있는 개념과 생소한 개념을 나눕니다."
    },
    {
      "label": "2단계",
      "title": "이론과 문제 함께 학습",
      "description": "짧은 단원을 읽고 관련 문제를 풉니다. 틀린 선택지가 왜 틀렸는지도 확인합니다."
    },
    {
      "label": "3단계",
      "title": "헷갈리는 개념 비교",
      "description": "오답을 개념 혼동, 계산 실수, 지문 조건 누락으로 나누고 다시 설명합니다."
    },
    {
      "label": "4단계",
      "title": "모의고사로 점검",
      "description": "여러 과목을 섞어 풀고 부족한 과목과 오래 걸리는 문제를 다음 학습 범위로 정합니다."
    }
  ],
  "checkpoints": [
    "다섯 과목 중 반복해서 틀리는 단원을 알고 있는가?",
    "정답을 외운 문제에서도 다른 선택지를 제외하는 이유를 설명할 수 있는가?",
    "코드와 SQL 결과를 보기 없이 추적할 수 있는가?"
  ],
  "closing": "낯선 용어를 끝없이 늘리기보다 공개된 단원의 핵심 개념을 문제에 적용하는 연습을 반복하세요."
},
  "ipe-practical": {
  "slug": "ipe-practical",
  "examType": "IPEP",
  "eyebrow": "정보처리기사 · 실기",
  "title": "보기 없이 답을 쓰고, 계산 과정을 재현하세요.",
  "description": "실기에서는 용어를 알아보는 것과 직접 떠올려 쓰는 것이 다릅니다. 보강 이론의 풀이와 예시를 확인한 뒤 코드·SQL·핵심 개념을 답안으로 작성하는 연습을 합니다.",
  "audience": [
    "필기 개념을 실기 답안으로 연결하려는 학습자",
    "코드 출력과 SQL 결과에서 실수가 반복되는 학습자"
  ],
  "subjectGuidance": {
    "ipe-practical-work": {
      "focus": "프로그래밍·SQL·데이터베이스·네트워크·보안·개발 관련 핵심 개념을 실제 결과와 연결합니다.",
      "practice": "코드는 변수 상태, SQL은 결과 행을 기록하며 풉니다. 여러 답을 요구하면 각 입력칸에 한 항목씩 작성합니다."
    }
  },
  "learningSteps": [
    {
      "label": "1단계",
      "title": "풀이와 예시 읽기",
      "description": "이론의 설명을 읽고 예시를 직접 따라갑니다. 결과만 보지 말고 각 단계가 필요한 이유를 확인합니다."
    },
    {
      "label": "2단계",
      "title": "단답형 직접 입력",
      "description": "정답을 접은 상태에서 답을 작성합니다. 출력 문제는 공백·대소문자·순서를 포함한 안내를 따릅니다."
    },
    {
      "label": "3단계",
      "title": "주제별 단답형 연습",
      "description": "로그인 후 제공되는 연습 문제로 코드·SQL·용어를 직접 작성합니다. 과거 시험의 회차별 기출 문제는 현재 공개 제공하지 않습니다."
    },
    {
      "label": "4단계",
      "title": "부분 정답 복습",
      "description": "여러 입력칸 중 틀린 항목을 따로 복습합니다. 사이트의 부분점수는 연습용 기준이며 실제 시험의 세부 채점 기준을 뜻하지 않습니다."
    }
  ],
  "checkpoints": [
    "코드에서 배열·참조·반복문 변화 과정을 적을 수 있는가?",
    "SQL의 NULL·조인·집계 조건을 결과 행과 연결할 수 있는가?",
    "여러 개의 답을 요구할 때 개수와 순서를 놓치지 않았는가?"
  ],
  "closing": "자동채점은 등록된 허용 정답과 형식에 따라 동작합니다. 의미상 같은 답이 오답으로 표시되면 입력 형식과 해설을 먼저 확인하고 문제 신고로 검토를 요청하세요."
},
  "ise-written": {
    slug: "ise-written",
    examType: "ISEW",
    eyebrow: "정보보안기사 · 필기 이론",
    title: "정상 동작을 이해하고 공격과 대응을 연결하세요.",
    description: "운영체제의 접근통제와 네트워크의 전달 원리를 먼저 익힌 뒤, 공격이 어느 경계를 깨는지 설명해 봅니다. 필기 5과목의 이론을 제공하며, 암호·인증·접근통제에서 위험관리·개인정보 보호까지 연결해 학습합니다.",
    audience: ["정보보안기사 필기를 준비하며 운영체제·통신 기초를 정리하려는 학습자", "보안 용어를 외웠지만 로그와 패킷 예제에 적용하기 어려운 학습자"],
    subjectGuidance: {
      "ise-system-security": {
        focus: "계정·프로세스·파일 권한과 운영체제의 보호 경계를 이해하고 보안위협의 원인과 대응을 연결합니다.",
        practice: "권한 계산과 로그 예제를 따라가며 인증·인가·감사, 예방·탐지·복구의 역할을 구분합니다.",
      },
      "ise-network-security": {
        focus: "계층·주소·프로토콜의 정상 흐름을 바탕으로 네트워크 공격과 보안 시스템의 보호 범위를 이해합니다.",
        practice: "서브넷과 Seq/Ack를 계산하고 스캔 응답·로그·패킷이 의미하는 사실과 아직 알 수 없는 사실을 나눕니다.",
      },
      "ise-application-security": {
        focus: "FTP·메일·DNS·웹·DB의 정상 흐름과 전자상거래·개발 보안의 보호 경계를 이해합니다.",
        practice: "SQL 삽입·XSS·CSRF의 처리 주체를 비교하고 입력·출력·세션·권한을 어디에서 검사해야 하는지 설명합니다.",
      },
      "ise-security-general": {
        focus: "암호·해시·전자서명의 보호 목표와 사용자 인증·접근통제의 차이를 이해합니다.",
        practice: "RSA·DH의 작은 수 계산을 따라 하고 운영 모드·생체 오류율·Bell–LaPadula와 Biba의 읽기·쓰기 규칙을 비교합니다.",
      },
      "ise-security-management-law": {
        focus: "위험관리·사고대응·업무연속성·인증과 정보보호 법규의 적용 범위를 이해합니다.",
        practice: "SLE·ALE와 복구 목표를 계산하고 제공·위탁, 통지·신고를 비교합니다. 법규는 시행일·대상·요건·예외를 함께 확인합니다.",
      },
    },
    learningSteps: [
      { label: "1단계", title: "정상 흐름 그리기", description: "파일 접근이나 서버 접속의 경로를 그린 뒤 계정·권한·주소·포트가 사용되는 위치를 표시합니다." },
      { label: "2단계", title: "공격과 대응 연결하기", description: "어떤 정보가 위조되거나 어떤 자원이 고갈되는지 찾고, 예방·탐지·차단이 가능한 지점을 연결합니다." },
      { label: "3단계", title: "예제 직접 해석하기", description: "계산 결과와 출력 해설을 보기 전에 답을 적습니다. 응답 부재나 경보 하나로 공격 성공을 단정하지 않습니다." },
      { label: "4단계", title: "개념 확인으로 복습하기", description: "이론 아래의 개념 확인 문제를 먼저 풀고 정답·해설을 펼쳐 비교합니다. 혼동한 개념은 비교표나 그림으로 다시 정리합니다." },
    ],
    checkpoints: ["인증 성공과 자원 접근 허용을 구분할 수 있는가?", "서브넷과 TCP 순서번호 예제를 새로운 값으로 계산할 수 있는가?", "방화벽·IDS·IPS·VPN이 각각 보호하는 범위와 한계를 설명할 수 있는가?", "SQL 삽입·XSS·CSRF의 원인과 대응 위치를 구분할 수 있는가?", "암호화·MAC·전자서명의 보호 범위와 재전송 방지를 구분할 수 있는가?", "Bell–LaPadula와 Biba의 금지 방향을 설명할 수 있는가?", "관찰한 로그·패킷만으로 알 수 없는 사실을 구분할 수 있는가?", "위험 처리·RTO·RPO와 개인정보 통지·신고의 조건을 사례에 적용할 수 있는가?"],
    closing: "필기 5과목을 이론과 사례로 학습할 수 있습니다. 법규는 시험의 적용 기준일을 함께 확인하세요. 이론별 개념 확인 문제는 복습용이며, 문제 은행과 모의고사는 별도 자료 검토를 거쳐 제공됩니다.",
  },
  "software-major": {
  "slug": "software-major",
  "eyebrow": "SW 전공 · 분야별 학습",
  "title": "학습 목적에 맞는 기초와 전공 범위를 연결하세요.",
  "description": "전체 전공을 같은 깊이로 한 번에 공부하기보다 목표에 필요한 과목을 정하고 개념·문제·오답을 짧은 주기로 반복합니다.",
  "audience": [
    "컴퓨터공학 전공 기초를 다시 정리하려는 학습자",
    "개발·데이터·보안 분야에 필요한 선수 지식을 보완하려는 학습자"
  ],
  "subjectGuidance": {
    "computer-science-foundations": {
      "focus": "컴퓨터 구조·운영체제·알고리즘 등 실행 원리를 정리합니다.",
      "practice": "명령 실행, 프로세스 상태와 자료구조 연산을 작은 예제로 추적합니다."
    },
    "data-and-communication": {
      "focus": "데이터 저장과 네트워크 전달 과정의 계층을 이해합니다.",
      "practice": "데이터베이스 처리와 통신 흐름을 단계별로 비교합니다."
    },
    "software-development": {
      "focus": "언어·설계·구현·테스트의 관계를 이해합니다.",
      "practice": "짧은 코드로 객체 관계와 설계 원칙을 적용하고 테스트 조건을 적습니다."
    },
    "security-and-operations": {
      "focus": "보안 통제와 시스템 운영의 목적을 구분합니다.",
      "practice": "오류나 공격 사례에서 원인과 예방·대응 방법을 연결합니다."
    },
    "data-ai-digital-technology": {
      "focus": "데이터·AI 개념과 기반 기술의 역할을 정리합니다.",
      "practice": "기술 이름보다 입력, 처리 과정, 결과와 한계를 비교합니다."
    }
  },
  "learningSteps": [
    {
      "label": "1단계",
      "title": "목적과 범위 선택",
      "description": "전공 기초 보완인지 특정 분야 준비인지 정하고 학습 범위 또는 추천 조합을 선택합니다."
    },
    {
      "label": "2단계",
      "title": "선수 개념 확인",
      "description": "이해가 막히면 용어를 추가로 외우기보다 해당 개념이 의존하는 기초로 돌아갑니다."
    },
    {
      "label": "3단계",
      "title": "문제로 설명하기",
      "description": "정답을 고른 뒤 근거와 다른 선택지의 오류를 한 문장으로 설명합니다."
    },
    {
      "label": "4단계",
      "title": "범위별 복습",
      "description": "오답이 쌓인 과목을 우선 복습한 뒤 범위를 섞어 다시 점검합니다."
    }
  ],
  "checkpoints": [
    "학습 목표에 필요한 과목과 선수 개념을 구분했는가?",
    "용어를 코드·구조·동작 과정의 예시로 설명할 수 있는가?",
    "틀린 문제의 판단 근거를 보완한 뒤 다시 풀었는가?"
  ],
  "closing": "SW 전공 과정은 특정 자격시험 한 종목의 출제 범위가 아닙니다. 자신의 학습 목적에 맞춰 제공 범위를 선택하세요."
},
};

export function publicCourseGuide(slug: PublicGuideSlug) {
  return PUBLIC_COURSE_GUIDES[slug];
}

export function guideTheoryPath(guide: PublicCourseGuide): string | null {
  if (guide.examType) return learningPath({ examType: guide.examType, page: "theories" });
  if (guide.slug === "software-major") return learningPath({ fieldId: "software-major", page: "field", section: "theories" });
  return null;
}

export function guideLearningCourse(guide: PublicCourseGuide) {
  if (guide.slug === "skct-personal") return SKCT_GUIDE_COURSE;
  if (guide.examType) return { ...learningCourse(guide.examType), href: learningPath({ examType: guide.examType, page: "home" }) };
  if (guide.slug === "big-data-practical") {
    const course = releasedLocalPracticeCourses("big-data-analysis")[0];
    return { name: course.name, studyMode: "작업형 1·2·3유형 · 내 컴퓨터에서 Python 실습", mockExam: "유형별 실습 문제와 참고 풀이 제공", href: localPracticePath(course), subjects: localPracticeWorkbooks(course).map(item => ({ id: item.id, name: item.title })) };
  }
  const field = learningField("software-major")!;
  return { name: field.cardTitle, studyMode: "과목·학습 범위별 이론과 문제", mockExam: "선택 범위에 따른 모의고사", href: learningPath({ fieldId: field.id, page: "field" }), subjects: field.subjectGroups!.map(group => ({ id: group.id, name: group.name })) };
}
