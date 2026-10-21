import { useEffect, useRef } from 'react';

export default function Thumbnail({ doc, number }) {
  const canvas = useRef(null);

  useEffect(() => {
    let task;
    let stopped = false;
    const node = canvas.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(async (entries) => {
      if (!entries[0].isIntersecting) return;
      observer.disconnect();
      try {
        const page = await doc.getPage(number);
        if (stopped) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 84 / base.width });
        node.width = Math.round(viewport.width * 2);
        node.height = Math.round(viewport.height * 2);
        task = page.render({
          canvasContext: node.getContext('2d'),
          viewport,
          transform: [2, 0, 0, 2, 0, 0],
        });
        await task.promise;
      } catch {
        // Thumbnails are decorative; a failure must not disturb the reader.
      }
    });
    observer.observe(node);
    return () => {
      stopped = true;
      observer.disconnect();
      task?.cancel();
    };
  }, [doc, number]);

  return <canvas ref={canvas} className="thumbnail" aria-hidden="true" />;
}
