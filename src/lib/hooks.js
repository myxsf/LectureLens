import { useCallback, useEffect, useRef, useState } from 'react';

// Debounced writer: keeps React state snappy while persisting to IndexedDB.
export function useDebouncedEffect(effect, delay, deps) {
  const ref = useRef(effect);
  ref.current = effect;
  useEffect(() => {
    const timer = setTimeout(() => ref.current(), delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delay]);
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [value, setValue];
}

// Escape and page-turn shortcuts. Ignored while typing in the assistant boxes.
export function useShortcuts({ onPrev, onNext, onEscape, onSearch }) {
  const handlers = useRef({});
  handlers.current = { onPrev, onNext, onEscape, onSearch };
  const stable = useCallback((event) => {
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const h = handlers.current;
    if (event.key === 'Escape') {
      h.onEscape?.();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      h.onSearch?.();
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      event.preventDefault();
      h.onPrev?.();
    }
    if (event.key === 'ArrowRight' || event.key === 'PageDown') {
      event.preventDefault();
      h.onNext?.();
    }
  }, []);
  useEffect(() => {
    window.addEventListener('keydown', stable);
    return () => window.removeEventListener('keydown', stable);
  }, [stable]);
}

export function useFocusTrap(active, containerRef, onClose) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    const previous = document.activeElement;
    const focusable = () =>
      Array.from(
        container?.querySelectorAll(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[href],[tabindex]:not([tabindex="-1"])',
        ) || [],
      ).filter((el) => el.offsetParent !== null);
    focusable()[0]?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    container?.addEventListener('keydown', onKeyDown);
    return () => {
      container?.removeEventListener('keydown', onKeyDown);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [active, containerRef, onClose]);
}
