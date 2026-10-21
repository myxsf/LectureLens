import { useEffect } from 'react';
import Icon from './Icon.jsx';

export default function Toasts({ items, onDismiss }) {
  useEffect(() => {
    if (!items.length) return undefined;
    const timers = items.map((item) =>
      setTimeout(() => onDismiss(item.id), item.tone === 'error' ? 7000 : 3200),
    );
    return () => timers.forEach(clearTimeout);
  }, [items, onDismiss]);

  if (!items.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast toast-${item.tone || 'info'}`}>
          <span>{item.message}</span>
          <button type="button" aria-label="关闭提示" onClick={() => onDismiss(item.id)}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
