"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import styles from "./group-exam.module.css";

export function GroupExamModal({
  title,
  children,
  onClose,
  closeDisabled = false,
  initialFocus,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  initialFocus?: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  const titleId = useId();

  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => { closeDisabledRef.current = closeDisabled; }, [closeDisabled]);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const dialog = dialogRef.current;
    const inerted: Array<{element: HTMLElement; wasInert: boolean}> = [];
    let branch: HTMLElement | null = dialog?.parentElement ?? null;
    while (branch?.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          inerted.push({element: sibling, wasInert: sibling.inert}); sibling.inert = true;
        }
      }
      branch = branch.parentElement;
    }
    document.body.style.overflow = "hidden";
    dialog?.querySelector<HTMLElement>(initialFocus??"[data-group-modal-close]")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !closeDisabledRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
      )).filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      for (const {element, wasInert} of inerted) element.inert = wasInert;
      previousFocus?.focus();
    };
  }, [initialFocus]);

  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !closeDisabled) onClose();
  }}>
    <section ref={dialogRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header><h3 id={titleId}>{title}</h3><button data-group-modal-close type="button" className={styles.iconButton} aria-label={`${title} 닫기`} disabled={closeDisabled} onClick={onClose}>×</button></header>
      <div className={styles.modalContent}>{children}</div>
    </section>
  </div>;
}
