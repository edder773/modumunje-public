"use client";

import { certificationSubmissionCounts, type SubjectSubmissionCount } from "@shared/admin/submission-analytics";
import { EmptyState } from "./admin-ui";
import "./admin-certification-submissions.css";

const number = (value: number) => value.toLocaleString("ko-KR");
const dateFormat = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", weekday: "short" });

export default function CertificationSubmissions({ items, date }: { items: SubjectSubmissionCount[]; date: string }) {
  const rows = certificationSubmissionCounts(items);
  const totals = rows.reduce((sum, row) => ({
    count: sum.count + row.count,
    memberCount: sum.memberCount + row.memberCount,
    guestCount: sum.guestCount + row.guestCount,
  }), { count: 0, memberCount: 0, guestCount: 0 });

  return <section className="admin-card admin-certification-submissions" aria-labelledby="certification-submissions-title">
    <div className="admin-card-head">
      <div><h3 id="certification-submissions-title">자격증별 답안 제출</h3><p><strong>{dateFormat.format(new Date(`${date}T12:00:00+09:00`))}</strong> 하루 동안 제출된 답안입니다. 그래프에서 다른 날짜를 선택하면 함께 바뀝니다.</p><p>각 자격증의 모든 과목과 필기·실기 제출 횟수를 합산합니다. SW 전공은 하나의 학습 분야로 표시합니다.</p></div>
    </div>
    {rows.length ? <div className="admin-submission-scroll" role="region" aria-label={`${date} 자격증별 제출 횟수 표`} tabIndex={0}>
      <table>
        <caption className="sr-only">{date} 자격증별 전체·회원·비회원 답안 제출 횟수</caption>
        <thead><tr><th scope="col">자격증·학습 분야</th><th scope="col">전체</th><th scope="col">회원</th><th scope="col">비회원</th></tr></thead>
        <tbody>{rows.map(item => <tr key={item.certificationId}>
          <th scope="row">{item.certificationName}</th>
          <td className="admin-submission-total">{number(item.count)}회</td><td>{number(item.memberCount)}회</td><td>{number(item.guestCount)}회</td>
        </tr>)}</tbody>
        <tfoot><tr><th scope="row">전체 합계</th><td>{number(totals.count)}회</td><td>{number(totals.memberCount)}회</td><td>{number(totals.guestCount)}회</td></tr></tfoot>
      </table>
    </div> : <EmptyState title="제출된 답안이 없습니다." description="선택한 날짜에 수집된 제출 기록이 없습니다." />}
    <p className="admin-submission-note">일반 풀이·모의고사의 답안을 입력한 문항을 1회씩 집계합니다. 같은 문제를 다시 풀면 추가 집계하며, 비회원 기록을 계정으로 가져오는 작업은 새 제출로 세지 않습니다.</p>
    <p className="admin-submission-note">비회원 일반 풀이는 수집된 제출 이벤트 기준입니다. 추적 차단·수집 누락·보관 기간 만료로 사라진 과거 비회원 기록은 소급 집계할 수 없습니다.</p>
  </section>;
}
