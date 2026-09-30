import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./group-exam.module.css";

const assetDescriptions: Record<string,string> = {
  "assets/P01/q02_it_budget_pies.svg": "부서별 IT 예산 비중을 비교하는 원그래프",
  "assets/P01/q04_hbm_market.svg": "HBM 시장 규모와 기업별 점유율을 비교하는 그래프",
  "assets/P06/order380_q01_weighted_average.svg": "항목별 값과 비중으로 가중평균을 구하는 자료",
  "assets/P01/q05_energy_cumulative.svg": "2025년 상반기 월별 전력·가스·스팀 누적 사용량 그래프, 단위 GWh",
  "assets/P01/q08_quarterly_sales_share.svg": "분기별 매출액과 구성 비중 그래프",
  "assets/P01/q09_production_defect.svg": "제품 생산량과 불량률을 비교하는 그래프",
  "assets/P01/q10_c_company_cumulative.svg": "C 기업의 기간별 누적 실적 그래프",
  "assets/M1_REASON_Q06_rooms.svg": "방의 위치와 연결 관계를 나타내는 배치도",
};
export function QuestionRenderer({question}:{question:Record<string,unknown>}) {
  const assets=Array.isArray(question.asset_refs_snapshot_json) ? question.asset_refs_snapshot_json as Record<string,unknown>[]:[];
  return <>
    <div className={`${styles.stimulusPanel} ${styles.markdown}`} aria-label="지문과 문제 자료">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        table:({children})=><div className={styles.dataPanel} role="region" aria-label="문항 표" tabIndex={0}><table>{children}</table></div>,
        img:()=>null,
      }}>{String(question.prompt_snapshot ?? "")}</ReactMarkdown>
    </div>
    {assets.length>0 && <div className={styles.questionAssets} aria-label="그림 자료">{assets.map(asset=>{
      const path=String(asset.path ?? "");
      if(!/^assets\/[A-Za-z0-9._/-]+[.]svg$/u.test(path) || path.includes("..") || path.includes("//")) return null;
      const authored = path.startsWith("assets/skct-personal/");
      const sha = String(asset.sha256 ?? "");
      if (authored && !/^[a-f0-9]{64}$/u.test(sha)) return null;
      const alt=assetDescriptions[path] ?? (typeof asset.alt === "string" ? asset.alt : `${String(question.area_code_snapshot)} 문항의 조건을 나타내는 도표`);
      // eslint-disable-next-line @next/next/no-img-element -- reviewed immutable SVG asset, no external or raster source.
      return <figure key={path}><img src={authored ? `/api/private-diagrams/skct/${sha}.svg` : `/${path}`} alt={alt} width={typeof asset.width === "number" ? asset.width : undefined} height={typeof asset.height === "number" ? asset.height : undefined} loading={typeof asset.width === "number" && typeof asset.height === "number" ? "lazy" : "eager"} decoding="async" /><figcaption>{alt}</figcaption></figure>;
    })}</div>}
  </>;
}
