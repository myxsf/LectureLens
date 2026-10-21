// Small pure helpers shared by the UI.

export const clamp01 = (value) => Math.max(0, Math.min(1, value));

// The model ends its answer with a line meant to be pasted into the slide.
export function draftFromAnswer(answer) {
  const marker = answer.split('批注：');
  const tail = marker.length > 1 ? marker[marker.length - 1] : answer.slice(0, 200);
  return tail.replace(/\*\*/g, '').replace(/^[:：\s]+/, '').trim().slice(0, 800);
}

export function stripMarkdown(value) {
  return String(value || '')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/[*_~>#]/g, '')
    .replace(/\$\$?([^$]*)\$\$?/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// Longest common run between the needle and the haystack, used to spot a
// search match that only differs by hyphenation or line-break formatting.
export function commonRunLength(needle, haystack) {
  const a = needle.toLowerCase();
  const b = haystack.toLowerCase();
  let best = 0;
  let previous = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) best = current[j];
      }
    }
    previous = current;
  }
  return best;
}

export const formatBytes = (bytes) => {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};
