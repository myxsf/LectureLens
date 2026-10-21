import Thumbnail from './Thumbnail.jsx';

export default function Rail({ doc, page, notes, onGoTo }) {
  return (
    <aside className="rail" aria-label="页面导航">
      <div className="rail-head">
        <span className="eyebrow">PAGES</span>
        {doc && <span className="rail-count">{doc.numPages}</span>}
      </div>
      {!doc && <p className="muted">上传课件后，这里会显示每一页的缩略图。</p>}
      {doc &&
        Array.from({ length: doc.numPages }, (_, index) => {
          const number = index + 1;
          const count = notes.filter((note) => note.page === number).length;
          return (
            <button
              key={number}
              type="button"
              className={page === number ? 'active' : ''}
              onClick={() => onGoTo(number)}
              aria-current={page === number ? 'page' : undefined}
              aria-label={`第 ${number} 页${count ? `，${count} 条批注` : ''}`}
            >
              <Thumbnail doc={doc} number={number} />
              <small>{number}</small>
              {count > 0 && <em title={`${count} 条批注`}>{count}</em>}
            </button>
          );
        })}
    </aside>
  );
}
