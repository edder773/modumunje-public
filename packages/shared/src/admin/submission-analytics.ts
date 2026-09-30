export type SubjectSubmissionCount = {
  examType: string;
  courseName: string;
  subject: string;
  memberCount: number;
  guestCount: number;
  count: number;
};

export type CertificationSubmissionCount = {
  certificationId: string;
  certificationName: string;
  memberCount: number;
  guestCount: number;
  count: number;
};

const certificationGroups: Record<string, readonly [string, string]> = {
  IPE: ["IPE", "정보처리기사"],
  IPEW: ["IPE", "정보처리기사"],
  IPEP: ["IPE", "정보처리기사"],
  ISEW: ["ISE", "정보보안기사"],
  ISEP: ["ISE", "정보보안기사"],
  BAE: ["BAE", "빅데이터분석기사"],
};

export function certificationSubmissionCounts(items: SubjectSubmissionCount[]): CertificationSubmissionCount[] {
  const grouped = new Map<string, CertificationSubmissionCount>();
  for (const item of items) {
    const [id, name] = certificationGroups[item.examType] ?? [item.examType, item.courseName];
    const row = grouped.get(id) ?? {
      certificationId: id, certificationName: name, memberCount: 0, guestCount: 0, count: 0,
    };
    row.memberCount += item.memberCount;
    row.guestCount += item.guestCount;
    row.count += item.count;
    grouped.set(id, row);
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count || a.certificationName.localeCompare(b.certificationName, "ko"));
}
