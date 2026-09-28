import { useEffect, useRef } from 'preact/hooks';
import { Canvas } from './Canvas';
import { Chrome } from './Chrome';
import { viewport, lastPointerType, fitView, viewRestored } from '../state/ui';
import { doc } from '../state/doc';

export function App() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const measure = () => { const r = el.getBoundingClientRect(); viewport.value = { width: r.width, height: r.height }; };
    measure();
    if (!viewRestored.value) fitView(doc.value.lattice);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref} class="app" data-pointer={lastPointerType.value}><Canvas /><Chrome /></div>;
}
