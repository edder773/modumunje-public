"use client";

import "./sw-curriculum.css";

import {
  type ReactNode,
  useMemo,
  useState,
} from "react";
import type { LearningField } from "@shared/study/learning-catalog";

function matchesSearchQuery(query: string, ...values: string[]) {
  const normalized = query.trim().toLocaleLowerCase("ko-KR");
  return !normalized || values.some((value) => (
    value.toLocaleLowerCase("ko-KR").includes(normalized)
  ));
}

export default function SwCurriculumSelection({
  field,
  selectionHydrated,
  selectedSubjectIds,
  questionProfileSelectionMessage,
  errorSlot,
  onSelectionChange,
}: {
  field: LearningField;
  selectionHydrated: boolean;
  selectedSubjectIds: ReadonlySet<string>;
  questionProfileSelectionMessage: string;
  errorSlot?: ReactNode;
  onSelectionChange: (subjectIds: Set<string>) => void;
}) {
  const subjectGroups = useMemo(() => field.subjectGroups ?? [], [field.subjectGroups]);
  const recommendedCombinations = useMemo(
    () => field.recommendedCombinations ?? [],
    [field.recommendedCombinations],
  );
  const allSubjectIds = useMemo(
    () => new Set(subjectGroups.flatMap((group) => group.subjects.map((subject) => subject.id))),
    [subjectGroups],
  );
  const [subjectSearch, setSubjectSearch] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [mobileCollapsedGroups, setMobileCollapsedGroups] = useState(
    () => new Set(subjectGroups.map((group) => group.id)),
  );

  const selectedSubjects = subjectGroups
    .flatMap((group) => group.subjects)
    .filter((subject) => selectedSubjectIds.has(subject.id));
  const subjectCount = allSubjectIds.size;

  function changeSelection(next: Set<string>) {
    onSelectionChange(new Set([...next].filter((id) => allSubjectIds.has(id))));
  }

  function toggleSubject(subjectId: string) {
    const next = new Set(selectedSubjectIds);
    if (next.has(subjectId)) next.delete(subjectId);
    else next.add(subjectId);
    changeSelection(next);
  }

  function toggleGroup(subjectIds: string[]) {
    const next = new Set(selectedSubjectIds);
    const selected = subjectIds.every((subjectId) => next.has(subjectId));
    for (const subjectId of subjectIds) {
      if (selected) next.delete(subjectId);
      else next.add(subjectId);
    }
    changeSelection(next);
  }

  function toggleMobileGroup(groupId: string) {
    setMobileCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function recommendationIsSelected(subjectIds: readonly string[]) {
    const availableIds = subjectIds.filter((subjectId) => allSubjectIds.has(subjectId));
    return availableIds.length === selectedSubjectIds.size
      && availableIds.every((subjectId) => selectedSubjectIds.has(subjectId));
  }

  function applyRecommendation(subjectIds: readonly string[]) {
    const availableIds = subjectIds.filter((subjectId) => allSubjectIds.has(subjectId));
    changeSelection(recommendationIsSelected(availableIds) ? new Set() : new Set(availableIds));
  }

  const visibleGroups = subjectGroups.map((group, groupIndex) => ({
    group,
    groupIndex,
    subjects: group.subjects.filter((subject) => (
      (!selectedOnly || selectedSubjectIds.has(subject.id))
      && matchesSearchQuery(subjectSearch, subject.name, subject.summary, subject.topics.join(" "))
    )),
  })).filter(({ subjects }) => subjects.length > 0);

  return (
    <>
      <section className="card sw-curriculum-intro" aria-labelledby="sw-curriculum-title">
        <div>
          <span className="section-kicker">SW 전공 학습 범위</span>
          <h2 id="sw-curriculum-title">원하는 대주제와 소주제로 학습 범위를 만드세요.</h2>
          <p>
            대주제 전체를 선택하거나 서로 다른 대주제의 소주제만 골라 하나의 학습 범위로 구성할 수 있습니다.
            필요한 내용을 직접 조합하고 다음 방문에도 같은 선택을 이어갈 수 있습니다.
          </p>
        </div>
        <dl aria-label="SW 전공 학습 범위 요약">
          <div><dt>구성</dt><dd>{subjectGroups.length}개 대주제 · {subjectCount}개 소주제</dd></div>
          <div><dt>선택 방식</dt><dd>대주제 전체 · 소주제 조합</dd></div>
          <div><dt>학습 콘텐츠</dt><dd>소주제별 이론·객관식</dd></div>
        </dl>
      </section>

      {recommendedCombinations.length > 0 && (
        <section className="sw-recommendations" aria-labelledby="sw-recommendations-title">
          <div className="sw-recommendations-heading">
            <div>
              <span className="section-kicker">추천 조합</span>
              <h2 id="sw-recommendations-title">준비 목적에 맞는 범위로 빠르게 시작하세요.</h2>
            </div>
            <p>조합을 적용한 뒤 아래에서 필요한 소주제를 자유롭게 추가하거나 해제할 수 있습니다.</p>
          </div>
          <div className="sw-recommendation-grid">
            {recommendedCombinations.map((recommendation) => {
              const selected = recommendationIsSelected(recommendation.subjectIds);
              const availableCount = recommendation.subjectIds.filter((subjectId) => allSubjectIds.has(subjectId)).length;
              const action = selected ? "조합 해제" : "이 조합 적용";
              return (
                <article className={selected ? "card sw-recommendation-card selected" : "card sw-recommendation-card"} key={recommendation.id}>
                  <span className="sw-recommendation-state">{selected ? "현재 선택한 조합" : "추천 조합"}</span>
                  <h3>{recommendation.name}</h3>
                  <p>{recommendation.summary}</p>
                  <div className="sw-recommendation-card-foot">
                    <span>{availableCount}개 소주제</span>
                    <button
                      className={selected ? "outline-button" : "primary-button"}
                      type="button"
                      aria-label={`${recommendation.name} ${action}`}
                      aria-pressed={selected}
                      onClick={() => applyRecommendation(recommendation.subjectIds)}
                    >
                      {action}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="sw-recommendations-note">채용 공고와 직무에 따라 범위가 달라질 수 있으므로 적용 후 세부 선택을 확인하세요.</p>
        </section>
      )}

      <section className="card sw-selection-summary" aria-labelledby="sw-selection-title">
        <div className="sw-selection-summary-heading">
          <div>
            <span className="section-kicker">나의 학습 범위</span>
            <h2 id="sw-selection-title">{selectionHydrated ? <>선택한 소주제 {selectedSubjects.length}개</> : "저장된 학습 범위를 확인하고 있습니다."}</h2>
          </div>
          {selectedSubjects.length > 0 && (
            <button className="text-button" type="button" onClick={() => changeSelection(new Set())}>
              전체 선택 해제
            </button>
          )}
        </div>
        {!selectionHydrated ? (
          <div className="selection-summary-skeleton" role="status">학습 범위를 불러오는 중입니다.</div>
        ) : selectedSubjects.length > 0 ? (
          <ul className="sw-selected-subjects" aria-label="선택한 소주제">
            {selectedSubjects.map((subject) => (
              <li key={subject.id}>
                <button type="button" onClick={() => toggleSubject(subject.id)} aria-label={`${subject.name} 선택 해제`}>
                  <span>{subject.name}</span><i aria-hidden="true">×</i>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sw-selection-empty">아래에서 대주제 전체 또는 필요한 소주제를 선택하세요.</p>
        )}
        <p id="sw-content-status" className="sw-content-status">
          {questionProfileSelectionMessage
            ? questionProfileSelectionMessage
            : selectedSubjects.length
              ? "학습 메뉴에서 이론, 문제 또는 문항 수를 지정한 모의고사를 시작할 수 있습니다."
              : "학습할 소주제를 하나 이상 선택한 뒤 학습 메뉴를 이용해 주세요."}
        </p>
        {errorSlot}
      </section>

      <section className="sw-range-controls" aria-label="SW 학습 범위 검색과 표시 설정">
        <label className="search-box"><span aria-hidden="true">⌕</span><input value={subjectSearch} onChange={(event) => setSubjectSearch(event.target.value)} placeholder="소주제·학습 항목 검색" aria-label="SW 소주제 검색" /></label>
        <label className="sw-selected-only"><input type="checkbox" checked={selectedOnly} onChange={(event) => setSelectedOnly(event.target.checked)} /><span>선택한 범위만 보기</span></label>
      </section>

      <div className="sw-subject-groups">
        {visibleGroups.map(({ group, groupIndex, subjects }) => {
          const groupSubjectIds = group.subjects.map((subject) => subject.id);
          const selectedInGroup = groupSubjectIds.filter((subjectId) => selectedSubjectIds.has(subjectId)).length;
          const groupIsSelected = selectedInGroup === groupSubjectIds.length;
          const mobileCollapsed = !subjectSearch.trim() && mobileCollapsedGroups.has(group.id);
          return (
            <section className="sw-subject-group" key={group.id} aria-labelledby={`${group.id}-title`} data-mobile-collapsed={mobileCollapsed || undefined}>
              <header className="sw-subject-group-heading">
                <span>대주제 {String(groupIndex + 1).padStart(2, "0")}</span>
                <div>
                  <h2 id={`${group.id}-title`}>{group.name}</h2>
                  <p>{group.summary}</p>
                </div>
                <div className="sw-group-selection">
                  <strong>{selectedInGroup}/{group.subjects.length}개 선택</strong>
                  <button className="outline-button sw-group-toggle" type="button" aria-pressed={groupIsSelected} onClick={() => toggleGroup(groupSubjectIds)}>
                    {groupIsSelected ? "대주제 선택 해제" : "대주제 전체 선택"}
                  </button>
                </div>
                <button
                  className="outline-button sw-mobile-group-toggle"
                  type="button"
                  aria-expanded={!mobileCollapsed}
                  aria-controls={`${group.id}-subjects`}
                  onClick={() => toggleMobileGroup(group.id)}
                >
                  {mobileCollapsed ? "소주제 펼치기" : "소주제 접기"}
                </button>
              </header>
              <div className="sw-subject-grid" id={`${group.id}-subjects`}>
                {subjects.map((subject) => {
                  const subjectIndex = group.subjects.findIndex((item) => item.id === subject.id);
                  const selected = selectedSubjectIds.has(subject.id);
                  return (
                    <article className={selected ? "card sw-subject-card selected" : "card sw-subject-card"} key={subject.id}>
                      <div className="sw-subject-card-title">
                        <span aria-hidden="true">{String(subjectIndex + 1).padStart(2, "0")}</span>
                        <div><small>소주제</small><h3>{subject.name}</h3></div>
                        <label className="sw-subject-select-control">
                          <input type="checkbox" checked={selected} onChange={() => toggleSubject(subject.id)} aria-label={`${subject.name} 소주제 선택`} />
                          <span>{selected ? "선택됨" : "선택"}</span>
                        </label>
                      </div>
                      <p>{subject.summary}</p>
                      <ul aria-label={`${subject.name} 주요 학습 항목`}>
                        {subject.topics.map((topic) => <li key={topic}>{topic}</li>)}
                      </ul>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      {!visibleGroups.length && (
        <section className="card empty-state">
          <span aria-hidden="true">□</span>
          <h2>조건에 맞는 소주제가 없습니다.</h2>
          <p>검색어를 바꾸거나 선택한 범위만 보기를 해제해 보세요.</p>
        </section>
      )}
    </>
  );
}
