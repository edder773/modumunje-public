"use client";

import {
  lazy,
  Suspense,
  useEffect,
  useState,
} from "react";

const UserReportModal = lazy(() => import("../sql/reports/user-report-modal"));

export default function CatalogReportAction() {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    <>
      <button className="top-report-button" type="button" onClick={() => setOpen(true)}>
        버그·개선 제보
      </button>
      {open && (
        <Suspense fallback={null}>
          <UserReportModal
            mode="general"
            onClose={() => setOpen(false)}
            onSubmitted={() => {
              setOpen(false);
              setNotice("제보가 접수되었습니다. 관리자 화면에서 확인하겠습니다.");
            }}
          />
        </Suspense>
      )}
      {notice && <div className="toast" role="status"><span>{notice}</span></div>}
    </>
  );
}
