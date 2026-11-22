export interface PageLeaveEvent {
  readonly persisted?: boolean;
}

export interface PageLeaveSource {
  addEventListener(type: 'pagehide', listener: (event: PageLeaveEvent) => void): void;
  removeEventListener(type: 'pagehide', listener: (event: PageLeaveEvent) => void): void;
}

export function pageLeaveSource(): PageLeaveSource | null {
  const candidate: unknown = (globalThis as { readonly window?: unknown }).window;
  if (typeof candidate !== 'object' || candidate === null) return null;
  const partial = candidate as Partial<PageLeaveSource>;
  if (typeof partial.addEventListener !== 'function') return null;
  if (typeof partial.removeEventListener !== 'function') return null;
  return candidate as PageLeaveSource;
}

export function onPageLeft(
  leave: () => void,
  source: PageLeaveSource | null = pageLeaveSource(),
): () => void {
  if (source === null) return () => undefined;
  const listener = (event: PageLeaveEvent): void => {
    if (event.persisted !== true) leave();
  };
  source.addEventListener('pagehide', listener);
  return () => {
    source.removeEventListener('pagehide', listener);
  };
}
