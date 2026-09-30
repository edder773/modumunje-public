export const PUBLIC_GUIDE_LINKS = [
  { slug: "skct-personal", name: "SKCT 개인학습", title: "SKCT 학습 가이드", summary: "다섯 영역의 판단 근거를 익히고 문제 풀이와 모의고사를 활용합니다." },
  {
    slug: "sqld",
    name: "SQLD",
    title: "SQLD 학습 가이드",
    summary: "데이터 모델링의 이해에서 SQL 기본·활용까지 연결하는 입문 학습 순서를 안내합니다.",
  },
  {
    slug: "sqlp",
    name: "SQLP",
    title: "SQLP 학습 가이드",
    summary: "SQL 기본기를 튜닝 판단과 실행 계획 해석으로 확장하는 심화 학습 순서를 안내합니다.",
  },
  {
    slug: "dasp",
    name: "DAsP",
    title: "DAsP 학습 가이드",
    summary: "전사아키텍처, 데이터 요건, 표준화와 모델링의 연결 관계를 중심으로 학습합니다.",
  },
  {
    slug: "dap",
    name: "DAP",
    title: "DAP 학습 가이드",
    summary: "데이터아키텍처 전 범위를 설계 판단과 실기형 답안으로 통합하는 방법을 안내합니다.",
  },
  {
    slug: "big-data-analysis",
    name: "빅데이터분석기사 필기",
    title: "빅데이터분석기사 필기 학습 가이드",
    summary: "분석기획, 탐색, 모델링과 결과 해석을 연결해 필기 네 과목을 학습하는 순서를 안내합니다.",
  },
  {"slug": "big-data-practical", "name": "빅데이터분석기사 실기", "title": "빅데이터분석기사 실기 학습 가이드", "summary": "유형별 데이터 처리, 예측 모델과 통계 분석을 직접 실행하고 출력 형식을 점검합니다."},
  {"slug": "ipe-written", "name": "정보처리기사 필기", "title": "정보처리기사 필기 학습 가이드", "summary": "설계·개발·데이터베이스·언어·운영을 연결하며 과목별 약점을 보완합니다."},
  {"slug": "ipe-practical", "name": "정보처리기사 실기", "title": "정보처리기사 실기 학습 가이드", "summary": "코드 실행 결과, SQL과 핵심 용어를 이해하고 주제별 단답형 문제로 점검합니다."},
  { slug: "ise-written", name: "정보보안기사 필기", title: "정보보안기사 필기 학습 가이드", summary: "필기 5과목의 보안 원리와 위험관리·개인정보 법규를 사례로 연결합니다." },
  {"slug": "software-major", "name": "SW 전공", "title": "SW 전공 학습 가이드", "summary": "컴퓨터과학 기초부터 개발·데이터·보안까지 학습 목적에 맞는 범위를 선택합니다."},
] as const;

export type PublicGuideSlug = typeof PUBLIC_GUIDE_LINKS[number]["slug"];

export function isPublicGuideSlug(value: string): value is PublicGuideSlug {
  return PUBLIC_GUIDE_LINKS.some((guide) => guide.slug === value);
}
