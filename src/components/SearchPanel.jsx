import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';

export default function SearchPanel({ query, onQuery, search, onClose, onPick }) {
  const input = useRef(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  return (
    <div className="search-panel" role="search">
      <div className="search-bar">
        <Icon name="search" size={15} />
        <input
          ref={input}
          value={query}
          placeholder="搜索本份课件（至少 2 个字符）"
          aria-label="在课件中搜索"
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (event.shiftKey) search.previous();
              else search.next();
            }
          }}
        />
        <span className="search-count">
          {query.trim().length < 2 ? '' : search.total ? `${search.active + 1} / ${search.total}` : '无结果'}
        </span>
        <button type="button" aria-label="上一个结果" onClick={search.previous} disabled={!search.total}>
          <Icon name="left" size={14} />
        </button>
        <button type="button" aria-label="下一个结果" onClick={search.next} disabled={!search.total}>
          <Icon name="right" size={14} />
        </button>
        <button type="button" aria-label="关闭搜索" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {search.total > 0 && (
        <ul className="search-results">
          {search.matches.slice(0, 60).map((match, index) => (
            <li key={`${match.page}-${index}`}>
              <button
                type="button"
                className={index === search.active ? 'active' : ''}
                onClick={() => {
                  search.setActive(index);
                  onPick?.(match);
                }}
              >
                <em>第 {match.page} 页</em>
                <span>{match.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
