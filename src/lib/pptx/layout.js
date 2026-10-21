// Turns parsed shapes into absolutely positioned, wrapped text lines. Layout is
// computed once per slide and then used by both the canvas preview and the PDF, so
// the on-screen page and the exported page agree pixel for pixel.

const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;
const LATIN = /[0-9A-Za-z\u00c0-\u024f]/;

const FONT_STACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", -apple-system, "Segoe UI", sans-serif';

export const canvasFont = (run, size) =>
  `${run.italic ? 'italic ' : ''}${run.bold ? '600 ' : ''}${size}px ${FONT_STACK}`;

// Splits a run into breakable pieces: latin words stay whole, CJK breaks anywhere.
function tokenize(value) {
  const tokens = [];
  let current = '';
  for (const char of value) {
    if (CJK.test(char)) {
      if (current) tokens.push(current);
      tokens.push(char);
      current = '';
    } else if (/\s/.test(char)) {
      if (current) tokens.push(current);
      tokens.push(' ');
      current = '';
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function wrapRuns(runs, measure, maxWidth) {
  const lines = [];
  let line = { runs: [], width: 0 };
  const pushLine = () => {
    lines.push(line);
    line = { runs: [], width: 0 };
  };

  const append = (run, text, width) => {
    const last = line.runs[line.runs.length - 1];
    if (last && last.size === run.size && last.color === run.color && last.bold === run.bold && last.italic === run.italic) {
      last.text += text;
      last.width += width;
    } else {
      line.runs.push({ ...run, text, width });
    }
    line.width += width;
  };

  for (const run of runs) {
    if (run.text === '\n') {
      pushLine();
      continue;
    }
    for (const token of tokenize(run.text)) {
      const width = measure(token, run.size);
      const isSpace = token === ' ';
      if (line.width + width > maxWidth && line.width > 0 && !isSpace) {
        pushLine();
        if (isSpace) continue;
      }
      if (isSpace && line.width === 0) continue;
      append(run, token, width);
    }
  }
  pushLine();
  return lines;
}

export function layoutSlide(slide, deck, measure) {
  // The returned array is in paint order: backdrops first, then everything else.
  const elements = [];
  const pageWidth = deck.widthPt;
  const pageHeight = deck.heightPt;

  const boxOf = (shape) => ({ x: shape.x, y: shape.y, width: shape.width, height: shape.height });

  // A full-bleed shape sitting on the master or layout is the page background: it has
  // to be painted first, otherwise it buries the slide's own text.
  // Geometry lives in shape.box (shapes carry x/y/width/height at the top level too,
  // but box is the normalised copy we rely on everywhere else).
  // Parsed shapes carry x/y/width/height directly (layout elements get a box copy).
  const coversPage = (shape) =>
    shape.width >= pageWidth * 0.98 &&
    shape.height >= pageHeight * 0.98 &&
    shape.x <= pageWidth * 0.02;
  // A full-bleed plate inside one layer is that layer's own backdrop. It is painted
  // before the layer's other shapes but never before earlier layers.
  const full = (shape) =>
    (shape.width || 0) >= pageWidth * 0.85 &&
    (shape.height || 0) >= pageHeight * 0.85 &&
    (shape.x || 0) <= pageWidth * 0.08;
  const isPlate = (shape) =>
    !shape.placeholder &&
    shape.type !== 'placeholder' &&
    full(shape) &&
    (!shape.line || (shape.line.width || 1) <= 1.25);

  const layers = slide.layers?.length
    ? slide.layers
    : [{ name: 'slide', background: slide.background || null, shapes: slide.shapes }];
  slide.backgroundLayers = [];

  // Page-wide backdrop from p:bg (solid / gradient / image), painted first of all.
  if (slide.background) {
    elements.push({
      kind: 'background',
      box: { x: 0, y: 0, width: pageWidth, height: pageHeight },
      fill: slide.background,
    });
  }

  // Paint order, layer by layer:
  //   master → layout → slide, and inside each layer a full-bleed plate is painted
  //   before that layer's other shapes. This mirrors what the slides show: a template
  //   backdrop (a photo or a tinted wave) sits under the layer's own content, and the
  //   slide's content sits above everything inherited.
  const plates = [];
  for (const [index, layer] of layers.entries()) {
    if (layer.background) {
      elements.push({
        kind: 'background',
        box: { x: 0, y: 0, width: pageWidth, height: pageHeight },
        fill: layer.background,
      });
    }
    for (const shape of layer.shapes || []) {
      if (isPlate(shape) && !shape.placeholder) plates.push(shape);
    }
  }

  // slide order matters: master plates, master content, layout plates, layout content,
  // slide plates, slide content
  for (const [index, layer] of layers.entries()) {
    for (const shape of layer.shapes || []) {
      if (isPlate(shape) && !shape.placeholder) emitShape(shape, true);
    }
    for (const shape of layer.shapes || []) {
      if (isPlate(shape) && !shape.placeholder) continue;
      emitShape(shape, false);
    }
  }
  slide.backgroundLayers = plates;

  // One shape's paint ops: image, placeholder note, table, box, then its text.
  function emitShape(shape, isBackdrop) {
    if (shape.type === 'image') {
      elements.push({ kind: 'image', box: boxOf(shape), backdrop: isBackdrop, ...shape });
      return;
    }
    if (shape.type === 'placeholder') {
      elements.push({ kind: 'note', box: boxOf(shape), label: shape.label });
      return;
    }
    if (shape.type === 'table') {
      elements.push({ kind: 'table', box: boxOf(shape), rows: shape.rows });
      return;
    }
    const fill = shape.fill || null;
    if (fill || shape.line || shape.path) {
      elements.push({
        kind: 'box',
        box: boxOf(shape),
        backdrop: isBackdrop,
        fill,
        line: shape.line,
        preset: shape.preset,
        path: shape.path,
      });
    }
    if (!shape.text || !shape.text.paragraphs.some((p) => p.runs.some((r) => r.text.trim()))) return;
    emitText(shape);
  }

  // Text of one shape, laid out into positioned lines.
  function emitText(shape) {
    const insetLeft = 9.6; // default 0.1" text insets
    const insetRight = 9.6;
    const insetTop = 4.8;
    const insetBottom = 4.8;
    const available = Math.max(12, shape.width - insetLeft - insetRight);

    const paragraphs = [];
    for (const paragraph of shape.text.paragraphs) {
      const indent = paragraph.indentEmu ? paragraph.indentEmu / 12700 : 0;
      const bullet = paragraph.bullet || '';
      const bulletSpace = bullet ? Math.max(12, indent || 14) : 0;
      const runs = paragraph.runs.filter((run) => run.text !== '');
      if (!runs.length) {
        paragraphs.push({ lines: [{ runs: [], width: 0 }], height: 0, spaceAfter: paragraph.spaceAfter || 0, indent, bullet: '' });
        continue;
      }
      const lines = wrapRuns(runs, measure, available - bulletSpace);
      const lineHeightFactor = Math.min(2, Math.max(1, paragraph.lineSpacing || 1)) * 1.22;
      let height = 0;
      for (const line of lines) {
        const size = Math.max(...line.runs.map((run) => run.size), 12);
        line.size = size;
        line.height = size * lineHeightFactor;
        height += line.height;
      }
      paragraphs.push({
        lines,
        height,
        spaceAfter: paragraph.spaceAfter ? paragraph.spaceAfter / 12700 : 0,
        indent,
        bullet,
        bulletSpace,
        align: paragraph.align,
      });
    }

    const totalHeight = paragraphs.reduce((sum, p) => sum + p.height + p.spaceAfter, 0);
    let cursorY = shape.y + insetTop;
    const anchor = shape.text.anchor || 't';
    if (anchor === 'ctr') cursorY = shape.y + (shape.height - totalHeight) / 2;
    else if (anchor === 'b') cursorY = shape.y + shape.height - insetBottom - totalHeight;

    elements.push({
      kind: 'text',
      box: boxOf(shape),
      paragraphs,
      startY: cursorY,
      insetLeft,
      available,
      totalHeight,
    });
  }

  return elements;
}

export function fontScaleFor(runSize, slideWidth, targetWidth) {
  return (runSize / slideWidth) * targetWidth;
}
