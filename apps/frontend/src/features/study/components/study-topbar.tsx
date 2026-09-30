import type { ReactNode } from "react";

export default function StudyTopbar({
  eyebrow,
  title,
  description,
  contentUsesPrimaryHeading,
  actions,
}: {
  eyebrow: ReactNode;
  title: string;
  description?: string;
  contentUsesPrimaryHeading: boolean;
  actions: ReactNode;
}) {
  return (
    <header className="topbar">
      <div className="topbar-copy">
        <p className="eyebrow">{eyebrow}</p>
        {contentUsesPrimaryHeading
          ? <p className="topbar-title" aria-label="현재 화면">{title}</p>
          : <h1>{title}</h1>}
        {description && <p className="topbar-description">{description}</p>}
      </div>
      <div className="top-actions">{actions}</div>
    </header>
  );
}
