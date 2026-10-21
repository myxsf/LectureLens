const paths = {
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 3v8M7 11h8M16.5 16.5 21 21',
  zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM7 11h8M16.5 16.5 21 21',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM15.5 15.5 20 20',
  left: 'M14 6 8 12l6 6',
  right: 'M10 6l6 6-6 6',
  close: 'M6 6l12 12M18 6 6 18',
  trash: 'M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12',
  download: 'M12 4v11m0 0 4-4m-4 4-4-4M5 19h14',
  settings:
    'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM19 12l1.6-1.2-1.2-2.6-2 .5-1.7-1L15.2 5h-2.8l-.5 2.7-1.7 1-2-.5-1.2 2.6L8.6 12 7 13.2l1.2 2.6 2-.5 1.7 1 .5 2.7h2.8l.5-2.7 1.7-1 2 .5 1.2-2.6L19 12Z',
  upload: 'M12 19V8m0 0-4 4m4-4 4 4M5 5h14',
  plus: 'M12 6v12M6 12h12',
  pin: 'M12 21s6-6.3 6-11a6 6 0 1 0-12 0c0 4.7 6 11 6 11Z',
  copy: 'M9 9h9v11H9zM6 15H5V4h9v1',
  spark: 'M12 4l1.6 4.8L18 10l-4.4 1.2L12 16l-1.6-4.8L6 10l4.4-1.2L12 4Z',
  sun: 'M12 6.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  doc: 'M7 3h7l4 4v14H7zM14 3v4h4',
  panel: 'M4 5h16v14H4zM14 5v14',
  pencil: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17zM14.5 6.5l3 3',
};

export default function Icon({ name, size = 16 }) {
  const d = paths[name];
  if (!d) return null;
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
