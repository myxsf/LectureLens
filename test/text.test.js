import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp01, commonRunLength, draftFromAnswer, stripMarkdown } from '../src/lib/text.js';

test('draftFromAnswer keeps only the text after the 批注 marker', () => {
  const answer = '详细解释……\n\n批注：**梯度下降**沿负梯度方向更新参数。';
  assert.equal(draftFromAnswer(answer), '梯度下降沿负梯度方向更新参数。');
});

test('draftFromAnswer falls back to the head of the answer without a marker', () => {
  const draft = draftFromAnswer('这是一个没有标记的回答。');
  assert.equal(draft, '这是一个没有标记的回答。');
  assert.ok(draft.length <= 800);
});

test('draftFromAnswer trims to 800 characters and tolerates empty input', () => {
  assert.equal(draftFromAnswer('').length, 0);
  assert.equal(draftFromAnswer(`批注：${'字'.repeat(2000)}`).length, 800);
});

test('stripMarkdown flattens formatting for the notes list', () => {
  assert.equal(stripMarkdown('**粗体** 与 `代码` 和 $x^2$'), '粗体 与 代码 和 x^2');
  assert.equal(stripMarkdown('## 标题\n正文'), '标题 正文');
});

test('clamp01 keeps note anchors inside the page', () => {
  assert.equal(clamp01(-3), 0);
  assert.equal(clamp01(0.42), 0.42);
  assert.equal(clamp01(9), 1);
});

test('commonRunLength matches a hit that spans line-break formatting', () => {
  assert.equal(commonRunLength('eigenvector', 'an eigenvector keeps'), 11);
  assert.equal(commonRunLength('abc', 'xyz'), 0);
});
