// Builds a real PDF from a .pptx: one page per slide, each page carries the exact
// slide image plus an invisible text layer, so text stays selectable and searchable
// and the app can attach notes to it exactly like a native PDF.

import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { layoutSlide } from './layout.js';
import { makeTextMeasurer, renderSlideToCanvas, imageMime } from './render.js';

const CJK_FONT_URL = '/api/font';
const MAX_TEXT_PIECES = 8000;

async function loadCjkFont() {
  const response = await fetch(CJK_FONT_URL);
  if (!response.ok) throw new Error('缺少内置中文字体，无法生成可选中文字的 PDF');
  return new Uint8Array(await response.arrayBuffer());
}

async function canvasToPngBytes(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('幻灯片渲染失败');
  return new Uint8Array(await blob.arrayBuffer());
}

function collectCharacters(elements) {
  const set = new Set(' 0123456789.,:;()[]{}<>/\\|-+=_%#&*@!?\'"');
  for (const element of elements) {
    if (element.kind === 'text') {
      for (const paragraph of element.paragraphs) {
        if (paragraph.bullet) for (const char of paragraph.bullet) set.add(char);
        for (const line of paragraph.lines) for (const run of line.runs) for (const char of run.text) set.add(char);
      }
    } else if (element.kind === 'table') {
      for (const row of element.rows) {
        for (const cell of row.cells) {
          for (const paragraph of cell.text?.paragraphs || []) {
            for (const run of paragraph.runs) for (const char of run.text) set.add(char);
          }
        }
      }
    }
  }
  return [...set];
}

/**
 * @param {ArrayBuffer|Uint8Array} data  raw .pptx bytes
 * @param {{ onProgress?: (done: number, total: number, label: string) => void, scale?: number, parse: Function }} options
 */
export async function buildPdfFromPptx(data, options = {}) {
  const { parse, onProgress, scale = 2 } = options;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  onProgress?.(0, 1, '解析 PPTX…');
  let deck = options.deck;
  if (!deck) {
    deck = parse(bytes);
  }
  if (!deck.slides.length) throw new Error('这份 PPTX 里没有可显示的幻灯片');

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontBytes = await loadCjkFont();

  const measure = makeTextMeasurer();
  const canvas = document.createElement('canvas');
  const report = {
    slides: deck.slides.length,
    images: 0,
    notes: 0,
    textPieces: 0,
    widthPt: deck.widthPt,
    heightPt: deck.heightPt,
  };

  // Resolve images once, so repeated pictures are not decoded twice.
  const imageCache = new Map();
  const resolveImage = async (path) => {
    if (!path) return null;
    if (imageCache.has(path)) return imageCache.get(path);
    const promise = (async () => {
      const raw = deck.pkg.bytes(path);
      if (!raw) return null;
      const mime = imageMime(path);
      const blob = new Blob([raw], { type: mime });
      const url = URL.createObjectURL(blob);
      try {
        const image = await new Promise((resolve, reject) => {
          const element = new Image();
          element.onload = () => resolve(element);
          element.onerror = () => reject(new Error(`无法读取图片 ${path}`));
          element.src = url;
        });
        return { image, raw, mime };
      } catch (error) {
        if (typeof console !== 'undefined') console.warn('[pptx-image-error]', path, error && error.message);
        return null;
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
    imageCache.set(path, promise);
    return promise;
  };

  const allElements = [];
  for (const slide of deck.slides) {
    const elements = layoutSlide(slide, deck, measure);
    for (const element of elements) {
      if (element.kind === 'background' && element.fill?.kind === 'image') {
        const resolved = await resolveImage(element.fill.target);
        element.image = resolved?.image || null;
      } else if (element.kind === 'image') {
        const resolved = await resolveImage(element.target);
        element.image = resolved?.image || null;
        element.raw = resolved?.raw || null;
        element.mime = resolved?.mime || null;
        if (element.image) report.images += 1;
        else if (typeof console !== 'undefined') {
          console.warn('[pptx-image-failed]', element.target, resolved ? 'decoded-null' : 'unresolved');
        }
      } else if (element.kind === 'note') {
        report.notes += 1;
      }
    }
    allElements.push(elements);
  }

  // A single subset font: every character used anywhere in the deck.
  const charset = collectCharacters(allElements.flat());
  onProgress?.(0, deck.slides.length, `准备字体（${charset.length} 个字符）…`);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  onProgress?.(0, deck.slides.length, '字体就绪');

  for (let index = 0; index < deck.slides.length; index += 1) {
    const elements = allElements[index];
    onProgress?.(index, deck.slides.length, `渲染第 ${index + 1} / ${deck.slides.length} 页`);
    renderSlideToCanvas(canvas, elements, deck, { scale });
    const png = await canvasToPngBytes(canvas);
    const page = pdf.addPage([deck.widthPt, deck.heightPt]);
    const background = await pdf.embedPng(png);
    page.drawImage(background, { x: 0, y: 0, width: deck.widthPt, height: deck.heightPt });

    // Invisible, selectable text at the same coordinates the canvas used.
    let pieces = 0;
    for (const element of elements) {
      if (element.kind !== 'text' || pieces > MAX_TEXT_PIECES) continue;
      const { box, paragraphs, insetLeft, startY } = element;
      let cursorY = startY;
      for (const paragraph of paragraphs) {
        for (const line of paragraph.lines) {
          let x = box.x + insetLeft + (paragraph.bulletSpace || 0);
          if (paragraph.align === 'ctr') x += (element.available - (paragraph.bulletSpace || 0) - line.width) / 2;
          else if (paragraph.align === 'r') x += element.available - (paragraph.bulletSpace || 0) - line.width;
          // PDF origin is bottom-left; the canvas draws from the top-left.
          const baseline = deck.heightPt - (cursorY + line.height * 0.8);
          if (paragraph.bullet && line === paragraph.lines[0]) {
            const first = line.runs[0];
            const size = (first ? first.size : line.size) * 0.6;
            try {
              page.drawText(paragraph.bullet, {
                x: box.x + insetLeft + 2,
                y: baseline - line.height * 0.18 - size * 0.1,
                size,
                font,
                opacity: 0,
              });
              pieces += 1;
            } catch {}
          }
          let runX = x;
          for (const run of line.runs) {
            if (run.text.trim()) {
              try {
                page.drawText(run.text, { x: runX, y: baseline, size: run.size, font, opacity: 0 });
                pieces += 1;
              } catch {
                // Characters outside the subset must never break the export.
              }
            }
            runX += run.width;
          }
          cursorY += line.height;
          if (pieces > MAX_TEXT_PIECES) break;
        }
        cursorY += paragraph.spaceAfter || 0;
      }
    }
    report.textPieces += pieces;
    onProgress?.(index + 1, deck.slides.length, `已放置第 ${index + 1} 页文字`);
  }

  onProgress?.(deck.slides.length, deck.slides.length, `打包 PDF（${report.textPieces} 段文字）…`);
  const saved = await pdf.save({ useObjectStreams: true });
  report.bytes = saved.length;
  report.charsetSize = charset.length;
  return { bytes: saved, report, deck };
}
