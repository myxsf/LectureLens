import { PDFDocument, PDFName, PDFHexString, PDFDict, PDFString, rgb } from 'pdf-lib';

export const NOTE_TITLE = '学习批注';

const hexToRgb = (hex) => {
  const parts = String(hex || '#23343a')
    .replace('#', '')
    .match(/.{2}/g) || ['23', '34', '3a'];
  return rgb(...parts.map((v) => parseInt(v, 16) / 255));
};

const dropExistingNotes = (pdf) => {
  for (const page of pdf.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i -= 1) {
      const annotation = pdf.context.lookup(annots.get(i));
      const title = annotation instanceof PDFDict ? annotation.get(PDFName.of('T')) : null;
      if ((title instanceof PDFHexString || title instanceof PDFString) && title.decodeText() === NOTE_TITLE) {
        annots.remove(i);
      }
    }
  }
};

const anchorPoint = (viewport, page, note) => {
  const width = viewport.width / (viewport.scale || 1);
  const height = viewport.height / (viewport.scale || 1);
  const [x, y] = viewport.convertToPdfPoint(
    Math.max(0, Math.min(1, note.x)) * width,
    Math.max(0, Math.min(1, note.y)) * height,
  );
  return { x, y };
};

// Writes every note as a native PDF annotation. With `renderImage` the note is a
// visible FreeText card holding the exact bitmap the browser showed; without it
// it falls back to a small comment icon that keeps the Chinese text intact.
export async function exportAnnotatedPdf(bytes, notes, sourceDocument, renderImage) {
  const pdf = await PDFDocument.load(bytes);
  dropExistingNotes(pdf);

  for (const note of notes || []) {
    if (!note || !note.page || note.page < 1 || note.page > pdf.getPageCount()) continue;
    const page = pdf.getPage(note.page - 1);
    const source = await sourceDocument.getPage(note.page);
    const viewport = source.getViewport({ scale: 1 });
    const { x, y } = anchorPoint(viewport, page, note);

    let appearance = null;
    let rect = [x, y - 18, x + 18, y];

    if (renderImage) {
      const bitmap = renderImage(note);
      const image = await pdf.embedPng(bitmap.data);
      const pageWidth = (note.pageWidth || viewport.width) * (note.pageScale || 1);
      const scale = viewport.width / pageWidth;
      const width = Math.max(24, bitmap.width * scale);
      const height = Math.max(24, bitmap.height * scale);
      const [right, bottom] = viewport.convertToPdfPoint(
        Math.max(0, Math.min(1, note.x)) * viewport.width + width,
        Math.max(0, Math.min(1, note.y)) * viewport.height + height,
      );
      rect = [Math.min(x, right), Math.min(y, bottom), Math.max(x, right), Math.max(y, bottom)];
      const w = rect[2] - rect[0];
      const h = rect[3] - rect[1];
      const form = pdf.context.flateStream(`q ${w} 0 0 ${h} 0 0 cm /NoteImage Do Q`, {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, w, h],
        Resources: { XObject: { NoteImage: image.ref } },
      });
      appearance = { N: pdf.context.register(form) };
    }

    const annotation = pdf.context.obj({
      Type: 'Annot',
      Subtype: renderImage ? 'FreeText' : 'Text',
      Rect: rect,
      Contents: PDFHexString.fromText(String(note.text || '')),
      T: PDFHexString.fromText(NOTE_TITLE),
      NM: PDFHexString.fromText(String(note.id || crypto.randomUUID())),
      M: PDFString.of(new Date().toISOString().replace(/\.\d+Z$/, 'Z')),
      Name: 'Comment',
      C: hexToRgb(note.color),
      Open: false,
      F: 4,
      ...(appearance
        ? { AP: appearance, DA: PDFString.of('/Helv 12 Tf 0 g'), Border: [0, 0, 0], IC: hexToRgb(note.color) }
        : {}),
    });
    page.node.addAnnot(pdf.context.register(annotation));
  }

  return pdf.save({ useObjectStreams: true });
}

// Reads back notes written by this app (and tolerates documents that carry
// annotations without the fields we expect).
export async function restoreNotes(pdf) {
  const found = [];
  for (let index = 0; index < pdf.numPages; index += 1) {
    let annotations = [];
    try {
      const page = await pdf.getPage(index + 1);
      annotations = await page.getAnnotations();
      const viewport = page.getViewport({ scale: 1 });
      for (const annotation of annotations) {
        if (annotation.subtype !== 'Text' && annotation.subtype !== 'FreeText') continue;
        if (annotation.titleObj?.str !== NOTE_TITLE) continue;
        if (!Array.isArray(annotation.rect) || annotation.rect.length < 4) continue;
        const [x, y] = viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[3]);
        found.push({
          id: `restored-${index}-${found.length}`,
          beside: true,
          page: index + 1,
          x: Math.max(0, Math.min(1, x / viewport.width)),
          y: Math.max(0, Math.min(1, y / viewport.height)),
          text: annotation.contentsObj?.str || '',
          color: '#23343a',
          size: 12,
          collapsed: true,
          visible: true,
          restored: true,
        });
      }
    } catch {
      // A single unreadable page must not abort the whole document.
    }
  }
  return found;
}
