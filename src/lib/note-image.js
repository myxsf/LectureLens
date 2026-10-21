// Rasterises a note exactly as the browser showed it, so the saved PDF matches
// the screen. Canvas fonts resolve the same Chinese glyphs without embedding a
// multi-megabyte TTF into every exported document.
const PADDING_X = 14;
const HEADER = 20;

export function renderNoteImage(note) {
  const width = Math.max(180, Math.round(note.width || 240));
  const size = note.size || 12;
  const lineHeight = size * 1.55;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `${size}px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", -apple-system, sans-serif`;
  ctx.font = font;

  const lines = [];
  let line = '';
  for (const char of String(note.text || '')) {
    if (char === '\n') {
      lines.push(line);
      line = '';
      continue;
    }
    if (ctx.measureText(line + char).width > width - PADDING_X * 2) {
      lines.push(line);
      line = '';
    }
    line += char;
  }
  lines.push(line);

  const height = Math.max(note.height || 0, HEADER + lines.length * lineHeight + PADDING_X);
  const ratio = 2;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.scale(ratio, ratio);

  ctx.fillStyle = '#fff6cf';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#ecd98d';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  ctx.fillStyle = '#8a7440';
  ctx.font = '600 10px "PingFang SC", -apple-system, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('学习批注', PADDING_X, 7);
  ctx.fillStyle = note.color || '#23343a';
  ctx.font = font;
  lines.forEach((text, index) => {
    ctx.fillText(text, PADDING_X, HEADER + 4 + index * lineHeight);
  });

  return {
    data: canvas.toDataURL('image/png'),
    width,
    height,
    lines: lines.length,
  };
}
