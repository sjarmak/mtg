/**
 * The transpiler entry points.
 *
 * `transpileSet` is all-or-nothing on purpose. A set that exports 89 of its 90
 * cards would boot in Forge and pass a naive gate while the missing card's
 * mechanic went unenforced — exactly the silent divergence between generated
 * and enforceable space this package exists to prevent. Rejections are
 * returned as data, never thrown, so the caller can report every unmappable
 * construct in one pass.
 */
import type { Card, TokenSpec } from '@mtg/dsl';
import { validateCards, validateSetUniqueness } from '@mtg/dsl';
import type { CardScriptBody } from './card-script';
import { transpileCardScript, transpileTokenScript } from './card-script';
import type { ForgeEditionOptions } from './edition';
import { renderEdition } from './edition';
import { forgeCardFileName, forgeTokenScriptName } from './naming';
import type { TranspileRejection } from './rejection';
import { rejection } from './rejection';

/** A file to be written under Forge's `custom/` tree. */
export interface ForgeFile {
  /** Path relative to the custom directory, e.g. `cards/lightning_lash.txt`. */
  readonly path: string;
  readonly contents: string;
}

export interface ForgeCardScript {
  readonly cardId: string;
  readonly cardName: string;
  /** Script file name, or `''` for stock cards Forge already ships. */
  readonly fileName: string;
  readonly text: string;
  readonly tokens: readonly TokenSpec[];
  /**
   * True when Forge already ships an identical printing (the five basic lands
   * named after their own type). Those are listed in the edition but not
   * re-scripted: a second card named `Mountain` would be a name conflict, the
   * one failure mode Forge's own custom-set docs call out.
   */
  readonly stock: boolean;
}

export type TranspileCardResult =
  | { readonly ok: true; readonly script: ForgeCardScript }
  | { readonly ok: false; readonly rejections: readonly TranspileRejection[] };

export interface ForgeSetExport {
  readonly setCode: string;
  readonly edition: ForgeFile;
  readonly cards: readonly ForgeFile[];
  readonly tokens: readonly ForgeFile[];
  readonly scripts: readonly ForgeCardScript[];
}

export type TranspileSetResult =
  | { readonly ok: true; readonly value: ForgeSetExport }
  | { readonly ok: false; readonly rejections: readonly TranspileRejection[] };

/** True for a basic land whose name is the stock printing Forge already has. */
export function isStockCard(card: Card): boolean {
  return card.kind === 'land' && card.name === card.basicLandType;
}

/** Transpiles a single card. Assumes the card is already DSL-valid. */
export function transpileCard(card: Card): TranspileCardResult {
  const body = transpileCardScript(card);
  if (!body.ok) return { ok: false, rejections: body.rejections };
  const stock = isStockCard(card);
  const fileName = stock ? '' : forgeCardFileName(card.name);
  if (!stock && fileName.length === 0) {
    return {
      ok: false,
      rejections: [
        rejection(
          'UNSAFE_SCRIPT_TEXT',
          card.id,
          'name',
          `card name ${JSON.stringify(card.name)} has no letters or digits, so it yields no Forge script file name`,
        ),
      ],
    };
  }
  return { ok: true, script: toScript(card, body.value, fileName, stock) };
}

function toScript(card: Card, body: CardScriptBody, fileName: string, stock: boolean): ForgeCardScript {
  return {
    cardId: card.id,
    cardName: card.name,
    fileName,
    text: `${body.lines.join('\n')}\n`,
    tokens: body.tokens,
    stock,
  };
}

function setCodeOf(cards: readonly Card[]): string {
  const first = cards[0];
  return first === undefined ? '' : first.set.code;
}

/**
 * Transpiles a whole set: DSL validation, per-card transpile, token
 * de-duplication, file-name collision detection, and the edition file.
 */
export function transpileSet(cards: readonly Card[], options: ForgeEditionOptions): TranspileSetResult {
  const rejections: TranspileRejection[] = [...dslRejections(cards), ...mixedSetCodeRejections(cards)];
  if (rejections.length > 0) return { ok: false, rejections };

  const scripts: ForgeCardScript[] = [];
  for (const card of cards) {
    const result = transpileCard(card);
    if (!result.ok) {
      rejections.push(...result.rejections);
      continue;
    }
    scripts.push(result.script);
  }

  const cardFiles = collectCardFiles(scripts, rejections);
  const tokenFiles = collectTokenFiles(scripts, rejections);
  if (rejections.length > 0) return { ok: false, rejections };

  const setCode = setCodeOf(cards);
  return {
    ok: true,
    value: {
      setCode,
      edition: { path: `editions/${setCode}.txt`, contents: renderEdition(setCode, cards, options) },
      cards: cardFiles,
      tokens: tokenFiles,
      scripts,
    },
  };
}

function dslRejections(cards: readonly Card[]): TranspileRejection[] {
  const violations = [...validateCards(cards), ...validateSetUniqueness(cards)];
  return violations.map((v) =>
    rejection('DSL_VIOLATION', cardIdAt(cards, v.path), v.path, `${v.code}: ${v.message}`),
  );
}

/** Recovers the card id from a `cards[i].…` violation path. */
function cardIdAt(cards: readonly Card[], path: string): string {
  const match = /^cards\[(\d+)\]/.exec(path);
  if (match === null) return '';
  const index = Number(match[1]);
  return cards[index]?.id ?? '';
}

function mixedSetCodeRejections(cards: readonly Card[]): TranspileRejection[] {
  const setCode = setCodeOf(cards);
  return cards
    .filter((card) => card.set.code !== setCode)
    .map((card) =>
      rejection(
        'DSL_VIOLATION',
        card.id,
        'set.code',
        `a Forge edition holds one set code; expected "${setCode}", got "${card.set.code}"`,
      ),
    );
}

function collectCardFiles(
  scripts: readonly ForgeCardScript[],
  rejections: TranspileRejection[],
): ForgeFile[] {
  const byFileName = new Map<string, ForgeCardScript>();
  const files: ForgeFile[] = [];
  for (const script of scripts) {
    if (script.stock) continue;
    const existing = byFileName.get(script.fileName);
    if (existing !== undefined) {
      rejections.push(
        rejection(
          'DUPLICATE_SCRIPT_NAME',
          script.cardId,
          'name',
          `card script file "${script.fileName}" is already used by "${existing.cardName}" (${existing.cardId})`,
        ),
      );
      continue;
    }
    byFileName.set(script.fileName, script);
    files.push({ path: `cards/${script.fileName}`, contents: script.text });
  }
  return files;
}

/**
 * One file per token script, and a rejection when two tokens want the same file
 * with different contents inside it.
 *
 * By the time this runs the tokens are known to have distinct names —
 * `validateSetUniqueness` rejected the set above if any name described two
 * shapes — so the collision this catches is the one `forgeTokenScriptName`
 * introduces on its own: slugging and subtype-folding make Forge's namespace
 * coarser than the DSL's. See `DUPLICATE_TOKEN_SCRIPT` in `rejection.ts` for
 * why the two checks are not one. The advice therefore names both tokens rather
 * than telling an author to give them distinct names they already have.
 */
function collectTokenFiles(
  scripts: readonly ForgeCardScript[],
  rejections: TranspileRejection[],
): ForgeFile[] {
  const byScriptName = new Map<
    string,
    { readonly contents: string; readonly cardId: string; readonly tokenName: string }
  >();
  const files: ForgeFile[] = [];
  for (const script of scripts) {
    for (const token of script.tokens) {
      const scriptName = forgeTokenScriptName(token);
      const contents = transpileTokenScript(token);
      const existing = byScriptName.get(scriptName);
      if (existing !== undefined) {
        if (existing.contents !== contents) {
          rejections.push(
            rejection(
              'DUPLICATE_TOKEN_SCRIPT',
              script.cardId,
              'effects',
              `tokens "${existing.tokenName}" (card "${existing.cardId}") and "${token.name}" both write Forge token script "${scriptName}", with different contents; a Forge script name drops punctuation, lowercases, and folds away subtype words the name already spells, so pull the two apart on stats, colors, keywords, or a name that differs by more than that`,
            ),
          );
        }
        continue;
      }
      byScriptName.set(scriptName, { contents, cardId: script.cardId, tokenName: token.name });
      files.push({ path: `tokens/${scriptName}.txt`, contents });
    }
  }
  return files;
}
