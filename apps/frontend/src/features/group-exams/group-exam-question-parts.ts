/** Separate presentation without changing immutable question snapshots. */
export function splitGroupQuestionPrompt(prompt: string) {
  const sections = [...prompt.matchAll(/^#{1,6}\s*(지문|자료|조건|문제|질문)\s*$/gmu)];
  if (sections.some(section => section[1] === "문제" || section[1] === "질문")) {
    const stimulus: string[] = [], instruction: string[] = [];
    const prefix = prompt.slice(0, sections[0].index).trim();
    if (prefix) stimulus.push(prefix);
    sections.forEach((section, index) => {
      const text = prompt.slice(section.index! + section[0].length, sections[index + 1]?.index ?? prompt.length).trim();
      if (!text) return;
      if (section[1] === "문제" || section[1] === "질문") instruction.push(text);
      else stimulus.push(text);
    });
    return {stimulus:stimulus.join("\n\n"), instruction:instruction.join("\n\n")};
  }
  const paragraphs = prompt.trim().split(/\n\s*\n/u);
  const sentences = paragraphs[0]?.split(/(?<=[.!?])\s+/u) ?? [];
  const last = sentences.at(-1) ?? "";
  const directive = /(?:\?|(?:고르시오|고르세요|구하시오|구하세요|적절한 것은|옳은 것은|옳지 않은 것은|참인 것은|틀린 것은)[.?]?)\s*$/u;
  if (directive.test(last) && !last.includes("\n")) {
    return {stimulus:[sentences.slice(0,-1).join(" "),...paragraphs.slice(1)].filter(Boolean).join("\n\n"),instruction:last};
  }
  return {stimulus:prompt,instruction:""};
}
