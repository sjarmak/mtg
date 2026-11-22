/**
 * One button's worth of clipboard, reached the way this package reaches a browser.
 *
 * Not to be confused with `./copy.ts`, which is the other meaning of the word:
 * that file renders authored prose. This one puts a string on the system
 * clipboard, and it exists because the alternative on the surface that needs it
 * — `routes/play/LanInvite.ts` — is asking a person to retype a UUID.
 *
 * The workspace tsconfig loads no `lib: dom`, so `navigator` is not a name here.
 * It is reached through the narrow interface below, the same arrangement
 * `app/router.ts` uses for `window`, and the narrowing is not only a type
 * exercise: `navigator.clipboard` is genuinely absent on an insecure origin,
 * which is exactly what `http://192.168.1.20:5173` is. So the failure is a
 * supported outcome with its own return value rather than a rejected promise
 * nobody catches, and the caller draws the link as selectable text either way.
 */

interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

function clipboard(): ClipboardWriter | null {
  const candidate: unknown = (globalThis as { readonly navigator?: unknown }).navigator;
  if (typeof candidate !== 'object' || candidate === null) return null;
  const writer: unknown = (candidate as { readonly clipboard?: unknown }).clipboard;
  if (typeof writer !== 'object' || writer === null) return null;
  if (typeof (writer as Partial<ClipboardWriter>).writeText !== 'function') return null;
  return writer as ClipboardWriter;
}

/** Whether a copy button can do anything on this origin. */
export function canCopy(): boolean {
  return clipboard() !== null;
}

/** True when the text is on the clipboard; false when it could not be put there. */
export async function copyText(text: string): Promise<boolean> {
  const writer = clipboard();
  if (writer === null) return false;
  try {
    await writer.writeText(text);
    return true;
  } catch {
    // A permission prompt that was dismissed, or a page that lost focus between
    // the press and the write. Neither is worth an error banner over a link the
    // page is already showing in full.
    return false;
  }
}
