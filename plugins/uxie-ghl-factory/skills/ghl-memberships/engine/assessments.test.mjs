import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeQuestions, validateQuestions, compareQuizContent } from './assessments.mjs';

// w8-6: the pure merge, the batch checks and the content comparison behind edit_quiz_questions. No account call here.
// The stored shape is what the internal GET returns: every option carries its statement, and explanation is always present.
const stored = [
  { id: 'Q1', title: 'One', questionType: 'single', sequenceNumber: 1, explanation: null, options: [
    { id: 'O1', sequence: 1, isCorrect: true, statement: 'a' }, { id: 'O2', sequence: 2, isCorrect: false, statement: 'b' }] },
  { id: 'Q2', title: 'Two', questionType: 'single', sequenceNumber: 2, explanation: 'why', options: [
    { id: 'O3', sequence: 1, isCorrect: false, statement: 'c' }, { id: 'O4', sequence: 2, isCorrect: true, statement: 'd' }] },
  { id: 'Q3', title: 'Three', questionType: 'multiple', sequenceNumber: 3, explanation: null, options: [
    { id: 'O5', sequence: 1, isCorrect: true, statement: 'e' }, { id: 'O6', sequence: 2, isCorrect: true, statement: 'f' }] },
];
const add = [
  { title: 'Four', questionType: 'single', options: [{ statement: 'x', isCorrect: true }, { statement: 'y' }] },
  { title: 'Five', questionType: 'multiple', explanation: 'both', options: [{ statement: 'p', isCorrect: true }, { statement: 'q', isCorrect: true }, { statement: 'r' }] },
];

test('w8-6: the merge keeps the stored questions in order, then the additions, numbered 1..n (review focus 2)', () => {
  const after = mergeQuestions(stored, { add: validateQuestions(add) });
  assert.equal(after.length, 5);
  assert.deepEqual(after.slice(0, 3).map((q) => q.title), ['One', 'Two', 'Three']);
  assert.deepEqual(after.slice(3).map((q) => q.title), ['Four', 'Five']);
  assert.deepEqual(after.map((q) => q.sequenceNumber), [1, 2, 3, 4, 5]);
  assert.deepEqual(after[4].options.map((o) => o.sequence), [1, 2, 3]);
  assert.equal(after[4].explanation, 'both');
  assert.equal(after[1].options[0].statement, 'c', 'the stored option text is re-posted, not dropped');
});

test('w8-6: the merge does not change the stored list it was given', () => {
  const copy = JSON.parse(JSON.stringify(stored));
  mergeQuestions(stored, { add: validateQuestions(add) });
  assert.deepEqual(stored, copy);
});

test('w8-6: a stored question whose option text cannot be read is refused by name, before anything is merged', () => {
  const unreadable = [{ ...stored[0], options: [{ sequence: 1, isCorrect: true }, { sequence: 2, isCorrect: false }] }];
  assert.throws(() => mergeQuestions(unreadable, { add: validateQuestions(add) }), /"One".*option text cannot be read/);
});

test('w8-6: a stored question with no explanation key is refused (the full content must be read, not guessed)', () => {
  const { explanation, ...noKey } = stored[0];
  assert.throws(() => mergeQuestions([noKey], { add: validateQuestions(add) }), /"One".*explanation/);
});

test('w8-6: an empty batch is refused', () => {
  assert.throws(() => validateQuestions([]), /at least one question/);
});

test('w8-6: a single-choice question needs exactly one correct option', () => {
  assert.throws(() => validateQuestions([
    { title: 'Two right?', questionType: 'single', options: [{ statement: 'a', isCorrect: true }, { statement: 'b', isCorrect: true }] },
  ]), /exactly one correct option/);
});

test('w8-6: a question needs at least two options, and a multiple-choice one at least one correct option', () => {
  assert.throws(() => validateQuestions([{ title: 'Lonely', questionType: 'single', options: [{ statement: 'a', isCorrect: true }] }]), /at least two options/);
  assert.throws(() => validateQuestions([
    { title: 'None right', questionType: 'multiple', options: [{ statement: 'a' }, { statement: 'b' }] },
  ]), /at least one correct option/);
});

test('w8-6: duplicate question text in one batch is a problem, ignoring case and spaces', () => {
  assert.throws(() => validateQuestions([
    { title: 'Capital of France?', options: [{ statement: 'Paris', isCorrect: true }, { statement: 'Rome' }] },
    { title: ' capital of france? ', options: [{ statement: 'Paris', isCorrect: true }, { statement: 'Rome' }] },
  ]), /duplicate question text/);
});

test('w8-6: a question with an empty title is refused', () => {
  assert.throws(() => validateQuestions([
    { title: '  ', options: [{ statement: 'Paris', isCorrect: true }, { statement: 'Rome' }] },
  ]), /title is empty/);
});

test('w8-6: compareQuizContent matches the expected set on content, not ids, and ignores server fields', () => {
  const expected = mergeQuestions(stored, { add: validateQuestions(add) });
  const readBack = expected.map((q, i) => ({ ...q, id: `NEW${i}`, originId: null, createdAt: '2026-11-07T00:00:00Z', options: q.options.map((o) => ({ ...o, id: `X${i}` })) }));
  const result = compareQuizContent(expected, readBack);
  assert.equal(result.match, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.unexpected, []);
});

test('w8-6: compareQuizContent finds a duplicated batch (the append case) as a mismatch', () => {
  const expected = mergeQuestions(stored, { add: validateQuestions(add) });
  const result = compareQuizContent(expected, [...expected, ...expected]);
  assert.equal(result.match, false);
  assert.equal(result.unexpected.length, 5);
});

test('w8-6: compareQuizContent reports the stored titles that did not come back, and keeps only those that did', () => {
  const expected = mergeQuestions(stored, { add: validateQuestions(add) });
  const onlyAdded = expected.slice(3);
  const result = compareQuizContent(expected, onlyAdded);
  assert.equal(result.match, false);
  assert.deepEqual(result.kept, []);
  assert.deepEqual(result.missing, ['One', 'Two', 'Three']);
});

// QA (w8-6): the content check must bite on each dimension it claims to compare. Each test changes ONE dimension of a read-back
// and expects a mismatch; dropping that dimension from quizContentKey or compareQuizContent makes the test fail.
const expectedSet = () => mergeQuestions(stored, { add: validateQuestions(add) });
const cloneSet = (set) => JSON.parse(JSON.stringify(set));

test('w8-6 content check bites on option text: one statement changed is a mismatch', () => {
  const expected = expectedSet();
  const actual = cloneSet(expected);
  actual[1].options[0].statement = 'changed';
  const result = compareQuizContent(expected, actual, { storedCount: 3 });
  assert.equal(result.match, false);
  assert.deepEqual(result.missing, ['Two']);
});

test('w8-6 content check bites on isCorrect: one flipped answer is a mismatch', () => {
  const expected = expectedSet();
  const actual = cloneSet(expected);
  actual[0].options[0].isCorrect = false;
  const result = compareQuizContent(expected, actual, { storedCount: 3 });
  assert.equal(result.match, false);
  assert.deepEqual(result.missing, ['One']);
});

test('w8-6 content check bites on explanation: one changed explanation is a mismatch', () => {
  const expected = expectedSet();
  const actual = cloneSet(expected);
  actual[1].explanation = 'a different reason';
  const result = compareQuizContent(expected, actual, { storedCount: 3 });
  assert.equal(result.match, false);
  assert.deepEqual(result.missing, ['Two']);
});

test('w8-6 content check bites on count: an extra question is a mismatch, and a shorter read is too', () => {
  const expected = expectedSet();
  const extra = cloneSet(expected);
  extra.push({ ...cloneSet(expected)[0], title: 'Zed' });
  const more = compareQuizContent(expected, extra, { storedCount: 3 });
  assert.equal(more.match, false);
  assert.deepEqual(more.unexpected, ['Zed']);
  const fewer = compareQuizContent(expected, expected.slice(0, 4), { storedCount: 3 });
  assert.equal(fewer.match, false);
  assert.deepEqual(fewer.missing, ['Five']);
});

test('w8-6 a stored question is re-posted with its explanation, and its options in sequence order with statement and correctness', () => {
  const outOfOrder = [{ ...stored[1], options: [
    { id: 'O4', sequence: 2, isCorrect: true, statement: 'd' },
    { id: 'O3', sequence: 1, isCorrect: false, statement: 'c' },
  ] }];
  const after = mergeQuestions(outOfOrder, { add: [] });
  assert.equal(after[0].explanation, 'why', 'the stored explanation is re-posted');
  assert.deepEqual(after[0].options.map((o) => o.statement), ['c', 'd'], 'options in sequence order');
  assert.deepEqual(after[0].options.map((o) => o.isCorrect), [false, true], 'correctness travels with its option');
});
