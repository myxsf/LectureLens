// Reads the parts of a .pptx package that matter for reading slides:
// slide size, theme colours/fonts, and a flat list of shapes per slide.

import { unzip } from './zip.js';
import {
  attr,
  childAt,
  childrenNamed,
  findAll,
  findFirst,
  localName,
  numberAttr,
  parseXml,
  textOf,
} from './xml.js';

export const EMU_PER_POINT = 12700;
export const emuToPt = (emu) => (Number(emu) || 0) / EMU_PER_POINT;

const DEFAULT_COLORS = {
  dk1: '000000',
  lt1: 'FFFFFF',
  dk2: '44546A',
  lt2: 'E7E6E6',
  accent1: '4472C4',
  accent2: 'ED7D31',
  accent3: 'A5A5A5',
  accent4: 'FFC000',
  accent5: '5B9BD5',
  accent6: '70AD47',
  hlink: '0563C1',
  folHlink: '954F72',
};

const DEFAULT_FONTS = { major: 'Calibri Light', minor: 'Calibri' };

// Resolves a relationships part into a target path relative to its owner.
function resolveTarget(ownerPath, target) {
  if (!target) return null;
  if (target.startsWith('/')) return target.slice(1);
  const base = ownerPath.includes('/') ? ownerPath.slice(0, ownerPath.lastIndexOf('/') + 1) : '';
  const parts = (base + target).split('/');
  const stack = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function readRelationships(pkg, partPath) {
  const directory = partPath.includes('/') ? partPath.slice(0, partPath.lastIndexOf('/')) : '';
  const name = partPath.split('/').pop();
  const relsPath = `${directory}/_rels/${name}.rels`;
  const xml = pkg.text(relsPath);
  const map = new Map();
  if (!xml) return map;
  for (const rel of findAll(parseXml(xml), 'Relationship')) {
    const id = attr(rel, 'Id');
    if (!id) continue;
    map.set(id, {
      type: attr(rel, 'Type', ''),
      target: resolveTarget(partPath, attr(rel, 'Target', '')),
      mode: attr(rel, 'TargetMode', 'Internal'),
    });
  }
  return map;
}

function readTheme(pkg, themePath) {
  const colors = { ...DEFAULT_COLORS };
  const fonts = { ...DEFAULT_FONTS };
  const xml = themePath ? pkg.text(themePath) : null;
  if (!xml) return { colors, fonts };

  const root = parseXml(xml);
  const scheme = findFirst(root, 'clrScheme');
  if (scheme) {
    for (const entry of scheme.children) {
      const key = localName(entry.name);
      const srgb = findFirst(entry, 'srgbClr');
      const system = findFirst(entry, 'sysClr');
      const value = srgb ? attr(srgb, 'val') : system ? attr(system, 'lastClr') : null;
      if (value) colors[key] = value.toUpperCase();
    }
  }
  const fontScheme = findFirst(root, 'fontScheme');
  if (fontScheme) {
    const major = findFirst(childAt(fontScheme, 'majorFont') || { children: [] }, 'latin');
    const minor = findFirst(childAt(fontScheme, 'minorFont') || { children: [] }, 'latin');
    if (major && attr(major, 'typeface')) fonts.major = attr(major, 'typeface');
    if (minor && attr(minor, 'typeface')) fonts.minor = attr(minor, 'typeface');
  }
  return { colors, fonts };
}

// Returns #RRGGBB (opaque) or rgba(...) when the colour declares alpha.
function withAlpha(hex, source) {
  const alpha = source ? findFirst(source, 'alpha') : null;
  if (!alpha) return hex;
  const value = numberAttr(alpha, 'val', 100000) / 100000;
  if (value >= 0.999) return hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, value)).toFixed(3)})`;
}

function parseColor(node, theme) {
  if (!node) return null;
  const srgb = findFirst(node, 'srgbClr');
  if (srgb) return withAlpha(`#${(attr(srgb, 'val', '000000') || '000000').toUpperCase()}`, srgb);
  const scheme = findFirst(node, 'schemeClr');
  if (scheme) {
    const alias = { tx1: 'dk1', tx2: 'dk2', bg1: 'lt1', bg2: 'lt2', phClr: 'dk1' };
    const raw = attr(scheme, 'val', 'dk1');
    const key = alias[raw] || raw;
    const base = theme.colors[key] || DEFAULT_COLORS[key] || '000000';
    // Honour the common luminance tweaks so light/dark variants stay readable.
    const shade = findFirst(scheme, 'shade');
    const tint = findFirst(scheme, 'tint');
    if (shade) return withAlpha(`#${mix(base, '000000', numberAttr(shade, 'val', 100000) / 100000)}`, scheme);
    if (tint) return withAlpha(`#${mix(base, 'FFFFFF', numberAttr(tint, 'val', 0) / 100000)}`, scheme);
    return withAlpha(`#${base}`, scheme);
  }
  const preset = findFirst(node, 'prstClr');
  if (preset) {
    const name = attr(preset, 'val', 'black');
    return `#${({ black: '000000', white: 'FFFFFF', red: 'FF0000', green: '00FF00', blue: '0000FF' })[name] || '000000'}`;
  }
  return null;
}

function mix(from, to, ratio) {
  const a = [0, 2, 4].map((i) => parseInt(from.slice(i, i + 2), 16));
  const b = [0, 2, 4].map((i) => parseInt(to.slice(i, i + 2), 16));
  return a
    .map((value, index) => Math.round(value + (b[index] - value) * ratio).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

// a:bodyPr @anchor is the only common vertical setting we honour.
const anchorOf = (bodyProperties) => attr(bodyProperties, 'anchor', 't');

function readTextBody(shape, theme) {
  const body = childAt(shape, 'txBody');
  if (!body) return null;
  const bodyProperties = childAt(body, 'bodyPr');
  const listStyle = childAt(body, 'lstStyle');
  const defaultRun = findFirst(listStyle, 'defRPr');
  const defaultParagraph = findFirst(listStyle, 'defPPr');

  const paragraphs = [];
  for (const paragraph of childrenNamed(body, 'p')) {
    const paragraphProperties = childAt(paragraph, 'pPr');
    const paragraphDef = findFirst(paragraphProperties, 'defRPr');
    const base = paragraphDef || defaultParagraph || { children: [], attributes: {} };
    const runStyle = {
      size: (numberAttr(base, 'sz', numberAttr(defaultRun, 'sz', 1800)) || 1800) / 100,
      bold: attr(base, 'b') === '1',
      italic: attr(base, 'i') === '1',
      color: parseColor(childAt(base, 'solidFill'), theme) || '#000000',
      font: null,
    };
    if (!runStyle.font) {
      const latin = findFirst(base, 'latin');
      if (latin && attr(latin, 'typeface')) runStyle.font = attr(latin, 'typeface');
    }

    const runs = [];
    for (const child of paragraph.children) {
      const kind = localName(child.name);
      if (kind === 'r') {
        const properties = childAt(child, 'rPr');
        const size = (numberAttr(properties, 'sz', runStyle.size * 100) || runStyle.size * 100) / 100;
        const latin = findFirst(properties, 'latin');
        runs.push({
          text: textOf(findFirst(child, 't')) || '',
          size,
          bold: attr(properties, 'b') === undefined ? runStyle.bold : attr(properties, 'b') === '1',
          italic: attr(properties, 'i') === undefined ? runStyle.italic : attr(properties, 'i') === '1',
          color: parseColor(childAt(properties, 'solidFill'), theme) || runStyle.color,
          font: (latin && attr(latin, 'typeface')) || runStyle.font || null,
        });
      } else if (kind === 'br') {
        runs.push({ text: '\n', size: runStyle.size, bold: false, italic: false, color: runStyle.color, font: runStyle.font });
      } else if (kind === 'fld') {
        const fieldText = textOf(findFirst(child, 't'));
        if (fieldText) runs.push({ ...runStyle, text: fieldText });
      }
    }

    const bullet = childAt(paragraphProperties, 'buChar') || childAt(base, 'buChar');
    const bulletNone = childAt(paragraphProperties, 'buNone') || childAt(base, 'buNone');
    const indent = numberAttr(paragraphProperties, 'marL', numberAttr(base, 'marL', 0));
    const level = numberAttr(paragraphProperties, 'lvl', 0);

    paragraphs.push({
      runs,
      bullet: bulletNone ? '' : bullet ? attr(bullet, 'char', '•') : '',
      indentEmu: indent,
      level,
      align: attr(paragraphProperties, 'algn', attr(base, 'algn', 'l')) || 'l',
      lineSpacing: numberAttr(paragraphProperties, 'spcPct', 100000) / 100000,
      spaceAfter: numberAttr(paragraphProperties, 'spcAft', 0),
    });
  }
  return { paragraphs, anchor: anchorOf(bodyProperties), bodyProperties };
}

// <p:nvSpPr><p:nvPr><p:ph type="title" idx="1"/> marks an inherited placeholder.
function readPlaceholder(node) {
  const nv = childAt(node, 'nvSpPr') || childAt(node, 'nvPicPr') || childAt(node, 'nvGraphicFramePr');
  const properties = childAt(nv, 'nvPr');
  const placeholder = childAt(properties, 'ph');
  if (!placeholder) return null;
  const type = attr(placeholder, 'type', 'body');
  const index = attr(placeholder, 'idx');
  return { type, index: index === undefined ? null : String(index), key: `${type}#${index === undefined ? '' : index}` };
}

function readShapeTree(tree, context, out, transform) {
  for (const node of tree.children) {
    const kind = localName(node.name);
    if (kind === 'pic') {
      const picture = readPicture(node, context, transform);
      if (picture) out.push(picture);
    } else if (kind === 'sp') {
      const shape = readShape(node, context, transform);
      if (shape) out.push(shape);
    } else if (kind === 'graphicFrame') {
      const frame = readGraphicFrame(node, context, transform);
      if (frame) out.push(frame);
    } else if (kind === 'grpSp') {
      const groupTransform = readTransform(node, transform);
      const nested = childAt(node, 'grpSp');
      if (nested) readShapeTree(nested, context, out, groupTransform);
    } else if (kind === 'cxnSp') {
      const shape = readConnector(node, context, transform);
      if (shape) out.push(shape);
    }
  }
}

// Group transforms apply an additional scale/offset to child coordinates.
function readTransform(node, parent) {
  const properties = childAt(node, 'spPr') || childAt(node, 'grpSpPr') || node;
  const xfrm = findFirst(properties, 'xfrm');
  if (!xfrm) return parent || { x: 0, y: 0, scaleX: 1, scaleY: 1 };
  const offset = childAt(xfrm, 'off');
  const extent = childAt(xfrm, 'ext');
  const childOffset = childAt(xfrm, 'chOff');
  const childExtent = childAt(xfrm, 'chExt');
  const base = parent || { x: 0, y: 0, scaleX: 1, scaleY: 1 };
  const x = emuToPt(numberAttr(offset, 'x', 0));
  const y = emuToPt(numberAttr(offset, 'y', 0));
  const width = emuToPt(numberAttr(extent, 'cx', 0));
  const height = emuToPt(numberAttr(extent, 'cy', 0));
  const childX = emuToPt(numberAttr(childOffset, 'x', 0));
  const childY = emuToPt(numberAttr(childOffset, 'y', 0));
  const childWidth = emuToPt(numberAttr(childExtent, 'cx', 0)) || width;
  const childHeight = emuToPt(numberAttr(childExtent, 'cy', 0)) || height;
  const scaleX = childWidth ? width / childWidth : 1;
  const scaleY = childHeight ? height / childHeight : 1;
  return {
    x: base.x + (x - childX * scaleX) * base.scaleX,
    y: base.y + (y - childY * scaleY) * base.scaleY,
    scaleX: base.scaleX * scaleX,
    scaleY: base.scaleY * scaleY,
  };
}

function applyTransform(frame, transform) {
  const base = transform || { x: 0, y: 0, scaleX: 1, scaleY: 1 };
  return {
    x: base.x + frame.x * base.scaleX,
    y: base.y + frame.y * base.scaleY,
    width: frame.width * base.scaleX,
    height: frame.height * base.scaleY,
  };
}

function readFrame(node) {
  const xfrm = findFirst(childAt(node, 'spPr') || node, 'xfrm') || findFirst(node, 'xfrm');
  if (!xfrm) return null;
  const offset = childAt(xfrm, 'off');
  const extent = childAt(xfrm, 'ext');
  const rotation = numberAttr(xfrm, 'rot', 0) / 60000;
  const flipH = attr(xfrm, 'flipH') === '1';
  const flipV = attr(xfrm, 'flipV') === '1';
  return {
    x: emuToPt(numberAttr(offset, 'x', 0)),
    y: emuToPt(numberAttr(offset, 'y', 0)),
    width: emuToPt(numberAttr(extent, 'cx', 0)),
    height: emuToPt(numberAttr(extent, 'cy', 0)),
    rotation,
    flipH,
    flipV,
  };
}

// Freeform shapes carry their outline as a custGeom path; without it they would be
// drawn as plain rectangles, which is exactly how template artwork gets destroyed.
function readCustomGeometry(properties) {
  const custom = childAt(properties, 'custGeom');
  if (!custom) return null;
  const path = findFirst(custom, 'path');
  if (!path) return null;
  const width = numberAttr(path, 'w', 0) || 1;
  const height = numberAttr(path, 'h', 0) || 1;
  const norm = (point) => ({
    x: numberAttr(point, 'x', 0) / width,
    y: numberAttr(point, 'y', 0) / height,
  });
  // Keep the drawing commands: template artwork is mostly bezier outlines, and
  // collapsing them to straight lines destroys the shapes.
  const commands = [];
  const walk = (node) => {
    for (const child of node.children) {
      const kind = localName(child.name);
      if (kind === 'moveTo' || kind === 'lnTo') {
        const point = childAt(child, 'pt');
        if (point) commands.push({ op: kind, point: norm(point) });
      } else if (kind === 'cubicBezTo' || kind === 'quadBezTo') {
        const controls = childrenNamed(child, 'pt').map(norm);
        if (controls.length) commands.push({ op: kind, points: controls });
      } else if (kind === 'close') {
        commands.push({ op: 'close' });
      } else if (child.children.length) {
        walk(child);
      }
    }
  };
  walk(path);
  return commands.length >= 1 ? { commands, width, height } : null;
}

function readShape(node, context, transform) {
  const frame = readFrame(node);
  if (!frame) return null;
  const box = applyTransform(frame, transform);
  const properties = childAt(node, 'spPr');
  const fill = parseColor(childAt(properties, 'solidFill'), context.theme);
  const lineNode = childAt(properties, 'ln');
  // <a:ln> with no colour inherits the theme; guessing black painted black triangles
  // over template artwork, so an unspecified outline is treated as "none".
  const lineColor = lineNode ? parseColor(childAt(lineNode, 'solidFill'), context.theme) : null;
  const line =
    lineNode && lineColor
      ? { color: lineColor, width: emuToPt(numberAttr(lineNode, 'w', 12700)) || 1 }
      : null;
  const geometry = childAt(properties, 'prstGeom');
  const preset = geometry ? attr(geometry, 'val', 'rect') : null;
  const custom = readCustomGeometry(properties);
  const body = readTextBody(node, context.theme);
  return {
    type: 'shape',
    ...box,
    rotation: frame.rotation,
    preset: preset || (custom ? 'custom' : 'rect'),
    path: custom,
    fill,
    line,
    text: body,
    placeholder: readPlaceholder(node),
  };
}

function readConnector(node, context, transform) {
  const shape = readShape(node, context, transform);
  if (!shape) return null;
  return { ...shape, type: 'connector', line: shape.line || { color: '#000000', width: 1 } };
}

function readPicture(node, context, transform) {
  const frame = readFrame(node);
  if (!frame) return null;
  const box = applyTransform(frame, transform);
  const blip = findFirst(node, 'blip');
  const embedId = blip ? attr(blip, 'embed') : null;
  const rel = embedId ? context.rels.get(embedId) : null;
  return {
    type: 'image',
    ...box,
    rotation: frame.rotation,
    flipH: frame.flipH,
    flipV: frame.flipV,
    target: rel && rel.mode !== 'External' ? rel.target : null,
    placeholder: readPlaceholder(node),
  };
}

function readGraphicFrame(node, context, transform) {
  const frame = readFrame(node);
  if (!frame) return null;
  const box = applyTransform(frame, transform);
  const table = findFirst(node, 'tbl');
  if (table) return { type: 'table', ...box, rows: readTable(table, context.theme) };
  const chart = findFirst(node, 'chart');
  const diagram = findFirst(node, 'relIds');
  if (chart || diagram) {
    return { type: 'placeholder', ...box, label: chart ? '图表' : 'SmartArt' };
  }
  return { type: 'placeholder', ...box, label: '对象' };
}

function readTable(table, theme) {
  const rows = [];
  for (const row of childrenNamed(table, 'tr')) {
    const cells = [];
    for (const cell of childrenNamed(row, 'tc')) {
      const properties = childAt(cell, 'tcPr');
      const fill = parseColor(childAt(properties, 'solidFill'), theme);
      cells.push({ fill: fill || '#FFFFFF', text: readTextBody(cell, theme) });
    }
    rows.push({ cells, height: emuToPt(numberAttr(row, 'h', 0)) });
  }
  return rows;
}

// Placeholder types that exist to prompt the operator; they never render on a slide.
const PLACEHOLDER_TYPES = new Set(['title', 'ctrTitle', 'subTitle', 'body', 'obj', 'tbl', 'chart', 'dgm', 'media', 'clipArt', 'pic']);

// A part's background: solid colour, gradient stops, or an image relationship.
function readBackground(part, rels, pkg, theme) {
  // <p:bg> lives inside <p:cSld>, not directly under the part root.
  const common = childAt(part, 'cSld');
  const background = childAt(common, 'bg') || childAt(part, 'bg');
  if (!background) return null;
  const properties = childAt(background, 'bgPr') || childAt(background, 'bgRef');
  if (!properties) return null;

  // A background picture (p:bg > p:bgPr > a:blipFill) is how templates put a full-page
  // photo on a layout. Without this branch the whole design silently disappears.
  const backgroundBlip = findFirst(properties, 'blip');
  if (backgroundBlip) {
    const rel = rels.get(attr(backgroundBlip, 'embed'));
    if (rel && rel.mode !== 'External' && pkg.has(rel.target)) {
      return { kind: 'image', target: rel.target };
    }
  }

  const gradient = findFirst(properties, 'gradFill');
  if (gradient) {
    const stops = findAll(gradient, 'gs').map((stop) => ({
      position: numberAttr(stop, 'pos', 0) / 100000,
      color: parseColor(childAt(stop, 'srgbClr') ? stop : stop, theme) || '#ffffff',
    }));
    if (stops.length) {
      const angle = numberAttr(findFirst(gradient, 'lin') || gradient, 'ang', 5400000) / 60000;
      return { kind: 'gradient', stops: stops.sort((a, b) => a.position - b.position), angle };
    }
  }

  const blip = findFirst(properties, 'blip');
  if (blip) {
    const rel = rels.get(attr(blip, 'embed'));
    if (rel && rel.mode !== 'External' && pkg.has(rel.target)) {
      return { kind: 'image', target: rel.target };
    }
  }

  const solid = childAt(properties, 'solidFill');
  if (solid) {
    const color = parseColor(solid, theme);
    if (color) return { kind: 'solid', color };
  }
  return null;
}

// Shapes of one part (slide, layout or master) plus its background and rels.
function readPart(pkg, path, theme, transform) {
  const rels = readRelationships(pkg, path);
  const document = parseXml(pkg.text(path) || '');
  // <p:bg> is a child of the part's root element (p:sld / p:sldLayout / p:sldMaster),
  // and the parsed document node sits one level above it.
  const root = document.children[0] || document;
  const tree = findFirst(root, 'spTree');
  const shapes = [];
  if (tree) readShapeTree(tree, { theme, rels, pkg }, shapes, transform || { x: 0, y: 0, scaleX: 1, scaleY: 1 });
  return {
    path,
    rels,
    shapes,
    background: readBackground(root, rels, pkg, theme),
  };
}

export function parsePptx(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const pkg = unzip(bytes);

  const presentationPath = 'ppt/presentation.xml';
  const presentationDocument = parseXml(pkg.text(presentationPath) || '');
  const presentation = presentationDocument.children[0] || presentationDocument;
  const size = findFirst(presentation, 'sldSz');
  const widthPt = emuToPt(numberAttr(size, 'cx', 9144000));
  const heightPt = emuToPt(numberAttr(size, 'cy', 6858000));

  const presentationRels = readRelationships(pkg, presentationPath);
  let theme = { colors: { ...DEFAULT_COLORS }, fonts: { ...DEFAULT_FONTS } };
  for (const rel of presentationRels.values()) {
    if (rel.type.includes('theme')) {
      theme = readTheme(pkg, rel.target);
      break;
    }
  }

  const partCache = new Map();
  const readPartCached = (path) => {
    if (!path || !pkg.has(path)) return null;
    if (!partCache.has(path)) partCache.set(path, readPart(pkg, path, theme));
    return partCache.get(path);
  };

  const slideIds = findAll(presentation, 'sldId');
  const slides = [];
  for (const slideId of slideIds) {
    const relId = attr(slideId, 'r:id') || attr(slideId, 'id');
    const rel = presentationRels.get(relId);
    const slidePath = rel ? rel.target : null;
    if (!slidePath || !pkg.has(slidePath)) continue;
    const slide = readPartCached(slidePath);

    // OOXML inheritance: master shapes sit behind layout shapes, which sit behind the
    // slide's own. Placeholders a higher layer defines replace the inherited ones.
    const layoutRel = [...slide.rels.values()].find((entry) => entry.type.includes('slideLayout'));
    const layout = readPartCached(layoutRel?.target);
    const masterRel = layout ? [...layout.rels.values()].find((entry) => entry.type.includes('slideMaster')) : null;
    const master = readPartCached(masterRel?.target);

    // Placeholders the slide fills itself. Everything else inherited is decoration and
    // must NOT be drawn: layout placeholders still carry prompt text such as
    // "Click to edit Master title style", which PowerPoint never shows.
    const overridden = new Set(
      slide.shapes.filter((shape) => shape.placeholder).map((shape) => shape.placeholder.key),
    );
    const keep = (shape) => {
      if (!shape.placeholder) return true;
      if (overridden.has(shape.placeholder.key)) return false;
      return !PLACEHOLDER_TYPES.has(shape.placeholder.type);
    };
    const masterShapes = (master?.shapes || []).filter(keep);
    const layoutShapes = (layout?.shapes || []).filter(keep);
    const inherited = [...masterShapes, ...layoutShapes];
    slides.push({
      path: slidePath,
      shapes: [...inherited, ...slide.shapes],
      // The three layers must stay separate: PowerPoint paints the whole master, then
      // the whole layout, then the slide. Merging them lets a slide's own full-bleed
      // plate bury the layout artwork (photos, decoration) that should sit above it.
      layers: [
        { name: 'master', background: master?.background || null, shapes: masterShapes },
        { name: 'layout', background: layout?.background || null, shapes: layoutShapes },
        { name: 'slide', background: slide.background || null, shapes: slide.shapes },
      ],
      ownShapes: slide.shapes,
      background: slide.background || layout?.background || master?.background || null,
      rels: slide.rels,
      layoutPath: layout?.path || null,
      masterPath: master?.path || null,
      pkg,
    });
  }

  return { widthPt, heightPt, slides, theme, pkg };
}
