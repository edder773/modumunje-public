/** Narrow editorial repairs. Never change IDs, answer indexes, or learner records. */
export function repairEditorialText(value) {
  if (typeof value !== "string") return value;
  const particles = { "단말는": "단말은", "단말가": "단말이", "단말를": "단말을", "그룹코드을": "그룹코드를", "소속센터을": "소속센터를", "유효종료일는": "유효종료일은", "유효시작일를": "유효시작일을", "유효시작일는": "유효시작일은", "유효종료일를": "유효종료일을", "`유효시작일`와": "`유효시작일`과", "담당자은": "담당자는", "담당자이": "담당자가", "경계을": "경계를", "가치을": "가치를", "로그을": "로그를" };
  let text = value.replace(/\bTSTAFF_SAMPLE\b/gu, "TEMP");
  for (const [from, to] of Object.entries(particles)) text = text.replaceAll(from, to);
  return text.replace(/([가-힣])을\(를\)/gu, (_, syllable) => `${syllable}${(syllable.charCodeAt(0) - 0xac00) % 28 ? "을" : "를"}`);
}

export function repairDaExplanation(value) {
  let text = value;
  // The outer template already carries the answer and choice, so keep it and the real detail.
  const duplicate = text.match(/^(## 정답\n[\s\S]*?)\n## 상세 해설\s*\n## 정답\n[\s\S]*?\n## 상세 해설\n([\s\S]*)$/u);
  if (duplicate) text = `${duplicate[1].trimEnd()}\n\n## 상세 해설\n${duplicate[2]}`;
  text = text.replace(/^- \*\*([A-E])\.\*\*/gmu, (_, letter) => `- **${"①②③④⑤"[letter.charCodeAt(0) - 65]}**`);
  // A fenced block starts and ends on its own line. The explanation remains normal prose.
  text = text.replace(/^(- \*\*[①②③④⑤]\*\*) (```\w*)$/gmu, "$1\n\n$2")
    .replace(/^``` — /gmu, "```\n\n");
  const repeated = text.match(/^(## 모범답안과 상세 해설\n)([\s\S]*?)\n## 핵심 해설\n([\s\S]*?)(?=\n## |$)/u);
  if (repeated && repeated[2].trim() === repeated[3].trim()) {
    text = text.replace(repeated[0], `${repeated[1]}${repeated[2].trim()}\n`);
  }
  return text;
}
