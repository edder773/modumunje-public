"use client";

import { type FormEvent, useState } from "react";
import { submitUserReport } from "../../../model/user-report-client";
import Modal from "../../modal";

export function UserReportModal({
  mode,
  questionId,
  onClose,
  onSubmitted,
}: {
  mode: "general" | "question";
  questionId?: number;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const questionReport = mode === "question" && Boolean(questionId);
  const [category, setCategory] = useState(questionReport ? "content" : "bug");
  const [title, setTitle] = useState(questionReport ? "현재 문제 내용 오류" : "");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await submitUserReport({ category, title, description, questionId });
      onSubmitted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "제보를 저장하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={questionReport ? "문제 오류 신고" : "버그·개선 사항 제보"} onClose={onClose}>
      <form className="user-report-form" onSubmit={submit}>
        <p>{questionReport
          ? "현재 보고 있는 문제를 함께 전송합니다. 잘못된 본문·선택지·정답·해설을 알려 주세요."
          : "발견한 문제나 개선 아이디어를 운영자에게 전달합니다."}</p>
        <label>
          제보 유형
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="bug">버그</option>
            <option value="improvement">개선 제안</option>
            <option value="content">문제·이론 내용 오류</option>
          </select>
        </label>
        <label>
          제목
          <input value={title} onChange={(event) => setTitle(event.target.value)} minLength={4} maxLength={120} required />
          <small className="report-field-help">최소 4자 · {title.trim().length}/120자</small>
        </label>
        <label>
          상세 내용
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={7}
            minLength={10}
            maxLength={4000}
            placeholder="발생한 상황과 기대한 동작을 적어 주세요."
            required
          />
          <small className="report-field-help">최소 10자 · {description.trim().length}/4000자</small>
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions user-report-actions">
          <button className="outline-button" type="button" onClick={onClose}>취소</button>
          <button className="primary-button" disabled={submitting || title.trim().length < 4 || description.trim().length < 10}>
            {submitting ? "접수 중…" : "제보 접수"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default UserReportModal;
