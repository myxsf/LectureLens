// Renders one laid-out slide onto a canvas. Same geometry as the PDF builder, so the
// preview and the exported page look identical.

import { canvasFont } from './layout.js';

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
};

export const imageMime = (path) =>
  MIME[String(path).split('.').pop()?.toLowerCase()] || 'application/octet-stream';

export function makeTextMeasurer() {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const cache = new Map();
  return (text, size, run = {}) => {
    const key = `${size}|${run.bold ? 1 : 0}|${run.italic ? 1 : 0}|${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    context.font = canvasFont(run, size);
    const width = context.measureText(text).width;
    cache.set(key, width);
    return width;
  };
}

export function renderSlideToCanvas(canvas, elements, deck, { scale = 2 } = {}) {
  const width = deck.widthPt;
  const height = deck.heightPt;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  context.save();
  context.scale(scale, scale);
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, width, height);
  context.textBaseline = 'alphabetic';

  for (const element of elements) {
    if (!element || !element.box) continue;
    if (element.kind === 'background') {
      const { box, fill } = element;
      if (!fill) continue;
      if (fill.kind === 'image' && element.image) {
        try {
          context.drawImage(element.image, box.x, box.y, box.width, box.height);
        } catch {
          context.fillStyle = '#FFFFFF';
          context.fillRect(box.x, box.y, box.width, box.height);
        }
      } else if (fill.kind === 'gradient' && fill.stops?.length) {
        const angle = ((fill.angle || 0) * Math.PI) / 180;
        const dx = Math.cos(angle) * box.width;
        const dy = Math.sin(angle) * box.height;
        const gradient = context.createLinearGradient(
          box.x + (box.width - dx) / 2,
          box.y + (box.height + dy) / 2,
          box.x + (box.width + dx) / 2,
          box.y + (box.height - dy) / 2,
        );
        for (const stop of fill.stops) gradient.addColorStop(Math.max(0, Math.min(1, stop.position)), stop.color);
        context.fillStyle = gradient;
        context.fillRect(box.x, box.y, box.width, box.height);
      } else {
        context.fillStyle = fill.color || '#FFFFFF';
        context.fillRect(box.x, box.y, box.width, box.height);
      }
      continue;
    }
    if (element.kind === 'box') {
      const { box } = element;
      const radius = element.preset === 'roundRect' ? Math.min(10, box.height / 4) : 0;
      context.beginPath();
      if (element.path?.commands?.length) {
        // freeform outline in the shape's own 0..1 space, beziers included
        const at = (point) => [box.x + point.x * box.width, box.y + point.y * box.height];
        for (const command of element.path.commands) {
          if (command.op === 'moveTo' || command.op === 'lnTo') {
            const [px, py] = at(command.point);
            if (command.op === 'moveTo') context.moveTo(px, py);
            else context.lineTo(px, py);
          } else if (command.op === 'cubicBezTo' && command.points.length >= 3) {
            const [c1, c2, end] = command.points.map(at);
            context.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], end[0], end[1]);
          } else if (command.op === 'quadBezTo' && command.points.length >= 2) {
            const [c, end] = command.points.map(at);
            context.quadraticCurveTo(c[0], c[1], end[0], end[1]);
          } else if (command.op === 'close') {
            context.closePath();
          }
        }
      } else if (element.preset === 'ellipse') {
        context.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2);
      } else if (radius) {
        context.moveTo(box.x + radius, box.y);
        context.arcTo(box.x + box.width, box.y, box.x + box.width, box.y + box.height, radius);
        context.arcTo(box.x + box.width, box.y + box.height, box.x, box.y + box.height, radius);
        context.arcTo(box.x, box.y + box.height, box.x, box.y, radius);
        context.arcTo(box.x, box.y, box.x + box.width, box.y, radius);
      } else {
        context.rect(box.x, box.y, box.width, box.height);
      }
      if (element.fill) {
        context.fillStyle = element.fill;
        context.fill();
      }
      if (element.line) {
        context.strokeStyle = element.line.color;
        context.lineWidth = Math.min(4, element.line.width || 1);
        context.stroke();
      }
    } else if (element.kind === 'image' && element.image) {
      const { box } = element;
      try {
        context.drawImage(element.image, box.x, box.y, box.width, box.height);
      } catch {
        context.fillStyle = '#E9EEEA';
        context.fillRect(box.x, box.y, box.width, box.height);
      }
    } else if (element.kind === 'note') {
      const { box } = element;
      context.save();
      context.setLineDash([4, 3]);
      context.strokeStyle = '#B9C6BF';
      context.lineWidth = 1;
      context.strokeRect(box.x, box.y, box.width, box.height);
      context.setLineDash([]);
      context.fillStyle = '#8FA096';
      context.font = `13px ${'sans-serif'}`;
      context.fillText(`${element.label}（原文件查看）`, box.x + 8, box.y + box.height / 2);
      context.restore();
    } else if (element.kind === 'table') {
      drawTable(context, element);
    } else if (element.kind === 'text') {
      drawText(context, element);
    }
  }

  context.restore();
  return canvas;
}

function drawText(context, element) {
  const { box, paragraphs, insetLeft, startY } = element;
  let cursorY = startY;
  for (const paragraph of paragraphs) {
    for (const line of paragraph.lines) {
      let x = box.x + insetLeft + (paragraph.bulletSpace || 0);
      if (paragraph.align === 'ctr') x += (element.available - (paragraph.bulletSpace || 0) - line.width) / 2;
      else if (paragraph.align === 'r') x += element.available - (paragraph.bulletSpace || 0) - line.width;
      const baseline = cursorY + line.height * 0.8;
      if (paragraph.bullet && line === paragraph.lines[0]) {
        const first = line.runs[0];
        const bulletSize0 = (first ? first.size : line.size) * 0.6;
        context.font = canvasFont({ ...(first || {}), size: bulletSize0 }, bulletSize0);
        context.fillStyle = first ? first.color : '#333333';
        // bullets are square glyphs; centre them on the line instead of sitting on the baseline
        const bulletSize = (first ? first.size : line.size) * 0.6;
        context.fillText(paragraph.bullet, box.x + insetLeft + 2, baseline - line.height * 0.18 - bulletSize * 0.1);
      }
      for (const run of line.runs) {
        context.font = canvasFont(run, run.size);
        context.fillStyle = run.color || '#000000';
        context.fillText(run.text, x, baseline);
        x += run.width;
      }
      cursorY += line.height;
    }
    cursorY += paragraph.spaceAfter || 0;
  }
}

function drawTable(context, element) {
  const { box, rows } = element;
  const totalHeight = rows.reduce((sum, row) => sum + (row.height || 24), 0) || box.height;
  let y = box.y;
  rows.forEach((row) => {
    const rowHeight = row.height || totalHeight / rows.length;
    const cellWidth = box.width / Math.max(1, row.cells.length);
    row.cells.forEach((cell, index) => {
      const x = box.x + index * cellWidth;
      context.fillStyle = cell.fill || '#FFFFFF';
      context.fillRect(x, y, cellWidth, rowHeight);
      context.strokeStyle = '#C9D2CC';
      context.lineWidth = 0.75;
      context.strokeRect(x, y, cellWidth, rowHeight);
      const text = (cell.text?.paragraphs || [])
        .map((p) => p.runs.map((r) => r.text).join(''))
        .filter(Boolean)
        .join(' ');
      if (text) {
        const run = cell.text?.paragraphs?.[0]?.runs?.[0] || { size: 12, color: '#000000' };
        context.font = canvasFont(run, Math.min(run.size, 14));
        context.fillStyle = run.color || '#000000';
        context.fillText(text.slice(0, 40), x + 4, y + rowHeight / 2 + 4);
      }
    });
    y += rowHeight;
  });
}
