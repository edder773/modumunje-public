const ABSOLUTE_WORDS = Object.freeze([
  "항상", "무조건", "즉시", "모든", "만으로", "절대", "반드시", "전혀", "오직",
]);

const COURSE_SCOPES = Object.freeze({
  SQLD: ["both"],
  SQLP: ["both", "SQLP"],
  DASP: ["DA"],
  DAP: ["DA", "DAP"],
  BAE: ["BAE"],
  IPEW: ["IPEW"],
  ISEW: ["ISEW"],
  IPEP: ["IPEP"],
  SW: ["SW"],
});
const REQUIRED_COURSES = Object.freeze(["SQLD", "SQLP", "DASP", "DAP", "BAE", "IPEW", "ISEW", "SW"]);

function list(value, name, id) {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); }
    catch { throw new Error("answer cue gate: invalid " + name + " for question " + id); }
  }
  if (!Array.isArray(parsed)) throw new Error("answer cue gate: invalid " + name + " for question " + id);
  return parsed;
}

function absoluteWord(text) {
  return ABSOLUTE_WORDS.some((word) => text.includes(word));
}

function measure(rows) {
  let count = 0;
  let expectedSum = 0;
  let uniqueLongest = 0;
  let uniqueLongestCorrect = 0;
  let ratioSum = 0;
  let correctAbsolute = 0;
  let wrongAbsolute = 0;
  let wrongCount = 0;
  for (const row of rows) {
    if (row.active === 0 || row.kind !== "single") continue;
    const choices = list(row.choices, "choices", row.id).map(String);
    const answers = list(row.correct_answers, "correct_answers", row.id);
    if (choices.length < 2 || answers.length !== 1 || !Number.isInteger(answers[0])
      || answers[0] < 0 || answers[0] >= choices.length) {
      throw new Error("answer cue gate: invalid single-answer contract for question " + row.id);
    }
    const lengths = choices.map((choice) => Array.from(choice).length);
    const maximum = Math.max(...lengths);
    const ties = lengths.flatMap((length, index) => length === maximum ? [index] : []);
    const correct = answers[0];
    const wrongMean = lengths.reduce((sum, length, index) => sum + (index === correct ? 0 : length), 0)
      / (lengths.length - 1);
    if (wrongMean <= 0) throw new Error("answer cue gate: empty wrong choice for question " + row.id);
    count += 1;
    expectedSum += ties.includes(correct) ? 1 / ties.length : 0;
    if (ties.length === 1) {
      uniqueLongest += 1;
      uniqueLongestCorrect += Number(ties[0] === correct);
    }
    ratioSum += lengths[correct] / wrongMean;
    correctAbsolute += Number(absoluteWord(choices[correct]));
    choices.forEach((choice, index) => {
      if (index !== correct) {
        wrongCount += 1;
        wrongAbsolute += Number(absoluteWord(choice));
      }
    });
  }
  if (count === 0) return null;
  return {
    singleItems: count,
    pickLongestExpectedAccuracy: expectedSum / count,
    tiedLongestItems: count - uniqueLongest,
    uniqueLongestItems: uniqueLongest,
    uniqueLongestCorrectRate: uniqueLongest ? uniqueLongestCorrect / uniqueLongest : null,
    meanCorrectToWrongLengthRatio: ratioSum / count,
    correctAbsoluteChoiceRate: correctAbsolute / count,
    wrongAbsoluteChoiceRate: wrongAbsolute / wrongCount,
    wrongMinusCorrectAbsoluteGap: wrongAbsolute / wrongCount - correctAbsolute / count,
  };
}

export function evaluateAnswerCueGate(questionRows, { swRows = [] } = {}) {
  if (!Array.isArray(questionRows) || !Array.isArray(swRows)) {
    throw new Error("answer cue gate: question rows must be arrays");
  }
  const all = [...questionRows, ...swRows.map((row) => ({ ...row, exam_scope: "SW" }))];
  const scopes = [...new Set(all.map((row) => row.exam_scope))];
  const byScope = Object.fromEntries(scopes.map((scope) => [
    scope, measure(all.filter((row) => row.exam_scope === scope)),
  ]).filter(([, value]) => value));
  const covered = new Set(Object.values(COURSE_SCOPES).flat());
  const unknown = Object.keys(byScope).filter((scope) => !covered.has(scope));
  if (unknown.length) throw new Error("answer cue gate: unmapped exam scopes: " + unknown.join(", "));
  const byCourse = Object.fromEntries(Object.entries(COURSE_SCOPES).map(([course, members]) => [
    course, measure(all.filter((row) => members.includes(row.exam_scope))),
  ]).filter(([, value]) => value));
  return { byScope, byCourse, threshold: 0.40, absoluteWords: [...ABSOLUTE_WORDS] };
}

export function assertAnswerCueGate(questionRows, options = {}) {
  const report = evaluateAnswerCueGate(questionRows, options);
  const requiredCourses = options.requiredCourses ?? REQUIRED_COURSES;
  if (!Array.isArray(requiredCourses) || requiredCourses.some((course) => !Object.hasOwn(COURSE_SCOPES, course))) {
    throw new Error("answer cue gate: invalid required course list");
  }
  const missing = requiredCourses.filter((course) => !report.byCourse[course]?.singleItems);
  if (missing.length) throw new Error("answer cue gate: missing active single items for " + missing.join(", "));
  const failed = Object.entries(report.byCourse).filter(([, metric]) => (
    metric.pickLongestExpectedAccuracy > report.threshold
  ));
  if (failed.length) {
    throw new Error("answer cue gate failed (pick-longest > 0.40): "
      + failed.map(([course, metric]) => course + "="
        + metric.pickLongestExpectedAccuracy.toFixed(4)).join(", "));
  }
  return report;
}
