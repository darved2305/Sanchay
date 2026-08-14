import { useEffect, useRef } from 'react';

/**
 * Closes an open dropdown/menu on outside click or Escape. Returns a ref to
 * attach to the menu's outermost container. `active` gates the listeners so
 * closed menus don't pay for a document-wide click listener.
 */
export function useClickOutside(active, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!active) return undefined;
    const handlePointerDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) onClose();
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [active, onClose]);
  return ref;
}
