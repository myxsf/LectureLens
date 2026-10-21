import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as pdfjs from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import Rail from './components/Rail.jsx';
import PdfPage from './components/PdfPage.jsx';
import Assistant from './components/Assistant.jsx';
import Settings, { PRESETS } from './components/Settings.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import Toasts from './components/Toasts.jsx';
import Icon from './components/Icon.jsx';
import { convertToPdf, explainStream } from './lib/api.js';
import { isPptxFile, pptxToPdf } from './lib/pptx/index.js';
import { parsePptx } from './lib/pptx/parse.js';
import { layoutSlide } from './lib/pptx/layout.js';
import { makeTextMeasurer } from './lib/pptx/render.js';
import { exportAnnotatedPdf, restoreNotes } from './lib/annotations.js';
import { renderNoteImage } from './lib/note-image.js';
import { draftFromAnswer, commonRunLength } from './lib/text.js';
import { useMediaQuery, usePersistentState, useShortcuts } from './lib/hooks.js';
import { useSearch, highlightInLayer } from './lib/useSearch.js';
import {
  clearLastSession,
  deleteDocument,
  listDocuments,
  loadDocument,
  readLastSession,
  rememberLastSession,
  saveDocument,
  storageAvailable,
  storageUsage,
} from './lib/storage.js';

pdfjs.GlobalWorkerOptions.workerSrc = worker;

const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
// `kind` may be the normalised value ("pdf" / "slides") or a real extension.
const isPdfSource = (kind, displayName) => {
  const value = String(kind || /\.[^.]+$/.exec(displayName || '')?.[0] || '.pdf').toLowerCase();
  return value.includes('pdf');
};

let toastSeq = 0;

export default function App() {
  const [theme, setTheme] = usePersistentState('ll-theme', 'light');
  const [config, setConfig] = useState(() => {
    try {
      return { ...PRESETS.DeepSeek, ...JSON.parse(localStorage.getItem('ll-config') || '{}'), key: '' };
    } catch {
      return { ...PRESETS.DeepSeek, key: '' };
    }
  });
  const [readingColor, setReadingColor] = usePersistentState('ll-reading', '#23343a');
  const [readingSize, setReadingSize] = usePersistentState('ll-reading-size', 13);
  const [noteColor, setNoteColor] = usePersistentState('ll-note-color', '#23343a');
  const [noteSize, setNoteSize] = usePersistentState('ll-note-size', 12);
  // PPT is converted to PDF on import, so the export target tells the user which
  // format they are writing into.
  const [sourceKind, setSourceKind] = useState('pdf');

  const [doc, setDoc] = useState(null);
  const [docId, setDocId] = useState(null);
  const [name, setName] = useState('');
  const [page, setPage] = useState(1);
  const [notes, setNotes] = useState([]);
  const [thread, setThread] = useState([]);
  const [recent, setRecent] = useState([]);
  const [lastSession, setLastSession] = useState(null);
  const [usage, setUsage] = useState(0);

  const [tab, setTab] = useState('explain');
  const [question, setQuestion] = useState('');
  const [selected, setSelected] = useState('');
  const [answer, setAnswer] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('brief');
  const [regionMode, setRegionMode] = useState(false);
  const [region, setRegion] = useState(null);
  const [draft, setDraft] = useState('');
  const [noteEditor, setNoteEditor] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadState, setLoadState] = useState({ busy: false, label: '' });
  const [importNotice, setImportNotice] = useState(null);
  const [saveState, setSaveState] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const pagesRef = useRef(null);
  const pageRefs = useRef(new Map());
  const bytesRef = useRef(null);
  const originalRef = useRef(null);
  const controllerRef = useRef(null);
  const streamBuffer = useRef({ text: '', frame: 0 });
  const answerCache = useRef(new Map());
  // Where the current selection starts, in page-relative coordinates. Kept as a ref
  // (not state) because it is read the moment the note is written.
  const selectionAnchor = useRef(null);
  const isNarrow = useMediaQuery('(max-width: 1180px)');

  const addToast = useCallback((message, tone = 'info') => {
    toastSeq += 1;
    const id = `t${toastSeq}`;
    setToasts((list) => [...list.slice(-3), { id, message, tone }]);
  }, []);
  const dismissToast = useCallback((id) => {
    setToasts((list) => list.filter((item) => item.id !== id));
  }, []);

  /* ---------------------------------------------------------------- loading */

  const scrollToPage = useCallback((number, behavior = 'smooth') => {
    setPage(number);
    const entry = pageRefs.current.get(number);
    entry?.host?.scrollIntoView({ behavior, block: 'start' });
  }, []);

  const registerPage = useCallback((number, entry) => {
    if (entry) pageRefs.current.set(number, entry);
    else pageRefs.current.delete(number);
  }, []);

  const applyDocument = useCallback(
    async ({ bytes, pdf, id, displayName, restoredNotes, restorePage, history, kind }) => {
      bytesRef.current = bytes;
      setDoc(pdf);
      setDocId(id);
      setName(displayName);
      setSourceKind(isPdfSource(kind, displayName) ? 'pdf' : 'slides');
      const extracted = await restoreNotes(pdf);
      setNotes([...extracted, ...(restoredNotes || [])]);
      setThread(history || []);
      setAnswer('');
      setError('');
      setSelected('');
      setQuestion('');
      setRegion(null);
      setRegionMode(false);
      setNoteEditor(false);
      setEditingNoteId(null);
      setDraft('');
      setZoom(1);
      setSearchOpen(false);
      setQuery('');
      const target = Math.min(Math.max(1, restorePage || 1), pdf.numPages);
      setPage(target);
      requestAnimationFrame(() => {
        pagesRef.current?.scrollTo({ top: 0 });
        pageRefs.current.get(target)?.host?.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
      if (storageAvailable() && bytes) {
        saveDocument({
          id,
          name: displayName,
          bytes,
          notes: restoredNotes || [],
          page: target,
          thread: history || [],
          kind: isPdfSource(kind, displayName) ? 'pdf' : 'slides',
        })
          .then(() => {
            rememberLastSession(id);
            setUsage((value) => value || 0);
            return storageUsage();
          })
          .then(setUsage)
          .catch((e) => addToast(`本地保存失败：${e.message}`, 'error'));
      }
    },
    [addToast],
  );

  const openFile = useCallback(
    async (file) => {
      if (!file) return;
      const extension = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
      if (!['.pdf', '.ppt', '.pptx', '.odp'].includes(extension)) {
        addToast('只支持 PDF、PPT、PPTX、ODP 文件', 'error');
        return;
      }
      const isSlides = extension !== '.pdf';
      setLoadState({ busy: true, label: isSlides ? '正在转换幻灯片…' : '正在打开文档…' });
      setError('');
      setImportNotice(null);
      try {
        const fileBytes = new Uint8Array(await file.arrayBuffer());
        let bytes = fileBytes;
        let notice = null;

        if (isSlides) {
          try {
            const converted = await convertToPdf(file);
            notice = {
              tone: 'info',
              text: '已用本机 LibreOffice 转换为 PDF，版式与原文件一致。',
            };
            bytes = new Uint8Array(converted);
          } catch (serverError) {
            if (!/LibreOffice|SOFFICE_PATH/i.test(serverError.message) || !isPptxFile(file.name)) {
              throw serverError;
            }
            // No LibreOffice anywhere: render the deck in the browser instead, so a
            // normal deployment needs no extra software on the machine.
            const rendered = await pptxToPdf(fileBytes, {
              onProgress: (done, total, label) => setLoadState({ busy: true, label: `${label}（内置渲染）` }),
            });
            bytes = rendered.bytes;
            const { unsupported, images } = rendered.report;
            const gaps = [
              unsupported.charts ? `${unsupported.charts} 个图表` : '',
              unsupported.smartArt ? `${unsupported.smartArt} 处 SmartArt` : '',
              unsupported.objects ? `${unsupported.objects} 个嵌入对象` : '',
            ].filter(Boolean);
            notice = {
              tone: 'warn',
              text: `本机没有 LibreOffice，已用内置渲染器把 ${rendered.report.slides} 页幻灯片转成 PDF${images ? `（含 ${images} 张图片` : '（'}，文字可选中、可批注）。${
                gaps.length ? `原文件中的 ${gaps.join('、')}未绘制，请对照原文件查看。` : '复杂动画不会保留。'
              }`,
            };
          }
        }

        const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        originalRef.current = file;
        await applyDocument({
          bytes,
          pdf,
          id: `${file.name}-${file.size}-${file.lastModified}`,
          displayName: file.name,
          restoredNotes: [],
          restorePage: 1,
          history: [],
          kind: isSlides ? 'slides' : 'pdf',
        });
        setImportNotice(notice);
        addToast(`已打开《${file.name}》，共 ${pdf.numPages} 页`);
        setRecent(await listDocuments());
      } catch (e) {
        setError(e.message);
        addToast(e.message, 'error');
      } finally {
        setLoadState({ busy: false, label: '' });
      }
    },
    [addToast, applyDocument],
  );

  const openRecent = useCallback(
    async (record) => {
      if (record.id === docId) return;
      setLoadState({ busy: true, label: '正在读取本地文档…' });
      setImportNotice(null);
      try {
        const stored = await loadDocument(record.id);
        if (!stored) throw new Error('本地副本已被删除');
        const bytes = new Uint8Array(stored.bytes);
        const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        const file = new File([bytes], stored.name, { type: 'application/pdf' });
        originalRef.current = file;
        await applyDocument({
          bytes,
          pdf,
          id: stored.id,
          displayName: stored.name,
          restoredNotes: stored.notes || [],
          restorePage: stored.page || 1,
          history: stored.thread || [],
          kind: stored.kind,
        });
        addToast(`已恢复《${stored.name}》，含 ${(stored.notes || []).length} 条批注`);
      } catch (e) {
        addToast(e.message, 'error');
      } finally {
        setLoadState({ busy: false, label: '' });
      }
    },
    [addToast, applyDocument, docId],
  );

  const forgetRecent = useCallback(
    async (id) => {
      await deleteDocument(id);
      setRecent(await listDocuments());
      setLastSession(readLastSession());
      addToast('已删除本地副本');
    },
    [addToast],
  );

  useEffect(() => {
    if (!storageAvailable()) return;
    listDocuments()
      .then((all) => {
        setRecent(all);
        const last = readLastSession();
        if (last?.id) {
          const match = all.find((record) => record.id === last.id);
          if (match) setLastSession({ id: match.id, name: match.name, page: match.page, updatedAt: match.updatedAt });
        }
      })
      .catch(() => {});
    storageUsage().then(setUsage);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  /* ------------------------------------------------------------- persistence */

  useEffect(() => {
    if (!docId || !storageAvailable()) return undefined;
    // `kind` must travel with the autosave too, otherwise the periodic write would
    // reset a converted deck back to "pdf".
    const stored = { id: docId, name, bytes: bytesRef.current, notes, page, thread, kind: sourceKind };
    if (!stored.bytes) return undefined;
    const timer = setTimeout(() => {
      saveDocument(stored)
        .then(() => {
          rememberLastSession(docId);
          return storageUsage();
        })
        .then(setUsage)
        .catch((e) => {
          if (String(e?.name) === 'QuotaExceededError') addToast('本地存储已满，批注未保存到本地', 'error');
        });
    }, 700);
    return () => clearTimeout(timer);
  }, [docId, name, notes, page, thread, sourceKind, addToast]);

  // Config changes are cheap; keep them in localStorage immediately.
  useEffect(() => {
    try {
      localStorage.setItem('ll-config', JSON.stringify({ base: config.base, model: config.model }));
    } catch {}
  }, [config.base, config.model]);

  /* ------------------------------------------------------------------- search */

  const search = useSearch(doc, query);
  useEffect(() => {
    if (!searchOpen || !search.current) return undefined;
    const match = search.current;
    scrollToPage(match.page);
    const timer = setTimeout(() => {
      const occurrence = search.matches
        .slice(0, search.active)
        .filter((item) => item.page === match.page).length;
      highlightInLayer(match.page, query, occurrence);
    }, 420);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen, search.current, query]);

  /* --------------------------------------------------------------- selection */

  const activatePage = useCallback(
    (number) => {
      setPage(number);
      const domSelection = window.getSelection();
      if (regionMode || !domSelection || domSelection.isCollapsed || !domSelection.anchorNode) return;
      const text = domSelection.toString().trim();
      if (!text) return;
      // Always mirror the live selection in the assistant, whatever was there before.
      setSelected(text);
      setQuestion(text);
      setRegion(null);
      selectionAnchor.current = null;
      const entry = pageRefs.current.get(number);
      const host = entry?.host?.querySelector('.paper') || entry?.host;
      if (host) {
        const bounds = host.getBoundingClientRect();
        const rect = domSelection.getRangeAt(0).getClientRects()[0] || bounds;
        const x = Math.max(0, Math.min(0.95, (rect.left - bounds.left) / bounds.width));
        const right = Math.max(0, Math.min(1, (rect.right - bounds.left) / bounds.width));
        // A short, left-aligned selection (a heading) reads better with the card to its
        // right; wide body text gets the card directly underneath. The card itself is
        // drawn 32px right of its anchor, so subtract that to clear the selected text.
        const pin = 32 / bounds.width;
        const beside = right < 0.45;
        selectionAnchor.current = {
          page: number,
          x: beside ? Math.max(0, right + 0.015 - pin) : x,
          y: Math.max(0, Math.min(0.97, (rect.top - bounds.top) / bounds.height)) + (beside ? -0.005 : 0.06),
          beside,
        };
      }
    },
    [regionMode],
  );

  // The editor lives in the 讲解 tab, so opening it must bring that tab forward,
  // otherwise a double click from another tab looks like it did nothing.
  const openNoteEditor = useCallback((open) => {
    setNoteEditor(open);
    if (!open) setEditingNoteId(null);
    else setTab('explain');
  }, []);

  // Double clicking an existing note reopens it in the same editor, prefilled.
  const editNote = useCallback(
    (note) => {
      selectionAnchor.current = { page: note.page, x: note.x, y: note.y, beside: note.beside !== false };
      setNotes((list) => list.map((item) => (item.id === note.id ? { ...item, collapsed: false, visible: true } : item)));
      setEditingNoteId(note.id);
      setDraft(note.text);
      setNoteColor(note.color || '#23343a');
      setNoteSize(note.size || 12);
      setTab('explain');
      setNoteEditor(true);
      scrollToPage(note.page);
    },
    [scrollToPage, setNoteColor, setNoteSize],
  );

  // Style changes while editing must be visible immediately on the note itself.
  const changeNoteColor = useCallback(
    (value) => {
      setNoteColor(value);
      if (editingNoteId) {
        setNotes((list) => list.map((note) => (note.id === editingNoteId ? { ...note, color: value } : note)));
      }
    },
    [editingNoteId, setNoteColor],
  );
  const changeNoteSize = useCallback(
    (value) => {
      setNoteSize(value);
      if (editingNoteId) {
        setNotes((list) => list.map((note) => (note.id === editingNoteId ? { ...note, size: value } : note)));
      }
    },
    [editingNoteId, setNoteSize],
  );

  const quickNote = useCallback(
    (number, point) => {
      selectionAnchor.current = { page: number, x: point.x, y: Math.min(0.9, point.y + 0.04), beside: true };
      setDraft('');
      setEditingNoteId(null);
      openNoteEditor(true);
    },
    [openNoteEditor],
  );

  /* -------------------------------------------------------------- AI requests */

  const crop = useCallback(() => {
    if (!region || region.w <= 0.004) return null;
    const entry = pageRefs.current.get(region.page);
    const canvas = entry?.canvas;
    if (!canvas) return null;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(region.w * canvas.width));
    out.height = Math.max(1, Math.round(region.h * canvas.height));
    out
      .getContext('2d')
      .drawImage(
        canvas,
        region.x * canvas.width,
        region.y * canvas.height,
        out.width,
        out.height,
        0,
        0,
        out.width,
        out.height,
      );
    return out.toDataURL('image/png');
  }, [region]);

  const runStream = useCallback(
    async ({ contextText, image, history, questionText }) => {
      setStreaming(true);
      setError('');
      setAnswer('');
      streamBuffer.current = { text: '', frame: 0 };
      controllerRef.current = new AbortController();
      const flush = () => {
        setAnswer(streamBuffer.current.text);
        streamBuffer.current.frame = 0;
      };
      try {
        const text = await explainStream(
          {
            config,
            text: contextText,
            image,
            mode,
            history,
            signal: controllerRef.current.signal,
            question: questionText,
          },
          (chunk) => {
            streamBuffer.current.text = chunk;
            if (!streamBuffer.current.frame) {
              streamBuffer.current.frame = requestAnimationFrame(flush);
            }
          },
        );
        cancelAnimationFrame(streamBuffer.current.frame);
        setAnswer(text);
        return text;
      } catch (e) {
        cancelAnimationFrame(streamBuffer.current.frame);
        if (e.name !== 'AbortError') {
          setError(e.message);
          addToast(e.message, 'error');
        }
        return null;
      } finally {
        setStreaming(false);
        controllerRef.current = null;
      }
    },
    [addToast, config, mode],
  );

  const explain = useCallback(async () => {
    if (streaming) return;
    const trimmed = question.trim();
    const hasRegion = Boolean(region && region.w > 0.004);
    if (!selected.trim() && !hasRegion && !trimmed) {
      setError('请先在左侧选中文字、框选区域，或直接输入问题');
      return;
    }
    const context = hasRegion
      ? `（已框选课件区域，见截图）${trimmed}`
      : `【课件内容】${selected.trim()}\n\n【我的问题】${trimmed || '请解释这段内容'}`;
    const anchorAtRequest = hasRegion
      ? { ...region, beside: false }
      : selectionAnchor.current && { ...selectionAnchor.current };
    const cacheKey = `${mode}\u0000${selected.trim()}\u0000${trimmed}`;
    if (!hasRegion) {
      const cached = answerCache.current.get(cacheKey);
      if (cached) {
        setAnswer(cached);
        setDraft(draftFromAnswer(cached));
        selectionAnchor.current = anchorAtRequest;
        setTab('explain');
        addToast('这次讲解与上次相同，直接用了缓存，没有再次调用模型');
        return;
      }
    }
    const text = await runStream({ contextText: context, image: hasRegion ? crop() : null, history: [] });
    if (text) {
      setDraft(draftFromAnswer(text));
      selectionAnchor.current = anchorAtRequest;
      setTab('explain');
      if (!hasRegion) answerCache.current.set(cacheKey, text);
      addToast('已生成讲解，可在下方编辑后写入课件');
    }
  }, [addToast, crop, question, region, runStream, selected, streaming]);

  const ask = useCallback(async () => {
    if (streaming) return;
    const trimmed = question.trim();
    if (!trimmed) {
      setError('请输入你的追问');
      return;
    }
    const history = thread.map((message) => ({ role: message.role, content: message.content }));
    const asked = { role: 'user', content: trimmed };
    setThread((list) => [...list, asked]);
    setQuestion('');
    const context = selected.trim() ? `【课件内容】${selected.trim()}\n\n【追问】${trimmed}` : trimmed;
    const text = await runStream({ contextText: context, image: null, history });
    if (text) {
      setThread((list) => [...list, { role: 'assistant', content: text }]);
      setDraft(draftFromAnswer(text));
      setAnswer('');
    } else {
      setThread((list) => list.filter((message) => message !== asked));
    }
  }, [question, runStream, selected, streaming, thread]);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    setStreaming(false);
    addToast('已停止生成');
  }, [addToast]);

  /* ------------------------------------------------------------------- notes */

  // Precedence: the live box selection, then the last text selection, then the page
  // corner. A stale anchor must never win over the current selection.
  const noteTarget = () => {
    if (region && region.w > 0.004) return { ...region };
    const anchor = selectionAnchor.current;
    if (anchor && anchor.page === page) {
      return { ...anchor, y: Math.max(0, Math.min(0.9, anchor.y)) };
    }
    if (anchor) return { ...anchor };
    return { page, x: 0.06, y: 0.08, beside: false };
  };

  const addNote = () => {
    if (!draft.trim() || !doc) return;
    if (editingNoteId) {
      setNotes((list) =>
        list.map((note) =>
          note.id === editingNoteId ? { ...note, text: draft.trim(), color: noteColor, size: noteSize } : note,
        ),
      );
      setNoteEditor(false);
      setEditingNoteId(null);
      setDraft('');
      setTab('notes');
      addToast('已保存批注修改');
      return;
    }
    const target = noteTarget();
    const entry = pageRefs.current.get(target.page);
    setNotes((list) => [
      ...list,
      {
        id: crypto.randomUUID(),
        page: target.page,
        text: draft.trim(),
        x: target.x ?? 0.06,
        y: target.y ?? 0.08,
        color: noteColor,
        size: noteSize,
        collapsed: false,
        visible: true,
        beside: target.beside !== false,
        pageWidth: entry?.host?.clientWidth || 900,
      },
    ]);
    setNoteEditor(false);
    setDraft('');
    setTab('notes');
    addToast(`已把批注写到第 ${target.page} 页`);
  };

  const toggleNote = useCallback((id) => {
    setNotes((list) => list.map((note) => (note.id === id ? { ...note, collapsed: !note.collapsed } : note)));
  }, []);

  const deleteNote = useCallback((id) => {
    setNotes((list) => list.filter((note) => note.id !== id));
    setEditingNoteId((current) => {
      if (current !== id) return current;
      setNoteEditor(false);
      setDraft('');
      return null;
    });
  }, []);

  const moveNote = useCallback((id, patch) => {
    setNotes((list) => list.map((note) => (note.id === id ? { ...note, ...patch } : note)));
  }, []);

  const focusNote = useCallback(
    (note) => {
      setNotes((list) =>
        list.map((item) => (item.id === note.id ? { ...item, collapsed: false, visible: true } : item)),
      );
    },
    [],
  );

  const notesVisible = notes.some((note) => note.visible !== false);
  const toggleAllNotes = () => {
    const next = !notesVisible;
    setNotes((list) => list.map((note) => ({ ...note, visible: next })));
  };

  const clearNotes = () => {
    if (!notes.length) return;
    setNotes([]);
    addToast('已清空本份课件的批注');
  };

  const exportNotes = () => {
    const byPage = new Map();
    notes.forEach((note) => {
      if (!byPage.has(note.page)) byPage.set(note.page, []);
      byPage.get(note.page).push(note);
    });
    const lines = [`# ${name || '课件'} · 学习批注`, '', `导出时间：${new Date().toLocaleString()}`, ''];
    [...byPage.keys()].sort((a, b) => a - b).forEach((pageNumber) => {
      lines.push(`## 第 ${pageNumber} 页`, '');
      byPage.get(pageNumber).forEach((note) => {
        lines.push(`- ${note.text.replace(/\n/g, ' ')}`);
      });
      lines.push('');
    });
    download(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }), `${name.replace(/\.[^.]+$/, '')}-批注.md`);
  };

  const save = async () => {
    if (!bytesRef.current || !doc) return;
    const visible = notes.filter((note) => note.visible !== false);
    if (!visible.length) {
      addToast('当前没有可见批注，先「显示批注」再导出', 'error');
      return;
    }
    setSaveState(true);
    setError('');
    try {
      const data = await exportAnnotatedPdf(bytesRef.current, visible, doc, renderNoteImage);
      download(
        new Blob([data], { type: 'application/pdf' }),
        `${name.replace(/\.[^.]+$/, '')}-学习批注.pdf`,
      );
      addToast(`已导出 ${visible.length} 条可见批注`);
    } catch (e) {
      const message = /encrypt/i.test(e.message)
        ? '这份 PDF 受密码保护，请先解密后再上传'
        : e.message;
      setError(message);
      addToast(message, 'error');
    } finally {
      setSaveState(false);
    }
  };

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ------------------------------------------------------------------ routing */

  useShortcuts({
    onPrev: () => doc && scrollToPage(Math.max(1, page - 1), 'auto'),
    onNext: () => doc && scrollToPage(Math.min(doc.numPages, page + 1), 'auto'),
    onEscape: () => {
      if (settingsOpen) setSettingsOpen(false);
      else if (searchOpen) setSearchOpen(false);
      else if (assistantOpen) setAssistantOpen(false);
    },
    onSearch: () => doc && setSearchOpen(true),
  });

  const changeZoom = (delta) => {
    setZoom((value) => {
      if (delta === 0) return 1;
      const index = ZOOM_STEPS.findIndex((step) => Math.abs(step - value) < 0.001);
      const next = index === -1 ? 1 : Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + delta));
      return ZOOM_STEPS[next];
    });
  };

  const [baseWidth, setBaseWidth] = useState(900);
  useEffect(() => {
    const node = pagesRef.current;
    if (!node) return undefined;
    const measure = () => {
      const styles = getComputedStyle(node);
      const padding = parseFloat(styles.paddingLeft || '0') + parseFloat(styles.paddingRight || '0');
      setBaseWidth(Math.max(320, node.clientWidth - padding));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [doc]);

  const slotWidth = baseWidth * Math.min(zoom, 1.15);
  const pages = useMemo(() => (doc ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : []), [doc]);
  const pageNoteCount = useMemo(() => notes.filter((note) => note.page === page).length, [notes, page]);


  // Test hook: lets the browser end-to-end suite drive the real export path and
  // assert on the produced PDF without going through the download dialog.
  useEffect(() => {
    window.__lecturelens = {
      exportAnnotatedPdf,
      renderNoteImage,
      pptxToPdf,
      parsePptx,
      layoutSlide,
      makeTextMeasurer,
      getDocument: () => doc,
      getBytes: () => bytesRef.current,
      state: () => ({ docId, page, notes, threadLength: thread.length, zoom, theme }),
    };
    return () => {
      delete window.__lecturelens;
    };
  }, [docId, page, notes, thread.length, zoom, theme, doc]);

  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) openFile(file);
  };

  return (
    <div
      className={`app${dragging ? ' is-dragging' : ''}${assistantOpen ? ' assistant-open' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="doc" size={18} />
          </span>
          <span className="brand-text">
            LectureLens
            <small>课堂学习助手</small>
          </span>
        </div>

        <div className="topbar-center">
          {doc && (
            <>
              <div className="pager" role="group" aria-label="翻页">
                <button
                  type="button"
                  aria-label="上一页"
                  disabled={page <= 1}
                  onClick={() => scrollToPage(page - 1)}
                >
                  <Icon name="left" size={15} />
                </button>
                <span className="pager-input">
                  <input
                    type="number"
                    min={1}
                    max={doc.numPages}
                    value={page}
                    aria-label="跳转到页码"
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (next >= 1 && next <= doc.numPages) scrollToPage(next, 'auto');
                    }}
                  />
                  <em>/ {doc.numPages}</em>
                </span>
                <button
                  type="button"
                  aria-label="下一页"
                  disabled={page >= doc.numPages}
                  onClick={() => scrollToPage(page + 1)}
                >
                  <Icon name="right" size={15} />
                </button>
              </div>
              <div className="zoom" role="group" aria-label="缩放">
                <button type="button" aria-label="缩小" onClick={() => changeZoom(-1)} disabled={zoom <= ZOOM_STEPS[0]}>
                  <Icon name="zoomOut" size={15} />
                </button>
                <button type="button" className="zoom-value" onClick={() => changeZoom(0)} title="回到 100%">
                  {Math.round(zoom * 100)}%
                </button>
                <button type="button" aria-label="放大" onClick={() => changeZoom(1)} disabled={zoom >= ZOOM_STEPS.at(-1)}>
                  <Icon name="zoomIn" size={15} />
                </button>
              </div>
            </>
          )}
        </div>

        <div className="actions">
          <button
            type="button"
            className={searchOpen ? 'active' : ''}
            disabled={!doc}
            onClick={() => setSearchOpen((value) => !value)}
          >
            <Icon name="search" size={15} /> 搜索
          </button>
          <div className="segmented mode-switch" role="group" aria-label="选择方式">
            <button
              type="button"
              className={regionMode ? '' : 'active'}
              disabled={!doc}
              onClick={() => {
                setRegionMode(false);
                setRegion(null);
                activatePage(page);
              }}
            >
              选文字
            </button>
            <button
              type="button"
              className={regionMode ? 'active' : ''}
              disabled={!doc}
              onClick={() => {
                setRegionMode(true);
                setSelected('');
              }}
            >
              框选图
            </button>
          </div>
          <button type="button" disabled={!notes.length} onClick={toggleAllNotes}>
            {notesVisible ? '隐藏批注' : '显示批注'}
          </button>
          <button type="button" disabled={!doc || saveState} onClick={save}>
            <Icon name="download" size={15} />{' '}
            {saveState ? '导出中…' : sourceKind === 'pdf' ? '保存到 PDF 文件' : '导出为 PDF（PPT 已转换）'}
          </button>
          <label className="primary upload">
            <Icon name="upload" size={15} /> 上传课件
            <input
              type="file"
              accept=".pdf,.ppt,.pptx,.odp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                openFile(file);
              }}
            />
          </label>
        </div>
      </header>

      {searchOpen && doc && (
        <SearchPanel
          query={query}
          onQuery={setQuery}
          search={search}
          onClose={() => setSearchOpen(false)}
          onPick={(match) => scrollToPage(match.page)}
        />
      )}

      <div className="workspace">
        {isNarrow && assistantOpen && <div className="drawer-scrim" onClick={() => setAssistantOpen(false)} aria-hidden="true" />}
        <Rail doc={doc} page={page} notes={notes} onGoTo={scrollToPage} />

        <main className="viewer">
          {importNotice && (
            <div className={`import-notice ${importNotice.tone}`} role="status">
              <span>{importNotice.text}</span>
              <button type="button" aria-label="关闭提示" onClick={() => setImportNotice(null)}>
                <Icon name="close" size={12} />
              </button>
            </div>
          )}
          <div className="viewer-bar">
            <div className="viewer-title">
              <b title={name}>{name || '你的课堂，随时读懂'}</b>
              <small>
                {doc
                  ? `第 ${page} / ${doc.numPages} 页 · ${notes.length} 条批注${pageNoteCount ? `（本页 ${pageNoteCount}）` : ''}`
                  : 'PDF · PowerPoint · 纯本地处理'}
              </small>
            </div>
            <div className="viewer-tools">
              {regionMode && <span className="chip chip-live">拖动鼠标框选区域</span>}
              {notes.length > 0 && (
                <span className="chip chip-muted">双击页面可新建批注</span>
              )}
              {doc && (
                <button
                  type="button"
                  className="ghost-icon"
                  title="下载原始文件"
                  aria-label="下载原始文件"
                  onClick={() => originalRef.current && download(originalRef.current, originalRef.current.name)}
                >
                  <Icon name="download" size={15} />
                </button>
              )}
            </div>
          </div>

          <div className="document" ref={pagesRef}>
            {!doc && (
              <div className="empty">
                <div className="empty-card">
                  <div className="doc-icon">
                    <Icon name="doc" size={22} />
                  </div>
                  <h1>
                    让难懂的课件
                    <br />
                    变成你的知识。
                  </h1>
                  <p>
                    选中英文段落或公式，获得中文讲解；
                    <br />
                    把理解写在课件上，让每一页都有收获。
                  </p>
                  <div className="empty-actions">
                    <label className="primary upload">
                      <Icon name="upload" size={15} /> 上传第一份课件
                      <input
                        type="file"
                        accept=".pdf,.ppt,.pptx,.odp"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          openFile(file);
                        }}
                      />
                    </label>
                    {lastSession && (
                      <button type="button" onClick={() => openRecent({ id: lastSession.id })}>
                        继续《{lastSession.name}》
                      </button>
                    )}
                  </div>
                  <small>文档留在本机 · 只有选中的内容会发送给你配置的模型</small>
                  {recent.length > 0 && (
                    <div className="recent">
                      <span className="eyebrow">最近打开</span>
                      <ul>
                        {recent.slice(0, 4).map((record) => (
                          <li key={record.id}>
                            <button type="button" onClick={() => openRecent(record)}>
                              <b>{record.name}</b>
                              <small>
                                {new Date(record.updatedAt).toLocaleString()} · {record.notes?.length || 0} 条批注
                              </small>
                            </button>
                            <button
                              type="button"
                              className="ghost-icon"
                              aria-label={`删除 ${record.name} 的本地副本`}
                              title="删除本地副本"
                              onClick={(event) => {
                                event.stopPropagation();
                                forgetRecent(record.id);
                              }}
                            >
                              <Icon name="trash" size={13} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {doc &&
              pages.map((number) => (
                <PdfPage
                  key={`${doc.loadingTask?.docId || docId}-${number}`}
                  doc={doc}
                  number={number}
                  slotWidth={slotWidth}
                  regionMode={regionMode}
                  region={region}
                  setRegion={setRegion}
                  notes={notes.filter((note) => note.page === number)}
                  onActivate={activatePage}
                  onQuickNote={quickNote}
                  onMoveNote={moveNote}
                  onToggleNote={toggleNote}
                  onDeleteNote={deleteNote}
                  onEditNote={editNote}
                  registerPage={registerPage}
                />
              ))}

            {loadState.busy && (
              <div className="loading-overlay" role="status">
                <span className="spinner" aria-hidden="true" />
                {loadState.label}
              </div>
            )}
          </div>

          <footer className="viewer-foot">
            <span className="dot online" aria-hidden="true" />
            本地学习空间
            <span>{notes.length} 条批注</span>
            <button
              type="button"
              disabled={!doc}
              onClick={() => {
                setTab('notes');
                setAssistantOpen(true);
              }}
            >
              查看批注清单
            </button>
            {usage > 0 && <span className="muted-note">本地已用 {(usage / 1024 / 1024).toFixed(1)} MB</span>}
          </footer>
        </main>

        {isNarrow && (
          <button type="button" className="drawer-handle" aria-label="收起学习搭档" onClick={() => setAssistantOpen(false)}>
            <span />
          </button>
        )}
        <Assistant
          tab={tab}
          onTab={(next) => {
            setTab(next);
            if (next === 'ask' && !question.trim() && selected.trim()) setQuestion(selected.trim());
          }}
          doc={doc}
          name={name}
          page={page}
          config={config}
          selected={selected}
          region={region}
          regionMode={regionMode}
          question={question}
          onQuestion={setQuestion}
          draft={draft}
          onDraft={setDraft}
          noteEditor={noteEditor}
          onNoteEditor={openNoteEditor}
          noteColor={noteColor}
          onNoteColor={changeNoteColor}
          noteSize={noteSize}
          onNoteSize={changeNoteSize}
          editing={Boolean(editingNoteId)}
          readingColor={readingColor}
          onReadingColor={setReadingColor}
          readingSize={readingSize}
          onReadingSize={setReadingSize}
          answer={answer}
          streaming={streaming}
          error={error}
          onExplain={explain}
          onAsk={ask}
          onStop={stop}
          onAddNote={addNote}
          onClearAnswer={() => setAnswer('')}
          notes={notes}
          onGoTo={scrollToPage}
          onToggleNote={toggleNote}
          onDeleteNote={deleteNote}
          onEditNote={editNote}
          onFocusNote={focusNote}
          onExportNotes={exportNotes}
          onClearNotes={clearNotes}
          thread={thread}
          onClearThread={() => {
            setThread([]);
            addToast('已清空对话');
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>

      <button
        type="button"
        className="assistant-fab"
        aria-label="打开学习搭档"
        onClick={() => setAssistantOpen((value) => !value)}
      >
        <Icon name="spark" size={18} />
        {notes.length > 0 && <em>{notes.length}</em>}
      </button>

      {settingsOpen && (
        <Settings
          config={config}
          onConfig={setConfig}
          onClose={() => setSettingsOpen(false)}
          theme={theme}
          onTheme={setTheme}
          storageUsage={usage}
        />
      )}

      <Toasts items={toasts} onDismiss={dismissToast} />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);

