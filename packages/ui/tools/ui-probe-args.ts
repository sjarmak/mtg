export interface UiProbeViewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly pointer: 'fine' | 'coarse';
}

export type UiProbeStep =
  | { readonly kind: 'click'; readonly name: string }
  | { readonly kind: 'type'; readonly name: string; readonly text: string }
  | { readonly kind: 'wait-text'; readonly text: string }
  | { readonly kind: 'measure'; readonly selector: string };

export interface UiProbeArgs {
  readonly out: string;
  readonly route: string;
  readonly viewport: UiProbeViewport;
  readonly steps: readonly UiProbeStep[];
  readonly url?: string;
  readonly set?: string;
  readonly source?: string;
}

const VIEWPORTS: Readonly<Record<string, UiProbeViewport>> = {
  desktop: { name: 'desktop', width: 1440, height: 900, pointer: 'fine' },
  tablet: { name: 'tablet', width: 1024, height: 768, pointer: 'coarse' },
  'phone-portrait': { name: 'phone-portrait', width: 390, height: 844, pointer: 'coarse' },
  'phone-landscape': { name: 'phone-landscape', width: 844, height: 390, pointer: 'coarse' },
};

function readViewport(raw: string): UiProbeViewport | string {
  const named = VIEWPORTS[raw];
  if (named !== undefined) return named;
  const match = /^(\d+)x(\d+)$/u.exec(raw);
  if (match === null) {
    return `unknown viewport ${raw}; expected desktop, tablet, phone-portrait, phone-landscape, or WxH`;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 1 || height < 1 || width > 16_384 || height > 16_384) {
    return `viewport ${raw} is outside 1x1 through 16384x16384`;
  }
  return { name: raw, width, height, pointer: 'fine' };
}

function stepValue(argv: readonly string[], index: number): string | null {
  const value = argv[index + 1];
  if (value === undefined || value === '' || value.startsWith('--')) return null;
  return value;
}

function finishUiProbeArgs(
  out: string | undefined,
  route: string,
  viewport: UiProbeViewport,
  steps: readonly UiProbeStep[],
  url: string | undefined,
  set: string | undefined,
  source: string | undefined,
): UiProbeArgs | string {
  if (out === undefined) return '--out is required: the directory for probe artifacts';
  if (!route.startsWith('#/')) return '--route must be a hash route beginning with #/';
  if (url !== undefined && (set !== undefined || source !== undefined)) {
    return '--url cannot be combined with --set or --source because an attached lab is already staged';
  }
  return {
    out,
    route,
    viewport,
    steps,
    ...(url === undefined ? {} : { url }),
    ...(set === undefined ? {} : { set }),
    ...(source === undefined ? {} : { source }),
  };
}

export function readUiProbeArgs(argv: readonly string[]): UiProbeArgs | string {
  let out: string | undefined;
  let route = '#/play';
  let viewport: UiProbeViewport = VIEWPORTS['desktop']!;
  let url: string | undefined;
  let set: string | undefined;
  let source: string | undefined;
  const steps: UiProbeStep[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === undefined) continue;
    const value = stepValue(argv, index);
    if (flag === '--click' || flag === '--wait-text' || flag === '--measure') {
      if (value === null) return `${flag} needs a nonempty value`;
      if (flag === '--click') steps.push({ kind: 'click', name: value });
      if (flag === '--wait-text') steps.push({ kind: 'wait-text', text: value });
      if (flag === '--measure') steps.push({ kind: 'measure', selector: value });
      index += 1;
      continue;
    }
    if (flag === '--type') {
      if (value === null) return '--type needs a nonempty value';
      const separator = value.indexOf('=');
      if (separator < 1) return '--type expects <accessible name>=<text>';
      steps.push({ kind: 'type', name: value.slice(0, separator), text: value.slice(separator + 1) });
      index += 1;
      continue;
    }
    if (!['--out', '--route', '--viewport', '--url', '--set', '--source'].includes(flag)) {
      return `unknown flag ${flag}`;
    }
    if (value === null) return `${flag} needs a nonempty value`;
    if (flag === '--out') out = value;
    if (flag === '--route') route = value;
    if (flag === '--url') url = value;
    if (flag === '--set') set = value;
    if (flag === '--source') source = value;
    if (flag === '--viewport') {
      const parsed = readViewport(value);
      if (typeof parsed === 'string') return parsed;
      viewport = parsed;
    }
    index += 1;
  }
  return finishUiProbeArgs(out, route, viewport, steps, url, set, source);
}
