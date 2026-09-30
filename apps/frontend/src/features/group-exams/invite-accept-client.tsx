"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./group-exam.module.css";
import { groupExamApi } from "./group-exam-api";

export function InviteAcceptClient({ token }: { token: string }) {
  const [groupName, setGroupName] = useState("");
  const [publicName, setPublicName] = useState("");
  const [message, setMessage] = useState("초대를 확인하고 있습니다.");
  const [accepted, setAccepted] = useState(false);
  const [acceptKey] = useState(() => `invite-accept:${crypto.randomUUID()}`);
  useEffect(() => {
    groupExamApi<{ invite?: { groupName?: string } }>(`/api/group-exams?scope=invite&token=${encodeURIComponent(token)}`)
      .then((body) => {
        setGroupName(body.invite?.groupName ?? "그룹");
        setMessage("초대를 수락하면 그룹에 가입합니다.");
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "초대를 확인하지 못했습니다."));
  }, [token]);
  async function accept() {
    setMessage("가입을 처리하고 있습니다.");
    try {
      await groupExamApi("/api/group-exams", {
        method: "POST",
        body: JSON.stringify({ action: "invite-accept", token, publicName, idempotencyKey: acceptKey }),
      });
      setAccepted(true);
      setMessage("그룹 가입이 완료되었습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "초대를 수락하지 못했습니다.");
    }
  }
  return <main className={styles.page}><section className={styles.card} aria-labelledby="invite-title">
    <p>로그인 회원 전용 초대</p><h1 id="invite-title">{groupName || "그룹 SKCT 초대"}</h1>
    <p role="status" aria-live="polite">{message}</p>
    {!accepted && groupName && <div className={styles.stack}>
      <label>그룹에서 사용할 이름<input value={publicName} minLength={2} maxLength={40} onChange={(event) => setPublicName(event.target.value)} /></label>
      <button disabled={publicName.trim().length < 2} onClick={accept}>초대 수락</button>
    </div>}
    {accepted && <Link href="/groups">그룹 페이지로 이동</Link>}
  </section></main>;
}
