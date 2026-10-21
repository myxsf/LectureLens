import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parsePptx } from '../src/lib/pptx/parse.js';
import { layoutSlide } from '../src/lib/pptx/layout.js';
import { unzip } from '../src/lib/pptx/zip.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/deck.pptx', import.meta.url));

// Headless text measurement: widths only need to be plausible for layout tests.
const measure = (text, size) => [...text].reduce((sum, char) => sum + (/[\u4e00-\u9fff]/.test(char) ? size : size * 0.55), 0);

test('pptx package is read: slide size, theme and shapes', async () => {
  const bytes = new Uint8Array(await readFile(FIXTURE));
  const deck = parsePptx(bytes);
  assert.equal(deck.slides.length, 2);
  assert.equal(Math.round(deck.widthPt), 720);
  assert.equal(Math.round(deck.heightPt), 540);
  assert.equal(deck.theme.colors.accent1, '1F5C46');
  const shapes = deck.slides[0].shapes;
  assert.ok(shapes.some((s) => s.text?.paragraphs?.some((p) => p.runs.some((r) => r.text.includes('Eigenvalues')))));
  assert.ok(shapes.some((s) => s.fill === '#E7F1EC'));
});

test('images resolve through slide relationships', async () => {
  const deck = parsePptx(new Uint8Array(await readFile(FIXTURE)));
  const picture = deck.slides[1].shapes.find((s) => s.type === 'image');
  assert.ok(picture, 'slide 2 must carry an image');
  assert.equal(picture.target, 'ppt/media/image1.png');
  assert.ok(deck.pkg.bytes(picture.target).length > 0);
});

test('layout wraps text, keeps bullets and reports real geometry', async () => {
  const deck = parsePptx(new Uint8Array(await readFile(FIXTURE)));
  const elements = layoutSlide(deck.slides[0], deck, measure);
  const text = elements.find((e) => e.kind === 'text' && e.paragraphs.some((p) => p.bullet));
  assert.ok(text, 'a bulleted text block must exist');
  assert.ok(text.box.width > 0 && text.box.height > 0);
  const bullets = text.paragraphs.filter((p) => p.bullet);
  assert.ok(bullets.length >= 2);
  for (const paragraph of bullets) {
    assert.ok(paragraph.lines.length >= 1, 'each paragraph must produce at least one line');
    assert.ok(paragraph.lines.every((line) => line.height > 0));
  }
  const chinese = text.paragraphs.find((p) => p.lines.some((l) => l.runs.some((r) => /[\u4e00-\u9fff]/.test(r.text))));
  assert.ok(chinese, 'the Chinese paragraph must survive layout');
});

test('every laid-out element carries a box, whatever its kind', async () => {
  const deck = parsePptx(new Uint8Array(await readFile(FIXTURE)));
  for (const slide of deck.slides) {
    for (const element of layoutSlide(slide, deck, measure)) {
      assert.ok(element.box, `element ${element.kind} is missing its box`);
      for (const key of ['x', 'y', 'width', 'height']) {
        assert.equal(typeof element.box[key], 'number', `${element.kind}.${key} must be a number`);
      }
    }
  }
});

test('zip reader rejects a non-package instead of returning junk', () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.throws(() => unzip(bytes), /ZIP|PPTX/);
});
