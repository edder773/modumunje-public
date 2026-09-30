export type AdminPerformanceData = {
  webVitals: Array<{
    metricName: string;
    samples: number;
    average: number;
    p50: number;
    p75: number;
    p95: number;
  }>;
  apiTimings: Array<{
    route: string;
    status: number;
    retryCount: number;
    cacheSource: string;
    samples: number;
    averageDurationMs: number;
    maximumDurationMs: number;
  }>;
};

export type AdminRetentionData = {
  retentionDays: number;
  oldestEventAt: string | null;
  expiredRowCount: number;
  lastCleanupAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
};

export default function AdminPerformanceCard({
  performance,
  retention,
}: {
  performance: AdminPerformanceData;
  retention: AdminRetentionData;
}) {
  return (
    <section className="admin-card admin-padded-card admin-performance-card">
      <div className="admin-card-head">
        <div><span>REAL USER MONITORING</span><h3>실사용 성능</h3><p>익명 표본으로 집계한 웹 지표와 API 응답 시간입니다.</p></div>
      </div>
      <p>
        분석 보관 {retention.retentionDays}일 · 만료 대기 {retention.expiredRowCount.toLocaleString("ko-KR")}건 ·
        마지막 정리 {retention.lastCleanupAt ? new Date(retention.lastCleanupAt).toLocaleString("ko-KR") : "실행 전"}
      </p>
      {performance.webVitals.length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table"><thead><tr><th>지표</th><th>표본</th><th>P50</th><th>P75</th><th>P95</th></tr></thead><tbody>
            {performance.webVitals.map((metric) => (
              <tr key={metric.metricName}><td>{metric.metricName}</td><td>{metric.samples}</td><td>{metric.p50.toFixed(1)}</td><td>{metric.p75.toFixed(1)}</td><td>{metric.p95.toFixed(1)}</td></tr>
            ))}
          </tbody></table>
        </div>
      ) : <p>선택 기간에 수집된 실사용 성능 표본이 없습니다.</p>}
      {performance.apiTimings.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table"><thead><tr><th>API</th><th>상태</th><th>재시도</th><th>캐시</th><th>표본</th><th>평균</th><th>최대</th></tr></thead><tbody>
            {performance.apiTimings.map((timing) => (
              <tr key={`${timing.route}:${timing.status}:${timing.retryCount}:${timing.cacheSource}`}>
                <td>{timing.route}</td><td>{timing.status || "-"}</td><td>{timing.retryCount}</td><td>{timing.cacheSource}</td>
                <td>{timing.samples}</td><td>{timing.averageDurationMs.toFixed(1)}ms</td><td>{timing.maximumDurationMs.toFixed(1)}ms</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </section>
  );
}
