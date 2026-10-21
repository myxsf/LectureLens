import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';

export default function PdfPage({
  doc,
  number,
  slotWidth,
  regionMode,
  region,
  setRegion,
  notes,
  onActivate,
  onQuickNote,
  onMoveNote,
  onToggleNote,
  onDeleteNote,
  onEditNote,
  registerPage,
}) {
  const host = useRef(null);
  const canvas = useRef(null);
  const layer = useRef(null);
  const drag = useRef(null);
  const noteDrag = useRef(null);
  const sequence = useRef(0);
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState(null);
  const [rendered, setRendered] = useState(false);
  const [renderError, setRenderError] = useState(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0].isIntersecting),
      { rootMargin: '900px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const width = Math.max(120, Math.round(slotWidth || 800));

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    let renderTask;
    let textTask;

    async function draw() {
      const seq = sequence.current + 1;
      sequence.current = seq;
      renderTask?.cancel();
      textTask?.cancel();
      // Sizing changed: hide the previous bitmap so a stale page is never shown.
      setRendered(false);
      try {
        const page = await doc.getPage(number);
        if (cancelled || seq !== sequence.current) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: width / base.width });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const target = canvas.current;
        const textLayer = layer.current;
        if (!target || !textLayer) return;
        target.width = Math.round(viewport.width * ratio);
        target.height = Math.round(viewport.height * ratio);
        target.style.width = `${viewport.width}px`;
        target.style.height = `${viewport.height}px`;
        renderTask = page.render({
          canvasContext: target.getContext('2d'),
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        setSize((current) =>
          current && Math.abs(current.width - viewport.width) < 1 && Math.abs(current.height - viewport.height) < 1
            ? current
            : { width: viewport.width, height: viewport.height },
        );
        await renderTask.promise;
        if (cancelled || seq !== sequence.current) return;
        textLayer.replaceChildren();
        textLayer.style.setProperty('--scale-factor', viewport.scale);
        textLayer.style.setProperty('--total-scale-factor', viewport.scale);
        textLayer.style.setProperty('--min-font-size', 1);
        textTask = new pdfjs.TextLayer({
          textContentSource: await page.getTextContent(),
          container: textLayer,
          viewport,
        });
        await textTask.render();
        if (!cancelled && seq === sequence.current) setRendered(true);
      } catch (error) {
        if (error?.name !== 'RenderingCancelledException' && !cancelled) {
          console.error(error);
          setRenderError(error?.message || '页面渲染失败');
        }
      }
    }

    draw();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textTask?.cancel();
    };
  }, [doc, number, width, visible]);

  useEffect(() => {
    registerPage(number, { host: host.current, canvas: canvas.current, layer: layer.current });
    return () => registerPage(number, null);
  }, [number, registerPage, size, rendered]);

  // Every gesture is expressed relative to the paper, which is exactly the box the
  // notes are positioned in. Using the wrapper instead shifts everything by the
  // page-label height and makes dragged cards drift off the page.
  const paperElement = () => host.current?.querySelector('.paper');
  const pointIn = useCallback((event, element) => {
    const rect = (element || paperElement() || host.current).getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(0.97, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(0.97, (event.clientY - rect.top) / rect.height)),
    };
  }, []);

  const onPointerDown = (event) => {
    onActivate(number);
    drag.current = pointIn(event);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event) => {
    if (!drag.current) return;
    const start = drag.current;
    const now = pointIn(event);
    setRegion({
      page: number,
      x: Math.min(start.x, now.x),
      y: Math.min(start.y, now.y),
      w: Math.abs(start.x - now.x),
      h: Math.abs(start.y - now.y),
    });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  // Drag is anchored to the pointer's offset *inside* the card, measured against the
  // card's own box. Using the anchor point instead would make the card jump by the
  // pin offset, and reading the note from props would compound the delta per event.
  const startNoteDrag = (event, note) => {
    if (event.target.closest('button')) return;
    const card = event.target.closest('.note') || event.currentTarget;
    const cardBox = card.getBoundingClientRect();
    const hostBox = (paperElement() || host.current)?.getBoundingClientRect();
    if (!hostBox || !hostBox.width || !hostBox.height) return;
    event.preventDefault();
    event.stopPropagation();
    noteDrag.current = {
      id: note.id,
      grabX: (event.clientX - cardBox.left) / hostBox.width,
      grabY: (event.clientY - cardBox.top) / hostBox.height,
      cardWidth: cardBox.width,
      cardHeight: cardBox.height,
    };
    card.setPointerCapture?.(event.pointerId);
  };

  const moveNoteDrag = (event, note) => {
    const state = noteDrag.current;
    if (!state || state.id !== note.id) return;
    event.preventDefault();
    const hostBox = (paperElement() || host.current)?.getBoundingClientRect();
    if (!hostBox || !hostBox.width || !hostBox.height) return;
    const pointerX = (event.clientX - hostBox.left) / hostBox.width;
    const pointerY = (event.clientY - hostBox.top) / hostBox.height;
    // The card is drawn 32px right of its anchor (or 6px left when pinned beside).
    const pinnedLeft = note.beside === false;
    const pin = 32 / hostBox.width;
    const cardWidth = (state.cardWidth || note.width || 250) / hostBox.width;
    const cardHeight = (state.cardHeight || note.height || 90) / hostBox.height;
    const rawX = pointerX - state.grabX - (pinnedLeft ? -pin : pin);
    const rawY = pointerY - state.grabY;
    // The card hangs off its anchor by `pin`: clamp the anchor so the drawn box
    // stays on the page, for either pin side.
    const minX = pinnedLeft ? 0 : pin;
    const maxX = Math.max(minX, 1 - cardWidth - pin);
    onMoveNote(note.id, {
      x: Math.max(minX, Math.min(maxX, rawX)),
      y: Math.max(0, Math.min(Math.max(0, 1 - cardHeight), rawY)),
    });
  };

  const endNoteDrag = (event) => {
    const state = noteDrag.current;
    if (state && event?.currentTarget?.releasePointerCapture) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {}
    }
    noteDrag.current = null;
  };

  // Hidden notes stay out of the layout entirely; the toggle lives in the toolbar.
  const visibleNotes = useMemo(() => notes.filter((note) => note.visible !== false), [notes]);

  return (
    <div className="page-slot" data-page={number} ref={host}>
      <div className="page-label">
        <span>第 {number} 页</span>
      </div>
      <div
        className={`paper${rendered ? ' is-ready' : ''}`}
        style={size ? { width: size.width, minHeight: size.height } : undefined}
        onMouseUp={() => onActivate(number)}
        onDoubleClick={(event) => {
          // Double clicking a note edits it; only empty paper creates a new one.
          if (event.target.closest('.note-anchor')) return;
          onQuickNote(number, pointIn(event));
        }}
      >
        <canvas ref={canvas} />
        <div ref={layer} className="textLayer" />
        {!rendered && !renderError && <div className="page-skeleton" aria-hidden="true" />}
        {renderError && <div className="page-error">{renderError}</div>}
        {regionMode && (
          <div
            className="selector"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        )}
        {region?.page === number && region.w > 0.004 && (
          <div
            className="region"
            style={{
              left: `${region.x * 100}%`,
              top: `${region.y * 100}%`,
              width: `${region.w * 100}%`,
              height: `${region.h * 100}%`,
            }}
          />
        )}
        {visibleNotes.map((note) => (
          <div
            key={note.id}
            className={`note-anchor${note.collapsed ? ' is-collapsed' : ''}${note.beside === false ? ' pin-left' : ''}`}
            style={{ left: `${note.x * 100}%`, top: `${note.y * 100}%` }}
          >
            <button
              type="button"
              className="note-pin"
              aria-label={note.collapsed ? '展开批注' : '收起批注'}
              title={note.collapsed ? '展开批注' : '收起批注'}
              onClick={() => onToggleNote(note.id)}
            >
              ✎
            </button>
            {!note.collapsed && (
              <div
                className="note"
                style={{ color: note.color, fontSize: note.size, width: note.width || 250 }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  onEditNote?.(note);
                }}
                onPointerDown={(event) => startNoteDrag(event, note)}
                onPointerMove={(event) => moveNoteDrag(event, note)}
                onPointerUp={(event) => endNoteDrag(event)}
                onPointerCancel={(event) => endNoteDrag(event)}
                onMouseUp={(event) => {
                  event.stopPropagation();
                  const element = event.currentTarget;
                  onMoveNote(note.id, { width: element.offsetWidth, height: element.offsetHeight }, true);
                }}
              >
                <div className="note-head">
                  <b>学习批注</b>
                  <span className="note-tools">
                    <button type="button" title="编辑批注（也可以双击卡片）" onClick={() => onEditNote?.(note)}>
                      ✎
                    </button>
                    <button type="button" title="收起批注" onClick={() => onToggleNote(note.id)}>
                      −
                    </button>
                    <button type="button" title="删除批注" onClick={() => onDeleteNote(note.id)}>
                      ×
                    </button>
                  </span>
                </div>
                <p>{note.text}</p>
                {note.restored && <small className="note-src">来自已保存文档</small>}
                <small className="note-hint">双击卡片可编辑</small>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="page-rule" aria-hidden="true" />
    </div>
  );
}
