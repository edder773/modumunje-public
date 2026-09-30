const REVIEW_HEADING = /^##\s+복습\s+문제\s*$/mu;
const ANSWER_HEADING = /^##\s+복습\s+문제\s+정답\s+및\s+해설\s*$/mu;
const NEXT_LEVEL_TWO_HEADING = /^##\s+(?!복습\s+문제\s*$).+$/mu;

function numberedBlocks(value) {
  const lines = String(value ?? "").replaceAll("\r\n", "\n").split("\n");
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const marker = line.match(/^(?:#{3,6}\s+)?(\d+)[.]\s+(.+)$/u);
    if (marker) {
      if (current) blocks.push(current);
      current = {
        number: Number(marker[1]),
        body: marker[2],
      };
      continue;
    }
    if (current) current.body += `\n${line}`;
  }
  if (current) blocks.push(current);
  return blocks.map((block) => ({
    ...block,
    body: block.body.trim(),
  }));
}

export function splitTheoryReview(content, reviewAnswers) {
  const source = String(content ?? "").replaceAll("\r\n", "\n");
  const heading = REVIEW_HEADING.exec(source);
  if (!heading) {
    return { mainContent: source.trim(), items: [] };
  }

  const before = source.slice(0, heading.index).trim();
  let reviewSection = source.slice(heading.index + heading[0].length).trim();
  let trailingReference = "";
  const embeddedAnswerHeading = ANSWER_HEADING.exec(reviewSection);
  if (embeddedAnswerHeading) {
    reviewSection = reviewSection.slice(0, embeddedAnswerHeading.index).trim();
  }
  const trailingHeading = NEXT_LEVEL_TWO_HEADING.exec(reviewSection);
  if (trailingHeading) {
    trailingReference = reviewSection.slice(trailingHeading.index).trim();
    reviewSection = reviewSection
      .slice(0, trailingHeading.index)
      .replace(/\n*---\s*$/u, "")
      .trim();
  }

  const answerSource = String(reviewAnswers ?? "")
    .replaceAll("\r\n", "\n")
    .replace(ANSWER_HEADING, "")
    .trim();
  const questions = numberedBlocks(reviewSection);
  const answerByNumber = new Map(
    numberedBlocks(answerSource).map((answer) => [answer.number, answer.body]),
  );
  const items = questions
    .map((question) => ({
      number: question.number,
      question: question.body,
      answer: answerByNumber.get(question.number) ?? "",
    }))
    .filter((item) => item.question && item.answer);
  const mainContent = [before, trailingReference]
    .filter(Boolean)
    .join("\n\n---\n\n")
    .trim();

  if (!items.length || items.length !== questions.length) {
    return { mainContent: source.trim(), items: [] };
  }
  return { mainContent, items };
}
