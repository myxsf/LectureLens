import { useMemo, useState } from 'react';
import Icon from './Icon.jsx';

export default function NotesPanel({
  notes,
  page,
  onGoTo,
  onToggle,
  onDelete,
  onEdit,
  onFocusNote,
  onExport,
  onClearAll,
}) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return notes
      .filter((note) => (filter === 'all' ? true : note.page === page))
      .filter((note) => (needle ? note.text.toLowerCase().includes(needle) : true))
      .sort((a, b) => a.page - b.page || a.y - b.y);
  }, [notes, filter, query, page]);

  const pages = useMemo(() => new Set(notes.map((note) => note.page)).size, [notes]);

  return (
    <div className="notes-panel">
      <div className="panel-toolbar">
        <div className="segmented" role="group" aria-label="批注范围">
          <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            全部
          </button>
          <button type="button" className={filter === 'page' ? 'active' : ''} onClick={() => setFilter('page')}>
            本页
          </button>
        </div>
        <span className="muted-note">
          {notes.length} 条 · 分布在 {pages} 页
        </span>
        <button
          type="button"
          className="ghost-icon"
          title="导出批注清单（Markdown，便于复习）"
          aria-label="导出批注清单为 Markdown"
          onClick={onExport}
        >
          <Icon name="download" size={14} />
        </button>
      </div>
      <input
        className="notes-search"
        value={query}
        placeholder="筛选批注内容…"
        aria-label="筛选批注"
        onChange={(event) => setQuery(event.target.value)}
      />
      {!filtered.length && (
        <p className="panel-empty">
          {notes.length ? '没有匹配的批注。' : '还没有批注。选中一段文字，让 AI 讲解后点击「写入课件」。'}
        </p>
      )}
      <ul className="note-list">
        {filtered.map((note) => (
          <li key={note.id} className={note.page === page ? 'is-current' : ''}>
            <button
              type="button"
              className="note-list-main"
              onClick={() => {
                onGoTo(note.page, note.id);
                onFocusNote?.(note);
              }}
            >
              <span className="note-list-head">
                <em style={{ background: note.color }} aria-hidden="true" />
                第 {note.page} 页
                <small>{note.visible === false ? '已隐藏' : note.collapsed ? '已收起' : '展开中'}</small>
              </span>
              <span className="note-list-text">{note.text}</span>
            </button>
            <span className="note-list-tools">
              <button type="button" aria-label="编辑这条批注" title="编辑内容" onClick={() => onEdit?.(note)}>
                <Icon name="pencil" size={13} />
              </button>
              <button type="button" aria-label="显示或隐藏这条批注" title="显示/隐藏" onClick={() => onToggle(note.id)}>
                <Icon name={note.visible === false ? 'moon' : 'sun'} size={13} />
              </button>
              <button type="button" aria-label="删除这条批注" title="删除" onClick={() => onDelete(note.id)}>
                <Icon name="trash" size={13} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {notes.length > 0 && (
        <div className="panel-actions">
          <button type="button" className="danger" onClick={onClearAll}>
            清空批注
          </button>
        </div>
      )}
    </div>
  );
}
