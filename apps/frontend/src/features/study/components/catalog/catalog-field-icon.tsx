// Navigation symbols share one stroke and viewBox; no external image/font dependency.
export default function CatalogFieldIcon({ field }: { field: string }) {
  const shapes: Record<string, React.ReactNode> = {
    sql: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" /></>,
    'data-architecture': <><rect x="8" y="2" width="8" height="6" rx="1" /><rect x="2" y="16" width="7" height="6" rx="1" /><rect x="15" y="16" width="7" height="6" rx="1" /><path d="M12 8v4M5.5 16v-4h13v4" /></>,
    'big-data-analysis': <><path d="M4 3v17h17M8 15v-4M13 15V7M18 15V4" /></>,
    'information-processing': <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M10 10h4v4h-4zM9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4" /></>,
    'software-major': <><path d="m8 5-6 7 6 7m8-14 6 7-6 7m-3-16-2 20" /></>,
    'information-security': <><path d="M12 2 3 6v6c0 5 5 8 9 10 4-2 9-5 9-10V6l-9-4Z" /><path d="m8 12 3 3 5-6" /></>,
  };
  return <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[field] ?? shapes.sql}</svg>;
}
