import { createHash } from "node:crypto";

const areas = ["언어이해", "자료해석", "창의수리", "언어추리", "수열추리"] as const;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function syntheticSkctBank() {
  const sourceText = "Synthetic SKCT bank source for contract tests only, version 1";
  const sourceSha256 = sha256(sourceText);
  const asset = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>';
  const questions = areas.flatMap((areaCode, areaIndex) => Array.from({ length: 10 }, (_, index) => {
    const questionUid = `synthetic-${areaIndex + 1}-${String(index + 1).padStart(2, "0")}`;
    const sourceRef = {
      sourceId: "synthetic-skct-source-v1",
      sourceSha256,
      pageBlock: `${areaCode}-${index + 1}`,
      jsonPointer: `/questions/${areaIndex * 10 + index}`,
    };
    const provenance = { unifiedMdLines: [index + 1, index + 1], sourceRefs: [sourceRef] };
    return {
      questionUid,
      contentSet: "synthetic-contract-v1",
      areaCode,
      questionNo: index + 1,
      kind: "single" as const,
      promptMd: `${areaCode} 합성 검증 문항 ${index + 1}`,
      choices: ["선택 ①", "선택 ②", "선택 ③", "선택 ④", "선택 ⑤"],
      correctAnswers: [index % 5],
      explanationMd: `합성 검증 해설 ${index + 1}`,
      dependencyGroupId: null,
      assets: areaIndex === 0 && index === 0 ? [{
        path: "assets/synthetic/first.svg",
        sha256: sha256(asset),
        bytes: Buffer.byteLength(asset),
      }] : [],
      provenance: { question: provenance, answerExplanation: provenance },
    };
  }));
  const core = {
    schema: "baeumzip.skct-group-bank.v1",
    dataset: "Synthetic SKCT contract 50",
    releaseId: "synthetic-skct-50-v1",
    status: "validated",
    source: {
      completedFolderId: "synthetic-only",
      jsonFileId: "synthetic-only",
      jsonSha256: sha256(JSON.stringify({ questions })),
      mdFileId: "synthetic-only",
      mdSha256: sourceSha256,
      recoveryManifestSha256: sha256("synthetic-recovery-manifest-v1"),
    },
    choiceIndexBase: 0,
    questions,
  };
  return { ...core, releaseSha256: sha256(JSON.stringify(core)) };
}
