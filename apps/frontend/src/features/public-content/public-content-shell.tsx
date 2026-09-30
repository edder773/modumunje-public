import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./public-content.module.css";

export function PublicContentShell({
  eyebrow,
  title,
  description,
  children,
  showIntroduction = true,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  showIntroduction?: boolean;
}) {
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#public-content">본문으로 건너뛰기</a>
      <header className={styles.siteHeader}>
        <Link className={styles.brand} href="/" aria-label="모두의 문제집 홈">
          <span className={styles.brandMark} aria-hidden="true" />
          <span><strong>모두의 문제집</strong><small>자격증·전공 학습</small></span>
        </Link>
        <nav className={styles.navigation} aria-label="공개 정보">
          <Link href="/guides">학습 가이드</Link>
          <Link href="/about">서비스 소개</Link>
          <Link href="/privacy">개인정보처리방침</Link>
          <Link className={styles.learningLink} href="/">학습 시작</Link>
        </nav>
      </header>

      <main className={styles.main} id="public-content" tabIndex={-1}>
        {showIntroduction && <header className={styles.hero}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1>{title}</h1>
          <p className={styles.lead}>{description}</p>
        </header>}
        {children}
      </main>

      <footer className={styles.footer}>
        <p>모두의 문제집은 학습을 돕는 독립적인 서비스이며 자격시험 시행기관의 공식 사이트가 아닙니다.</p>
        <nav aria-label="하단 메뉴">
          <Link href="/">홈</Link>
          <Link href="/guides">학습 가이드</Link>
          <Link href="/about">서비스 소개</Link>
          <Link href="/privacy">개인정보처리방침</Link>
        </nav>
      </footer>
    </div>
  );
}

export { styles as publicContentStyles };
