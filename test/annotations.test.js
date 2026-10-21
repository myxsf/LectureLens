import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportAnnotatedPdf, restoreNotes, NOTE_TITLE } from '../src/lib/annotations.js';

// A tiny committed fixture keeps the suite runnable on any machine.
const FIXTURE = fileURLToPath(new URL('../assets/demo-multi.pdf', import.meta.url));

const load = async () => {
  const bytes = new Uint8Array(await readFile(FIXTURE));
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  return { bytes, doc };
};

test('saved PDF keeps every page and the original text layer', async () => {
  const { bytes, doc } = await load();
  const saved = await exportAnnotatedPdf(
    bytes,
    [{ id: 'n1', page: 2, x: 0.6, y: 0.4, text: '中文批注：α + β', color: '#18745b', size: 12 }],
    doc,
  );
  const reopened = await pdfjs.getDocument({ data: new Uint8Array(saved) }).promise;
  assert.equal(reopened.numPages, doc.numPages);
  const originalText = (await (await doc.getPage(2)).getTextContent()).items.map((i) => i.str);
  const savedText = (await (await reopened.getPage(2)).getTextContent()).items.map((i) => i.str);
  assert.deepEqual(savedText, originalText);
  await reopened.destroy();
  await doc.destroy();
});

test('notes land as visible FreeText cards when a renderer is provided', async () => {
  const { bytes, doc } = await load();
  // 1x1 transparent PNG: stands in for the canvas bitmap.
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  const renderImage = () => ({ data: png, width: 240, height: 60 });
  const saved = await exportAnnotatedPdf(
    bytes,
    [{ id: 'n1', page: 2, x: 0.35, y: 0.5, text: '回归：中文批注', color: '#18745b', size: 12, pageWidth: 900 }],
    doc,
    renderImage,
  );
  const reopened = await pdfjs.getDocument({ data: new Uint8Array(saved) }).promise;
  const annotations = await (await reopened.getPage(2)).getAnnotations();
  const note = annotations.find((a) => a.contentsObj?.str === '回归：中文批注');
  assert.ok(note, 'the note must round-trip');
  assert.equal(note.subtype, 'FreeText');
  assert.equal(note.hasAppearance, true, 'the note must render without user interaction');
  assert.equal(note.titleObj?.str, NOTE_TITLE);
  const [x0, y0, x1, y1] = note.rect;
  assert.ok(x1 - x0 > 40 && y1 - y0 > 20, 'the card must cover a readable area');
  await reopened.destroy();
  await doc.destroy();
});

test('annotation anchor survives the round trip at the selected point', async () => {
  const { bytes, doc } = await load();
  const note = { id: 'pos', page: 1, x: 0.61, y: 0.43, text: '位置校验', color: '#23343a', size: 12 };
  const saved = await exportAnnotatedPdf(bytes, [note], doc);
  const reopened = await pdfjs.getDocument({ data: new Uint8Array(saved) }).promise;
  const viewport = (await reopened.getPage(1)).getViewport({ scale: 1 });
  const restored = await restoreNotes(reopened);
  assert.equal(restored.length, 1);
  assert.ok(Math.abs(restored[0].x - note.x) < 0.005, `x drifted: ${restored[0].x}`);
  assert.ok(Math.abs(restored[0].y - note.y) < 0.005, `y drifted: ${restored[0].y}`);
  assert.equal(restored[0].text, note.text);
  assert.ok(viewport.width > 0);
  await reopened.destroy();
  await doc.destroy();
});

test('saving twice replaces this app own notes instead of stacking duplicates', async () => {
  const { bytes, doc } = await load();
  const notes = [{ id: 'dup', page: 1, x: 0.2, y: 0.2, text: '只应出现一次', color: '#23343a', size: 12 }];
  const first = await exportAnnotatedPdf(bytes, notes, doc);
  const second = await exportAnnotatedPdf(first, notes, doc);
  const reopened = await pdfjs.getDocument({ data: new Uint8Array(second) }).promise;
  const matching = (await (await reopened.getPage(1)).getAnnotations()).filter(
    (a) => a.contentsObj?.str === '只应出现一次',
  );
  assert.equal(matching.length, 1);
  await reopened.destroy();
  await doc.destroy();
});

test('a note pointing at a missing page is skipped instead of throwing', async () => {
  const { bytes, doc } = await load();
  const saved = await exportAnnotatedPdf(
    bytes,
    [{ id: 'oob', page: 999, x: 0.5, y: 0.5, text: '越界', color: '#23343a', size: 12 }],
    doc,
  );
  const reopened = await pdfjs.getDocument({ data: new Uint8Array(saved) }).promise;
  assert.equal(reopened.numPages, doc.numPages);
  await reopened.destroy();
  await doc.destroy();
});

test('restore ignores foreign and malformed annotations', async () => {
  const { bytes, doc } = await load();
  const saved = await exportAnnotatedPdf(
    bytes,
    [{ id: 'mine', page: 1, x: 0.3, y: 0.3, text: '属于本应用', color: '#23343a', size: 12 }],
    doc,
  );
  const { PDFDocument, PDFName, PDFHexString, PDFString } = await import('pdf-lib');
  const pdf = await PDFDocument.load(saved);
  const page = pdf.getPage(0);
  // A comment written by another tool, plus one with no Rect at all.
  page.node.addAnnot(
    pdf.context.register(
      pdf.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [10, 10, 28, 28],
        Contents: PDFHexString.fromText('别的工具写的'),
        T: PDFHexString.fromText('Word'),
      }),
    ),
  );
  page.node.addAnnot(
    pdf.context.register(
      pdf.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Contents: PDFHexString.fromText('缺少矩形'),
        T: PDFString.of('学习批注'),
      }),
    ),
  );
  const mangled = await pdf.save();
  const reopened = await pdfjs.getDocument({ data: new Uint8Array(mangled) }).promise;
  const restored = await restoreNotes(reopened);
  const texts = restored.map((note) => note.text);
  assert.deepEqual(texts, ['属于本应用']);
  assert.equal(restored[0].page, 1);
  assert.ok(restored[0].visible, 'restored notes start visible');
  await reopened.destroy();
  await doc.destroy();
});

test('note text is preserved exactly, including newlines and LaTeX', async () => {
  const { bytes, doc } = await load();
  const text = '第一行\n第二行 $\\alpha+\\beta$\n批注：推导见上';
  const saved = await exportAnnotatedPdf(
    bytes,
    [{ id: 'nl', page: 1, x: 0.2, y: 0.2, text, color: '#23343a', size: 12 }],
    doc,
  );
  const reopened = await pdfjs.getDocument({ data: new Uint8Array(saved) }).promise;
  const restored = await restoreNotes(reopened);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].text, text);
  await reopened.destroy();
  await doc.destroy();
});
