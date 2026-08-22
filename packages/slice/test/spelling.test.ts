/**
 * One spelling convention, over everything the repo writes in its own voice.
 *
 * `mtg-c77` made the lab's rendered strings American and stopped there, so the
 * rest of the tree kept writing `colour`, `behaviour`, `judgement` and
 * `normalised` in doc comments, docs, validator messages and report headings.
 * Two spellings in one tree is a small tax paid on every grep and every review,
 * and nothing failed when it drifted, because nothing looked.
 *
 * The convention is American, and `AGENTS.md` states it. This check is the part
 * that holds.
 *
 * **What it reads is git's index, not the directory tree.** Two reasons, and the
 * first one is that the tree holds files the repo did not write: `npm run play`
 * stages `packages/ui/public/set.json` from a fixture that spells `Flavour`, and
 * a gate that turns red because somebody played a game is a gate that gets
 * deleted. Every such artifact is already named in `.gitignore`, so tracked-ness
 * is the line, and it is a line somebody else maintains. The second is that a
 * directory walk matches on the bare name: the skip list this replaced held
 * `data` for the gitignored card store and silently took `packages/data` with
 * it, so a first-party package of 42 files sat outside the gate from the day it
 * was written.
 *
 * **What is out is written down, with a reason each, in two ledgers.**
 * `NOT_OUR_WORDS` holds whole paths, `EXCEPTIONS` holds single words in a single
 * file, and a stale entry in either fails a test rather than sitting there.
 * Three things need a word-level exception:
 *
 *   1. **Text that reaches a model.** A prompt is a model input, not decoration.
 *      `@mtg/llm`'s fixture key is `hash(system, prompt, schema)`, so editing one
 *      invalidates every recorded response behind it. That reaches further than
 *      the files with `prompt` in the name: setgen's repair loop hands a failing
 *      slot's findings back to the model, and a `CARD_INVALID` finding quotes the
 *      DSL violation verbatim, so `@mtg/dsl`'s validator messages are prompt text
 *      one hop away. Rewording any of it is a change to what the model is asked;
 *      it re-records fixtures and re-runs what depended on them.
 *   2. **Identifiers.** `honoursDistinctSlots`, `summariseArchetypes`,
 *      `unrecognised` and `'off-colour'` are exported API and one serialized
 *      union tag. Renaming them is a real change with its own blast radius —
 *      a serialized union tag reaches recorded eval reports — so it is a
 *      separate change and not part of this sweep.
 *   3. **Recorded output and quoted sources.** Fixtures, generated sets and
 *      reports, and the eval transcript say what actually came back; a source
 *      URL or a paper title says what someone else published. Rewriting either
 *      makes the record false.
 *
 * The check lives with `@mtg/slice` next to `workspace-roster.test.ts` for the
 * same reason: this is a fact about the whole workspace, and `@mtg/slice` is the
 * package that composes it. It reads the checkout it runs in, so a worktree
 * checks its own tree.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../', import.meta.url);

/** Extensions the repo writes prose in. Everything else is bytes or config. */
const SCANNED = ['.ts', '.js', '.md', '.py', '.yml', '.yaml', '.json', '.html'];

/**
 * Tracked paths that are still not the repo's own words, by prefix and reason.
 * A prefix that matches nothing fails a test, the same way a stale `EXCEPTIONS`
 * word does.
 */
const NOT_OUR_WORDS: readonly { readonly prefix: string; readonly why: string }[] = [
  {
    prefix: 'package-lock.json',
    why: 'written by npm from the registry, and 30k lines of it',
  },
  {
    prefix: 'packages/data/data/reference-sets-v1.json',
    why: 'normalized MTGJSON card records and rules text, kept as published rather than rewritten into the repo dialect',
  },
  {
    prefix: 'packages/slice/test/spelling.test.ts',
    why: 'the word list itself, matched by path so a future file of the same basename elsewhere is still checked',
  },
];

/**
 * `fixtures/` and `briefs/` hold recorded payloads and the model-authored brief,
 * all of it JSON. The `.ts` beside them is ours — a hand-written card set, a
 * generator — so it is checked like any other source.
 */
const RECORDED = /(^|\/)(fixtures|briefs)\//;

/**
 * British forms outside the `-ise` family, tested one lowercased word at a time.
 *
 * These stay enumerated because each is its own small closed set — the `-our`
 * nouns, the `-re` nouns, four `-ce` nouns, the two `l`-doubling directions —
 * and no shape generalizes them without swallowing `error`, `after` or `once`.
 * The `-ise` family is the one that does generalize, and `britishIse` below
 * states it as a rule rather than a list.
 */
const BRITISH: readonly RegExp[] = [
  // -our where American writes -or.
  /armour|ardour|behaviour|colour|endeavour|favour|flavour|harbour|honour|humour|labour|neighbour|odour|rumour|savour|splendour|valour|vapour/,
  // -re where American writes -er.
  /calibre|centre|fibre|litre|lustre|manoeuvre|metre|sceptre|spectre|theatre/,
  // -ce where American writes -se.
  /defence|licence|offence|pretence/,
  // British doubles the l before a suffix.
  /(cancell|counsell|fuell|jewell|labell|levell|marvell|modell|signall|totall|travell)(ed|ing|er|ers|ery|or|ors|ous)/,
  // …and drops one where American keeps two.
  /^(appal|distil|enrol|fulfil|instil)s?$/,
  /^(skilful|wilful)(ly|ness)?$/,
  // `analyses` and `analysis` are the American nouns, so they are spelled out.
  /^[a-z]*analys(e|ed|ing|er|ers)$/,
  // The rest, whole words or inside compounds.
  /acknowledgement|aluminium|artefact|draught|grey|judgement|plough|speciality|sulphur/,
  /^(ageing|cheque|cheques|kerb|kerbs|learnt|programme|programmes|spelt|storey|storeys|whilst)$/,
];

/**
 * The `-ise` family, stated as everything minus the words American also spells
 * with an `s`.
 *
 * That inversion is the point. The list of British stems is open — the
 * enumeration this replaced named sixty of them and still had no `palettise`,
 * `canonicalise`, `rasterise`, `synthesise`, `authorise`, `amortise` or
 * `ellipsise`, all seven of which were in the tree it was passing. The list of
 * English words whose `-ise` is not the British form of `-ize` is closed, and
 * this is it. Nearly all of them are verbs; the exceptions are nouns and
 * adjectives that merely end that way, `paradise`, `treatise`, `expertise`,
 * `concise`, `precise`, and `turquoise`, which arrived when a curation note
 * described the jewelry a card's subject should wear and the gate called a
 * color British.
 */
const AMERICAN_ISE = new Set([
  'advertise',
  'advise',
  'appraise',
  'apprise',
  'arise',
  'braise',
  'bruise',
  'chastise',
  'circumcise',
  'comprise',
  'compromise',
  'concise',
  'cruise',
  'demise',
  'despise',
  'devise',
  'disguise',
  'enfranchise',
  'enterprise',
  'excise',
  'exercise',
  'expertise',
  'franchise',
  'guise',
  'improvise',
  'incise',
  'liaise',
  'merchandise',
  'paradise',
  'poise',
  'praise',
  'precise',
  'premise',
  'prise',
  'promise',
  'raise',
  'reprise',
  'revise',
  'rise',
  'supervise',
  'surmise',
  'surprise',
  'televise',
  'treatise',
  'turquoise',
]);

/**
 * `-ise`, `-ised`, `-ising`, `-iser` and `-isation`, less the closed American
 * list above and two endings no British stem has: every `-wise` compound
 * (`otherwise`, `bitwise`), and `denoise`, which is a ComfyUI node parameter the
 * art workflows carry verbatim.
 *
 * The suffix has to end the word, which is what keeps `optimism`, `criticism`,
 * `realistic`, `characteristic`, `specialist`, `finalist` and the npm package
 * `minimist` out of the net.
 *
 * `AMERICAN_ISE` lists stems, and English prefixes them freely, so the lookup
 * tries the word's own base and then the base with one leading prefix removed.
 * Without that, `unexercised`, `unsurprised`, `uncompromising`, `undisguised`
 * and `reappraised` are all reported as British, which is how this was found:
 * a research report under `docs/` wrote "unexercised" and the gate called it a
 * British spelling of a word American English spells the same way. The
 * prefix list is closed and short on purpose — a general "strip any leading
 * letters" rule would let `reorganise` pass by finding `organise`'s tail, and
 * the whole point of the inversion above is that British stems are the open
 * set.
 */
const ISE_PREFIXES = /^(un|re|dis|mis|over|under|pre|co)/;

function britishIse(word: string): boolean {
  if (!/^[a-z]*is(e|es|ed|ing|er|ers|ation|ations)$/.test(word)) return false;
  const base = word.replace(/is(e|es|ed|ing|er|ers|ation|ations)$/, 'ise');
  if (AMERICAN_ISE.has(base) || /(?:no|w)ise$/.test(base)) return false;
  const unprefixed = base.replace(ISE_PREFIXES, '');
  return !AMERICAN_ISE.has(unprefixed);
}

/**
 * Files allowed to keep specific British words, spelled and cased exactly as
 * they survive, and why. Everything else in these files is still checked, so an
 * exception stays the size of its reason.
 */
const EXCEPTIONS: readonly {
  readonly path: string;
  readonly words: readonly string[];
  readonly why: string;
}[] = [
  // 1. Text that reaches a model.
  //
  // Not only the obvious prompt files. `@mtg/setgen`'s repair loop feeds a
  // failing slot's findings straight back to the model
  // (`feedbackForSlot` -> `corrections` -> `buildFillPrompt`), and a
  // CARD_INVALID finding quotes the DSL violation that produced it verbatim, so
  // a validator message is prompt text one hop away. Editing one moves the
  // fixture key and `packages/setgen/test/recorded-set.test.ts` stops replaying.
  {
    path: 'packages/dsl/src/validate/cost.ts',
    words: ['colours', 'colourless'],
    why: 'violation messages, quoted into a CARD_INVALID finding and fed back to the model on retry',
  },
  {
    path: 'packages/dsl/src/validate/effects.ts',
    words: ['capitalised', 'colours', 'colour', 'colourless'],
    why: 'violation messages, quoted into a CARD_INVALID finding and fed back to the model on retry',
  },
  {
    path: 'packages/dsl/src/validate/typeline.ts',
    words: ['capitalised'],
    why: 'violation messages, quoted into a CARD_INVALID finding and fed back to the model on retry',
  },
  {
    path: 'packages/setgen/src/validate/archetype.ts',
    words: ['colour'],
    why: 'finding messages, fed back to the model on retry',
  },
  {
    path: 'packages/setgen/src/validate/conformance.ts',
    words: ['colourless', 'coloured', 'colour'],
    why: 'finding messages, fed back to the model on retry',
  },
  {
    path: 'packages/setgen/src/validate/pie.ts',
    words: ['colourless', 'colour'],
    why: 'finding messages, fed back to the model on retry',
  },
  {
    path: 'packages/setgen/src/slot.ts',
    words: ['colourless'],
    why: '`describeSlot` writes the slot line every fill prompt is built from',
  },
  {
    path: 'packages/setgen/src/roles.ts',
    words: ['colourless'],
    why: "a role's substitution note, printed into the fill prompt as `note: …`",
  },
  {
    path: 'packages/setgen/src/prompts.ts',
    words: ['colour', 'colours', 'coloured', 'Colourless', 'judgement', 'flavour', 'capitalised'],
    why: 'prompt text; packages/setgen/fixtures/llm is keyed by the prompt hash',
  },
  {
    path: 'packages/decklab/src/select.ts',
    words: ['colours', 'coloured'],
    why: 'prompt text; rewording a prompt is a change to what the model is asked, not a copy-edit',
  },
  {
    path: 'packages/decklab/src/baseline.ts',
    words: ['Colours'],
    why: 'prompt text; rewording a prompt is a change to what the model is asked, not a copy-edit',
  },
  {
    path: 'packages/decklab/src/land-plan.ts',
    words: ['colours', 'Colours'],
    why: 'prompt text; rewording a prompt is a change to what the model is asked, not a copy-edit',
  },
  {
    path: 'packages/cube/src/propose.ts',
    words: ['colour', 'Colour', 'coloured', 'colours'],
    why: 'four sites, all of them model input: a CUBE_SYSTEM_LINES line, the archetype and shape lines `buildCubePrompt` assembles (the plural names the stated archetypes\' colours, e.g. "{WUBR}", the same set `measuredColors` in validate.ts measures the finished cube against), and the `off-color` rejection `detail`, which the same builder appends verbatim under "Your previous answer had these problems" on every repair round; packages/cube/fixtures/llm records the system and prompt that carry these',
  },
  {
    path: 'packages/cube/test/propose.test.ts',
    words: ['colour', 'Colour', 'colours', 'coloured'],
    why: 'asserts on the `off-color` rejection detail and on the color-balance prompt line, both quoted back verbatim from what `buildCubePrompt` sends the model',
  },

  // 2. Identifiers.
  {
    path: 'packages/decklab/src/audit.ts',
    words: ['colour'],
    why: "the AuditViolation kind 'off-colour', which is serialized into eval reports",
  },
  {
    path: 'packages/decklab/test/audit.test.ts',
    words: ['colour'],
    why: "asserts on the 'off-colour' kind",
  },
  {
    path: 'packages/decklab/src/eval.ts',
    words: ['judgement'],
    why: 'the `judgement` field of an eval outcome',
  },
  {
    path: 'packages/decklab/src/mana-cost.ts',
    words: ['unrecognised', 'COLOURLESS'],
    why: 'the `unrecognised` field of ParsedManaCost, which @mtg/decklab exports, and the COLOURLESS_SYMBOLS table',
  },
  {
    path: 'packages/decklab/test/mana-cost.test.ts',
    words: ['unrecognised'],
    why: 'asserts on the `unrecognised` field',
  },
  {
    path: 'packages/forge-export/src/sim-output.ts',
    words: ['unrecognised'],
    why: "the SimOutcome kind 'unrecognised'",
  },
  {
    path: 'packages/forge-export/test/sim-output.test.ts',
    words: ['unrecognised'],
    why: "asserts on the 'unrecognised' kind",
  },
  {
    path: 'packages/kernel/src/effects.ts',
    words: ['honoursDistinctSlots'],
    why: 'exported by @mtg/kernel',
  },
  {
    path: 'packages/kernel/src/legal.ts',
    words: ['honoursDistinctSlots'],
    why: 'calls the exported function',
  },
  {
    path: 'packages/forge-export/test/card-script.test.ts',
    words: ['honoursDistinctSlots'],
    why: 'names the exported function',
  },
  {
    path: 'packages/setgen/src/report.ts',
    words: ['summariseArchetypes'],
    why: 'exported by @mtg/setgen',
  },
  {
    path: 'packages/setgen/src/generate.ts',
    words: ['summariseArchetypes'],
    why: 'calls the exported function',
  },
  {
    path: 'packages/setgen/src/index.ts',
    words: ['summariseArchetypes'],
    why: 're-exports the function',
  },
  {
    path: 'packages/setgen/src/assemble.ts',
    words: ['normaliseEffects', 'NormalisedEffects', 'normalised'],
    why: 'the duplicate-effect helper, its result type, and the local holding that result',
  },
  {
    path: 'AGENTS.md',
    words: ['honoursDistinctSlots', 'summariseArchetypes', 'unrecognised', 'colour'],
    why: "the Spelling rule names the identifiers it exempts, including the 'off-colour' kind",
  },

  // 3. Recorded output and quoted sources.
  {
    path: 'docs/research/prior-art-set-design.md',
    words: ['colour'],
    why: 'a Blogatog permalink, which is somebody else’s URL',
  },
  {
    path: 'docs/research/prior-art-mtg-ai.md',
    words: ['Generalised'],
    why: 'the title of Bertram, Fürnkranz & Müller 2024, cited verbatim',
  },
  {
    path: 'docs/research/proposal-build-first.md',
    words: ['axised'],
    why: 'a coinage in the argued proposal: "re-axised" is cut along different axes, not a British -ise',
  },
  {
    path: 'docs/research/proposal-reuse-maximal.md',
    words: ['axised'],
    why: 'a coinage in the argued proposal: "re-axised" is cut along different axes, not a British -ise',
  },
];

interface Hit {
  readonly path: string;
  readonly line: number;
  readonly word: string;
}

function listPaths(args: readonly string[]): readonly string[] {
  let listed: string;
  try {
    listed = execFileSync('git', ['ls-files', '-z', ...args], {
      cwd: fileURLToPath(ROOT),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (cause) {
    throw new Error('the spelling check reads git’s index and `git ls-files` failed', { cause });
  }
  return listed.split('\0').filter((path) => path !== '');
}

/**
 * Every path in this checkout the repository wrote: what git tracks, plus what
 * this change is about to add to it.
 *
 * **The second half is the edge that reports green rather than not running.** A
 * new file that has not been `git add`-ed is not in the index, so the scanner
 * never opened it: write a test file, run the whole suite, watch it pass, then
 * stage and commit, and the gate never read the file it is now responsible for.
 * `aea0184` is that sequence — two spellings in the wrong dialect rode into
 * `18fca10` behind a full green run and surfaced only when a later branch was
 * gated in a worktree of its own. `--others --exclude-standard` closes it, and
 * `AGENTS.md`'s "stage first, then gate" is no longer a rule a person has to
 * remember.
 *
 * `.gitignore` is still honored, so generated output under `out/` and `data/`
 * stays outside the scan. That is what keeps this clear of the rule against a
 * gate whose verdict reads untracked state: everything the ignore file names is
 * still outside the listing, a file this adds can fail the check and cannot
 * silence it, and what it reads is the change being made rather than the
 * machine it is being made on.
 *
 * The refusal belongs to the tracked half alone. An empty untracked listing is
 * the ordinary state of a clean checkout; an empty index is a broken read.
 */
function readTrackedFiles(): readonly string[] {
  const tracked = listPaths([]);
  if (tracked.length === 0)
    throw new Error('`git ls-files` listed nothing, so this check would pass vacuously');
  return [...new Set([...tracked, ...listPaths(['--others', '--exclude-standard'])])].sort();
}

let indexed: readonly string[] | null = null;
let selected: readonly string[] | null = null;

/**
 * Every path in this checkout the repo wrote, tracked or about to be.
 *
 * Read once. Three of the four cases below want the list and the tree does not
 * change under a running test file, so asking git three times was three answers
 * to one question with three chances of being a different answer.
 */
function trackedFiles(): readonly string[] {
  indexed ??= readTrackedFiles();
  return indexed;
}

function scannedFiles(): readonly string[] {
  selected ??= trackedFiles().filter(
    (path) =>
      SCANNED.some((extension) => path.endsWith(extension)) &&
      !NOT_OUR_WORDS.some((entry) => path.startsWith(entry.prefix)) &&
      (!RECORDED.test(path) || path.endsWith('.ts')),
  );
  return selected;
}

function exceptionFor(path: string): readonly string[] {
  return EXCEPTIONS.find((entry) => entry.path === path)?.words ?? [];
}

/**
 * A word is British when any of its camelCase parts is. Splitting first is what
 * keeps `frameTreatment` (which contains `metre`) and `percentReduction` (which
 * contains `centre`) out of the results.
 */
function judge(word: string): boolean {
  return word.split(/(?<=[a-z])(?=[A-Z])/).some((part) => {
    const lower = part.toLowerCase();
    return britishIse(lower) || BRITISH.some((rule) => rule.test(lower));
  });
}

/**
 * The verdict per distinct spelling, not per occurrence.
 *
 * The tracked text is 46 MB and holds 3,648,877 word occurrences spelled 44,204
 * different ways: every word in this repository is written an average of 83
 * times, and `judge` was answering the same question about the same string 83
 * times over. It is a pure function of one word, so a cache over it runs the ten
 * patterns above on 1.2% as many inputs and returns exactly what it returned
 * before — the same files are read, the same words are examined, and a British
 * spelling in any of them fails the same way. Bypassing the cache and running the
 * gate over the same tree returns the same hit list, and a planted `colour` in
 * another file is still caught.
 *
 * Measured on a contended box, three other lanes running, at a 1-minute load
 * average of 13-15 on 16 cores: 1264ms before and 250ms after for the whole file,
 * against vitest's 5s default. It reached 1,998ms under a five-lane wave, which
 * is what put this file on mtg-w45's near-limit list.
 */
const VERDICTS = new Map<string, boolean>();

function isBritish(word: string): boolean {
  const remembered = VERDICTS.get(word);
  if (remembered !== undefined) return remembered;
  const verdict = judge(word);
  VERDICTS.set(word, verdict);
  return verdict;
}

function britishWordsIn(path: string): readonly Hit[] {
  const allowed = new Set(exceptionFor(path));
  const hits: Hit[] = [];
  readFileSync(new URL(path, ROOT), 'utf8')
    .split('\n')
    .forEach((text, index) => {
      for (const [word] of text.matchAll(/[A-Za-z]+/g)) {
        if (!allowed.has(word) && isBritish(word)) hits.push({ path, line: index + 1, word });
      }
    });
  return hits;
}

function format(hits: readonly Hit[]): string {
  return hits.map((hit) => `${hit.path}:${String(hit.line)}: ${hit.word}`).join('\n');
}

describe('the repo spells in one dialect', () => {
  it('writes American everywhere it writes its own words', () => {
    const hits = scannedFiles().flatMap(britishWordsIn);
    expect(format(hits), `${String(hits.length)} British spelling(s)`).toBe('');
  });

  it('states the convention in AGENTS.md, so the rule is readable and not just enforced', () => {
    const agents = readFileSync(new URL('AGENTS.md', ROOT), 'utf8');
    expect(agents).toContain('**Spelling.**');
  });

  it('leaves no workspace package outside the gate', () => {
    const scanned = scannedFiles();
    const packages = readdirSync(new URL('packages/', ROOT), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const unscanned = packages.filter(
      (name) => !scanned.some((path) => path.startsWith(`packages/${name}/`)),
    );
    expect(unscanned).toEqual([]);
  });

  it('keeps no exception it no longer needs', () => {
    const stale = EXCEPTIONS.flatMap((entry) => {
      const text = readFileSync(new URL(entry.path, ROOT), 'utf8');
      return entry.words
        .filter((word) => !text.includes(word))
        .map((word) => `${entry.path}: ${word} — kept for: ${entry.why}`);
    });
    const unused = NOT_OUR_WORDS.filter(
      (entry) => !trackedFiles().some((path) => path.startsWith(entry.prefix)),
    ).map((entry) => `${entry.prefix} — kept for: ${entry.why}`);
    expect([...stale, ...unused]).toEqual([]);
  });
});
