import { useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import Icon from './Icon.jsx';
import NotesPanel from './NotesPanel.jsx';

const TABS = [
  { id: 'explain', label: '讲解' },
  { id: 'ask', label: '追问' },
  { id: 'notes', label: '批注' },
];

function Answer({ text, streaming, readingColor, readingSize }) {
  if (!text && streaming) {
    return (
      <div className="skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    );
  }
  return (
    <div className="response" style={{ color: readingColor, fontSize: readingSize }}>
      <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {text}
      </Markdown>
      {streaming && <span className="caret" aria-hidden="true" />}
    </div>
  );
}

export default function Assistant({
  tab,
  onTab,
  doc,
  name,
  page,
  config,
  selected,
  region,
  regionMode,
  question,
  onQuestion,
  draft,
  onDraft,
  noteEditor,
  onNoteEditor,
  editing,
  noteColor,
  onNoteColor,
  noteSize,
  onNoteSize,
  readingColor,
  onReadingColor,
  readingSize,
  onReadingSize,
  answer,
  streaming,
  error,
  onExplain,
  onStop,
  onAddNote,
  onClearAnswer,
  notes,
  onGoTo,
  onToggleNote,
  onDeleteNote,
  onEditNote,
  onFocusNote,
  onExportNotes,
  onClearNotes,
  thread,
  onAsk,
  onClearThread,
  onOpenSettings,
}) {
  const responseRef = useRef(null);

  useEffect(() => {
    if (!streaming) return;
    const node = responseRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [answer, streaming]);

  return (
    <section className="assistant" aria-label="学习搭档">
      <header className="assistant-head">
        <span className="spark">
          <Icon name="spark" size={17} />
        </span>
        <div className="assistant-title">
          <h2>学习搭档</h2>
          <small>{doc ? `${name || '未命名'} · 第 ${page} 页` : '把疑问变成理解'}</small>
        </div>
        <button type="button" className="ghost-icon" aria-label="模型设置" title="模型设置" onClick={onOpenSettings}>
          <Icon name="settings" size={15} />
        </button>
      </header>

      <div className="tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => onTab(item.id)}
          >
            {item.label}
            {item.id === 'notes' && notes.length > 0 && <span className="tab-badge">{notes.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'explain' && (
        <div className="tab-body" role="tabpanel">
          <div className="context-card">
            <div className="context-head">
              <span className="eyebrow">选中内容</span>
              {region ? (
                <span className="chip chip-image">
                  <Icon name="pin" size={11} /> 图片区域 · 需要视觉模型
                </span>
              ) : selected ? (
                <span className="chip">{selected.trim().length} 字</span>
              ) : (
                <span className="chip chip-muted">未选择</span>
              )}
            </div>
            <textarea
              value={question}
              onChange={(event) => onQuestion(event.target.value)}
              placeholder={
                region
                  ? '已框选区域，将发送截图。可以补充你的问题，例如「这一步怎么推导的？」'
                  : '在左侧选中文字，或直接在这里输入你的问题…'
              }
              aria-label="要讲解的内容"
            />
            {selected && (
              <p className="context-preview" title={selected}>
                {selected}
              </p>
            )}
          </div>

          <div className="actions-row">
            <button type="button" className="primary explain" disabled={streaming || !doc} onClick={() => onExplain('explain')}>
              {streaming ? '生成中…' : '帮我理解'}
            </button>
            {streaming ? (
              <button type="button" onClick={onStop}>
                停止
              </button>
            ) : (
              answer && (
                <button type="button" onClick={onClearAnswer}>
                  清空
                </button>
              )
            )}
          </div>

          {error && (
            <div className="inline-error" role="alert">
              <span>{error}</span>
              <button type="button" onClick={onOpenSettings}>
                检查设置
              </button>
            </div>
          )}

          <div className="response-scroll" ref={responseRef}>
            {answer || streaming ? (
              <Answer text={answer} streaming={streaming} readingColor={readingColor} readingSize={readingSize} />
            ) : (
              <div className="hint">
                <span className="hint-icon">
                  <Icon name="spark" size={22} />
                </span>
                <h3>跟着课堂的节奏</h3>
                <p>
                  不懂的术语、复杂的推导、英文知识点，
                  <br />
                  选中后交给 AI 讲给你听。
                </p>
                <small>选中内容 → 获取解释 → 写入课件</small>
              </div>
            )}
          </div>

          <div className="reading-style">
            <label>
              文字颜色
              <input
                aria-label="解释文字颜色"
                type="color"
                value={readingColor}
                onChange={(event) => onReadingColor(event.target.value)}
              />
            </label>
            <label>
              字号
              <select
                aria-label="解释字号"
                value={readingSize}
                onChange={(event) => onReadingSize(Number(event.target.value))}
              >
                {[12, 13, 14, 16, 18, 20].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            {thread.length > 0 && (
              <button type="button" className="link-button" onClick={() => onTab('ask')}>
                追问 {thread.length} 轮 →
              </button>
            )}
          </div>

          <div className="annotation">
            <button
              type="button"
              className="primary write-note"
              disabled={!doc}
              onClick={() => {
                onNoteEditor(!noteEditor);
              }}
            >
              <Icon name={editing ? 'pencil' : 'plus'} size={14} />{' '}
              {noteEditor ? '收起编辑器' : editing ? '编辑批注' : '写入课件'}
            </button>
            {noteEditor && (
              <div className="note-editor" role="dialog" aria-label="批注编辑框">
                <label htmlFor="draft-field">{editing ? '编辑这条批注' : '写进课件的学习笔记'}</label>
                <textarea
                  id="draft-field"
                  autoFocus
                  value={draft}
                  onChange={(event) => onDraft(event.target.value)}
                  style={{ color: noteColor, fontSize: noteSize }}
                  placeholder="输入你的批注，或编辑 AI 生成的笔记"
                />
                <div className="reading-style">
                  <label>
                    文字颜色
                    <input
                      aria-label="批注文字颜色"
                      type="color"
                      value={noteColor}
                      onChange={(event) => onNoteColor(event.target.value)}
                    />
                  </label>
                  <label>
                    字号
                    <select
                      aria-label="批注字号"
                      value={noteSize}
                      onChange={(event) => onNoteSize(Number(event.target.value))}
                    >
                      {[10, 12, 14, 16, 18, 20, 24].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="editor-actions">
                  <button type="button" onClick={() => onNoteEditor(false)}>
                    取消
                  </button>
                  <button type="button" className="primary" disabled={!doc || !draft.trim()} onClick={onAddNote}>
                    {editing ? '保存修改' : '添加到当前页'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'ask' && (
        <div className="tab-body" role="tabpanel">
          <div className="thread" aria-live="polite">
            {!thread.length && (
              <div className="hint">
                <span className="hint-icon">
                  <Icon name="spark" size={22} />
                </span>
                <h3>接着问下去</h3>
                <p>先获取一次讲解，再在这里追问细节、要求举例或出题自测。</p>
              </div>
            )}
            {thread.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`bubble bubble-${message.role}`}>
                <div className="bubble-head">
                  {message.role === 'user' ? '我' : '学习搭档'}
                  {message.role === 'assistant' && (
                    <button
                      type="button"
                      className="ghost-icon"
                      aria-label="复制这条回答"
                      title="复制"
                      onClick={() => navigator.clipboard?.writeText(message.content)}
                    >
                      <Icon name="copy" size={12} />
                    </button>
                  )}
                </div>
                {message.role === 'user' ? (
                  <p>{message.content}</p>
                ) : (
                  <div className="response" style={{ color: readingColor, fontSize: readingSize }}>
                    <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                      {message.content}
                    </Markdown>
                  </div>
                )}
              </div>
            ))}
            {streaming && (answer || thread[thread.length - 1]?.role !== 'assistant') && (
              <div className="bubble bubble-assistant">
                <div className="bubble-head">学习搭档</div>
                <Answer text={answer} streaming readingColor={readingColor} readingSize={readingSize} />
              </div>
            )}
          </div>
          {error && (
            <div className="inline-error" role="alert">
              <span>{error}</span>
            </div>
          )}
          <div className="ask-box">
            <textarea
              value={question}
              onChange={(event) => onQuestion(event.target.value)}
              placeholder="追问：这一步为什么成立？能举个反例吗？"
              aria-label="追问内容"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  onAsk();
                }
              }}
            />
            <div className="ask-actions">
              {thread.length > 0 && (
                <button type="button" onClick={onClearThread}>
                  清空对话
                </button>
              )}
              {streaming ? (
                <button type="button" className="primary" onClick={onStop}>
                  停止
                </button>
              ) : (
                <button type="button" className="primary" disabled={!doc} onClick={onAsk}>
                  发送 ⌘↵
                </button>
              )}
            </div>
            <small className="ask-hint">回答基于当前选中的内容与上面的对话，只会发送给配置的模型。</small>
          </div>
        </div>
      )}

      {tab === 'notes' && (
        <div className="tab-body" role="tabpanel">
          <NotesPanel
            notes={notes}
            page={page}
            onGoTo={onGoTo}
            onToggle={onToggleNote}
            onDelete={onDeleteNote}
            onEdit={onEditNote}
            onFocusNote={onFocusNote}
            onExport={onExportNotes}
            onClearAll={onClearNotes}
          />
        </div>
      )}

      <footer className="model-status">
        <span className={config.key ? 'dot online' : 'dot'} aria-hidden="true" />
        {config.model || '未配置模型'} · {config.key ? 'Key 已就绪' : '请先设置 API Key'}
        {!config.key && (
          <button type="button" className="link-button" onClick={onOpenSettings}>
            去设置
          </button>
        )}
      </footer>
    </section>
  );
}
