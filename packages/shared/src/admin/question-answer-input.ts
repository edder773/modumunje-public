export function validateAdminAnswerIndices(value: unknown, choiceCount: number, kind: string): number[] {
  if (kind === "descriptive") return [];
  if (!Array.isArray(value) || !value.length) throw new Error("정답 번호를 입력해 주세요.");
  if (value.some(answer => typeof answer !== "number" || !Number.isSafeInteger(answer) || answer < 0 || answer >= choiceCount)) {
    throw new Error(`정답 번호는 1부터 ${choiceCount}까지의 정수로 입력해 주세요.`);
  }
  if (new Set(value).size !== value.length) throw new Error("같은 정답 번호를 중복 입력할 수 없습니다.");
  if (kind === "single" && value.length !== 1) throw new Error("단일 정답 문제에는 정답 번호를 하나만 입력해 주세요.");
  return [...value];
}

export function parseAdminAnswerNumbers(input: string, choiceCount: number, kind: string): number[] {
  if (kind === "descriptive") return [];
  const tokens = input.normalize("NFKC").split(/[\s,]+/u).filter(Boolean);
  if (tokens.some(token => !/^\d+$/u.test(token))) {
    throw new Error("정답 번호는 정수로 입력하고, 여러 번호는 쉼표나 공백으로 구분해 주세요.");
  }
  return validateAdminAnswerIndices(tokens.map(token => Number(token) - 1), choiceCount, kind);
}
