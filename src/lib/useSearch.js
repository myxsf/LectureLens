import { useEffect, useRef, useState } from 'react';

// Finds query hits by reading each page's text content, then lets the app scroll
// to the hit. Highlighting uses the rendered text layer via the Selection API.
export function useSearch(doc, query) {
  const [matches, setMatches] = useState([]);
  const [active, setActive] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const current = (generation.current += 1);
    setActive(0);
    const needle = query.trim();
    if (!doc || needle.length < 2) {
      setMatches([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const results = [];
      const lowered = needle.toLowerCase();
      for (let page = 1; page <= doc.numPages && !cancelled; page += 1) {
        let text = '';
        try {
          const content = await (await doc.getPage(page)).getTextContent();
          text = content.items.map((item) => item.str).join(' ');
        } catch {
          continue;
        }
        const flat = text.replace(/\s+/g, ' ');
        let index = flat.toLowerCase().indexOf(lowered);
        while (index !== -1) {
          results.push({
            page,
            snippet: flat.slice(Math.max(0, index - 26), index + needle.length + 30).trim(),
          });
          index = flat.toLowerCase().indexOf(lowered, index + needle.length);
        }
      }
      if (cancelled || current !== generation.current) return;
      setMatches(results.slice(0, 300));
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, query]);

  const step = (delta) => {
    setActive((value) => {
      if (!matches.length) return 0;
      return (value + delta + matches.length) % matches.length;
    });
  };

  return {
    matches,
    active,
    total: matches.length,
    current: matches[active] || null,
    next: () => step(1),
    previous: () => step(-1),
    setActive,
  };
}

// Selects the Nth occurrence of `query` inside a mounted text layer.
export function highlightInLayer(page, query, occurrence) {
  const layer = document.querySelector(`[data-page="${page}"] .textLayer`);
  if (!layer) return false;
  const needle = query.trim().toLowerCase();
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  const ranges = [];
  let node = walker.nextNode();
  while (node) {
    const text = (node.nodeValue || '').toLowerCase();
    let from = text.indexOf(needle);
    while (from !== -1) {
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, from + needle.length);
      ranges.push(range);
      from = text.indexOf(needle, from + Math.max(1, needle.length));
    }
    node = walker.nextNode();
  }
  const range = ranges[occurrence] || ranges[0];
  if (!range) return false;
  range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}
