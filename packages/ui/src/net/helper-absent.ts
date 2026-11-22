export const HELPER_ABSENT_CODE = 'helper-absent';

export const HELPER_SERVERS = [
  { prefix: '/design-api', name: 'design' },
  { prefix: '/deck-api', name: 'deck' },
  { prefix: '/feedback-api', name: 'feedback' },
  { prefix: '/curation-api', name: 'curation' },
] as const;

export type HelperName = (typeof HELPER_SERVERS)[number]['name'];

export interface HelperAbsentBody {
  readonly ok: false;
  readonly error: { readonly code: typeof HELPER_ABSENT_CODE; readonly message: string };
}

export function helperServing(pathname: string): HelperName | null {
  for (const { prefix, name } of HELPER_SERVERS) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return name;
  }
  return null;
}

export function helperAbsentBody(name: HelperName): HelperAbsentBody {
  return {
    ok: false,
    error: { code: HELPER_ABSENT_CODE, message: `this lab runs without the ${name} server` },
  };
}

export function isHelperAbsent(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const error: unknown = (body as { readonly error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return false;
  return (error as { readonly code?: unknown }).code === HELPER_ABSENT_CODE;
}
