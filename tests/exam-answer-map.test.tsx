import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExamAnswerMap, nextExamStatusIndex } from "../apps/frontend/src/features/study/components/sql/mock/exam-runner";

const items = Array.from({ length: 100 }, (_, index) => ({ id: index + 1000, answered: index < 2, flagged: index === 87 }));

test("a 100-question exam starts collapsed and only includes 20 number buttons", () => {
  const html = renderToStaticMarkup(<ExamAnswerMap items={items} currentIndex={10} onIndex={() => {}} />);
  assert.match(html, /<details class="exam-map-disclosure">/u);
  assert.equal((html.match(/aria-label="\d+번 문제,/gu) ?? []).length, 20);
  assert.match(html, /aria-label="11번 문제, 미응답" aria-current="step"/u);
  assert.match(html, /응답 2\/100 · 미응답 98 · 다시 볼 문제 1/u);
  assert.match(html, /<option value="4">81–100번<\/option>/u);
});

test("the current question opens its own range, including a short final range", () => {
  const lastPage = renderToStaticMarkup(<ExamAnswerMap items={items} currentIndex={99} onIndex={() => {}} />);
  assert.match(lastPage, /<option value="4" selected="">81–100번/u);
  assert.match(lastPage, /aria-label="100번 문제, 미응답" aria-current="step"/u);
  assert.doesNotMatch(lastPage, /aria-label="1번 문제,/u);
  const partial = renderToStaticMarkup(<ExamAnswerMap items={items.slice(0, 72)} currentIndex={71} onIndex={() => {}} />);
  assert.equal((partial.match(/aria-label="\d+번 문제,/gu) ?? []).length, 12);
  assert.match(partial, /61–72번/u);
});

test("quick navigation wraps and returns no target when the requested status is absent", () => {
  assert.equal(nextExamStatusIndex(items, 10, "unanswered"), 11);
  assert.equal(nextExamStatusIndex(items, 99, "unanswered"), 2);
  assert.equal(nextExamStatusIndex(items, 90, "flagged"), 87);
  assert.equal(nextExamStatusIndex(items.map(item => ({ ...item, answered: true, flagged: false })), 10, "unanswered"), null);
  assert.equal(nextExamStatusIndex([], 0, "flagged"), null);
});

test("all-answered and unflagged exams disable their quick navigation buttons", () => {
  const html = renderToStaticMarkup(<ExamAnswerMap items={items.map(item => ({ ...item, answered: true, flagged: false }))} currentIndex={0} onIndex={() => {}} />);
  assert.match(html, /disabled="">미응답 이동<\/button>/u);
  assert.match(html, /disabled="">다시 볼 문제 이동<\/button>/u);
});
