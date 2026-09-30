import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import toyQuestions from '../fixtures/public/toy-questions.json';
import currentPolicies from '../fixtures/public/ipe-practical-answer-policies.json';
import pastPolicies from '../fixtures/public/ipe-practical-past-answer-policies.json';
import { encodePracticalFields } from '@shared/study/practical-answer-fields';
import { gradePracticalAnswer, practicalAnswerInput } from '../apps/backend/src/modules/study/ipe-practical-grading';
import { reviewedPracticalPrompt } from '../apps/backend/src/modules/study/practical-question-presentation';
import { PRIVATE_DIAGRAMS, SKCT_PRIVATE_DIAGRAM_URLS, IPE_PRIVATE_DIAGRAM_URLS } from '../apps/backend/src/modules/private-diagrams/private-diagrams.synthetic';

test('public fixtures grade toy answers through unchanged production functions', async () => {
  assert.equal(toyQuestions.length, 2);
  for (const [index, policy] of [currentPolicies[0], pastPolicies[0]].entries()) {
    const question = toyQuestions[index];
    assert.equal(policy.id, question.id);
    assert.equal(policy.contentSha256, createHash('sha256').update(question.prompt + '\n' + question.explanation).digest('hex'));
  }
  const [current, past] = toyQuestions;
  assert.equal(practicalAnswerInput(current.id, current.examScope)?.fields?.length, 2);
  assert.equal((await gradePracticalAnswer(current, encodePracticalFields(['red', 'blue'])))?.score, 100);
  const partial = await gradePracticalAnswer(current, encodePracticalFields(['red', 'wrong']));
  assert.equal(partial?.score, 50);
  assert.equal(partial?.result, 'partial');
  assert.equal((await gradePracticalAnswer(current, encodePracticalFields(['red', 'blue', 'extra'])))?.score, 0);
  assert.equal(await gradePracticalAnswer({ ...current, prompt: current.prompt + ' changed' }, encodePracticalFields(['red', 'blue'])), null);
  assert.equal((await gradePracticalAnswer(past, 'green'))?.score, 100);
  assert.equal((await gradePracticalAnswer(past, 'purple'))?.score, 0);
  assert.match(reviewedPracticalPrompt(current.id, current.prompt) ?? '', /Toy cards/);
  assert.equal(reviewedPracticalPrompt(current.id, current.prompt + ' changed'), undefined);
});

test('public build has no private diagram registry', () => {
  assert.deepEqual(PRIVATE_DIAGRAMS, {});
  assert.deepEqual(SKCT_PRIVATE_DIAGRAM_URLS, {});
  assert.deepEqual(IPE_PRIVATE_DIAGRAM_URLS, {});
});
