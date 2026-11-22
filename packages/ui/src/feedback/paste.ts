/**
 * A screenshot, arriving by paste.
 *
 * `mtg-fvuyq.2`. The page cannot take its own picture: `getDisplayMedia` and
 * `navigator.clipboard` exist only on a secure origin and the lab is served
 * over plain http on a LAN address (`../clipboard.ts` records the same
 * finding for copy). What works everywhere is the `paste` event, which carries
 * the clipboard's files regardless of origin, so the practice this lane
 * replaces — CleanShot, then a PNG dropped in `references/UI_issues/` — keeps
 * its first half: shoot with whatever you use, then Cmd+V into the panel.
 *
 * Structural types for the event, for the reason `../mount.ts` gives.
 */
import type { PastedImage } from './wire';

interface FileLike {
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface ClipboardItemLike {
  readonly kind: string;
  readonly type: string;
  getAsFile(): FileLike | null;
}

export interface PasteEventLike {
  readonly clipboardData: { readonly items: ArrayLike<ClipboardItemLike> } | null;
  preventDefault(): void;
}

const ACCEPTED: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** The first image on the clipboard, or null when the paste carried none (text pastes fall through). */
export function pastedImageFile(event: PasteEventLike): FileLike | null {
  const data = event.clipboardData;
  if (data === null) return null;
  for (let index = 0; index < data.items.length; index += 1) {
    const item = data.items[index];
    if (item === undefined || item.kind !== 'file' || !ACCEPTED.has(item.type)) continue;
    const file = item.getAsFile();
    if (file !== null) return file;
  }
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const STEP = 0x8000;
  for (let at = 0; at < bytes.length; at += STEP) {
    binary += String.fromCharCode(...bytes.subarray(at, at + STEP));
  }
  return btoa(binary);
}

/** Reads the pasted file into the wire shape. */
export async function readPastedImage(file: FileLike): Promise<PastedImage> {
  const mime = file.type as PastedImage['mime'];
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { mime, base64: toBase64(bytes) };
}
