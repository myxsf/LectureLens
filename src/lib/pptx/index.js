// Public entry point of the built-in PowerPoint reader. It renders a .pptx into a
// real PDF in the browser, so no LibreOffice or conversion service is needed.
//
// Fidelity note: text, colours, bullets, simple shapes, images and tables are drawn;
// charts, SmartArt and animation are reported as unsupported instead of being faked.

import { parsePptx } from './parse.js';
import { buildPdfFromPptx } from './build.js';
import { layoutSlide } from './layout.js';
import { makeTextMeasurer, renderSlideToCanvas } from './render.js';

export { parsePptx, buildPdfFromPptx, layoutSlide, makeTextMeasurer, renderSlideToCanvas };

export const PPTX_EXTENSIONS = ['.pptx', '.ppt', '.odp'];

export const isPptxFile = (name) => /\.pptx$/i.test(name || '');

/**
 * Converts a .pptx into a PDF plus an honest report about what could not be drawn.
 */
export async function pptxToPdf(bytes, { onProgress } = {}) {
  // Parse once and reuse the deck for both layout and the fidelity report.
  const deck = parsePptx(bytes);
  const { bytes: pdfBytes, report } = await buildPdfFromPptx(bytes, {
    parse: parsePptx,
    deck,
    onProgress,
  });

  // Count anything the renderer can only indicate, not reproduce.
  const unsupported = { charts: 0, smartArt: 0, objects: 0, tables: 0 };
  for (const slide of deck.slides) {
    for (const shape of slide.shapes) {
      if (shape.type === 'placeholder') {
        if (shape.label === '图表') unsupported.charts += 1;
        else if (shape.label === 'SmartArt') unsupported.smartArt += 1;
        else unsupported.objects += 1;
      } else if (shape.type === 'table') unsupported.tables += 1;
    }
  }

  return {
    bytes: pdfBytes,
    report: {
      ...report,
      slides: deck.slides.length,
      widthPt: deck.widthPt,
      heightPt: deck.heightPt,
      unsupported,
    },
  };
}
