// Tiny namespace-aware XML reader. OOXML files only need elements, attributes and
// text, so a compact DOM of our own keeps this dependency free and works the same
// in the browser and in Node.

export function parseXml(source) {
  const text = String(source || '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner) => inner.replace(/[<>&]/g, ' '));

  const root = { name: '#document', attributes: {}, children: [], text: '' };
  const stack = [root];
  const tag = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const attribute = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  let cursor = 0;
  let match = tag.exec(text);
  while (match) {
    const between = text.slice(cursor, match.index);
    if (between.trim()) stack[stack.length - 1].text += between;
    cursor = tag.lastIndex;

    const [, closing, name, rawAttributes, selfClosing] = match;
    if (closing) {
      if (stack.length > 1 && stack[stack.length - 1].name === name) stack.pop();
    } else {
      const node = { name, attributes: {}, children: [], text: '' };
      let attr = attribute.exec(rawAttributes || '');
      while (attr) {
        node.attributes[attr[1]] = decodeEntities(attr[2] ?? attr[3] ?? '');
        attr = attribute.exec(rawAttributes || '');
      }
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
    }
    match = tag.exec(text);
  }
  return root;
}

const decodeEntities = (value) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');

export const localName = (name) => String(name).replace(/^.*:/, '');

// Depth-first search for descendants whose local name matches.
export function findAll(node, name, out = []) {
  if (!node) return out;
  for (const child of node.children) {
    if (localName(child.name) === name) out.push(child);
    findAll(child, name, out);
  }
  return out;
}

export function findFirst(node, name) {
  if (!node) return null;
  for (const child of node.children) {
    if (localName(child.name) === name) return child;
    const nested = findFirst(child, name);
    if (nested) return nested;
  }
  return null;
}

// Search only the direct children (used for group shapes and shape trees).
export function childrenNamed(node, name) {
  return node ? node.children.filter((child) => localName(child.name) === name) : [];
}

export function childAt(node, name) {
  return node ? node.children.find((child) => localName(child.name) === name) || null : null;
}

export const attr = (node, name, fallback = undefined) => {
  if (!node) return fallback;
  if (name in node.attributes) return node.attributes[name];
  const key = Object.keys(node.attributes).find((candidate) => localName(candidate) === name);
  return key === undefined ? fallback : node.attributes[key];
};

export const numberAttr = (node, name, fallback = 0) => {
  const value = attr(node, name);
  const parsed = value === undefined ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const textOf = (node) => (node ? node.text : '');
