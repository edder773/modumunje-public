"use client";

import { useId } from "react";
import { encodePracticalFields, practicalFieldValues, type PracticalAnswerInput } from "@shared/study/practical-answer-fields";

export function PracticalAnswerFields({ input, value, onChange, disabled, id, describedBy }: {
  input?: PracticalAnswerInput;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  describedBy?: string;
}) {
  const generatedId = useId();
  const controlId = id ?? `practical-answer-${generatedId}`;
  if (!input?.fields?.length) return <textarea id={controlId} aria-label="내 답안" aria-describedby={describedBy}
    className="exam-descriptive-answer" value={value} onChange={event => onChange(event.target.value)}
    rows={input?.multiline ? 5 : 2} maxLength={4000} placeholder="정답을 입력하세요." autoCapitalize="off" autoCorrect="off" spellCheck={false} disabled={disabled} />;
  const fields = practicalFieldValues(value, input);
  return <fieldset className="practical-answer-fields" aria-describedby={describedBy} disabled={disabled}>
    <legend>답안 {input.fields.length}개 · 항목당 5/{input.fields.length}점</legend>
    {input.fields.map((field, i) => <label key={i} htmlFor={`${controlId}-${i}`}>
      <span>{field.label}</span>
      <input id={`${controlId}-${i}`} type="text" value={fields[i]}
        maxLength={Math.max(fields[i].length, 4000 - fields.reduce((sum, item, index) => sum + (index === i ? 0 : item.length), 0))}
        onChange={event => onChange(encodePracticalFields(fields.map((item, index) => index === i ? event.target.value : item)))}
        placeholder={`${field.label} 입력`} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
    </label>)}
  </fieldset>;
}
