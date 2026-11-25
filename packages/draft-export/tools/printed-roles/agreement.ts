/**
 * `#305`: how far model-labeled roles agree with the authored AKH/HOU/MP2 profiles.
 *
 *   tsx packages/draft-export/tools/printed-roles/agreement.ts --roles <akh-hou roles file>
 *
 * The authored profiles are the only hand-written role labels in the tree, so
 * this is the one label-quality check available before roles reach a bot. It
 * counts one row per distinct card name, because the profiles are keyed by
 * name, and reports per-role precision, recall and Cohen's kappa with the
 * authored side as reference, followed by every disagreement so a person can
 * read which side was wrong. Agreement is not a strength claim: #21's paired
 * protocol is the measurement for that.
 */
import { readFileSync } from 'node:fs';
import { CARD_ROLES, validatePrintedCardRoles, type CardRole } from '../../src/index';
import akh from '../../src/limited-evaluation/profiles/akh.json';
import hou from '../../src/limited-evaluation/profiles/hou.json';
import mp2 from '../../src/limited-evaluation/profiles/mp2.json';
import { loadFormatCatalogs } from './label';

interface Row {
  readonly name: string;
  readonly authored: readonly CardRole[];
  readonly labeled: readonly CardRole[];
}

export function agreementRows(rolesInput: unknown): readonly Row[] {
  const catalogs = loadFormatCatalogs('akh-hou');
  const roles = validatePrintedCardRoles(rolesInput, catalogs);
  const profiles: Readonly<Record<string, { readonly roles: readonly CardRole[] }>> = {
    ...akh,
    ...hou,
    ...mp2,
  } as never;
  const rows = new Map<string, Row>();
  for (const { code, catalog } of catalogs) {
    const labeled = roles.catalogs.find((entry) => entry.code === code)!;
    for (const [index, card] of catalog.cards.entries()) {
      const profile = profiles[card.correctedName];
      if (profile === undefined || rows.has(card.correctedName)) continue;
      rows.set(card.correctedName, {
        name: card.correctedName,
        authored: profile.roles,
        labeled: labeled.cards[index]!.roles,
      });
    }
  }
  return [...rows.values()];
}

export function roleAgreement(rows: readonly Row[], role: CardRole) {
  let both = 0;
  let authoredOnly = 0;
  let labeledOnly = 0;
  for (const row of rows) {
    const a = row.authored.includes(role);
    const l = row.labeled.includes(role);
    if (a && l) both += 1;
    else if (a) authoredOnly += 1;
    else if (l) labeledOnly += 1;
  }
  const n = rows.length;
  const observed = (n - authoredOnly - labeledOnly) / n;
  const pa = (both + authoredOnly) / n;
  const pl = (both + labeledOnly) / n;
  const expected = pa * pl + (1 - pa) * (1 - pl);
  return {
    role,
    both,
    authoredOnly,
    labeledOnly,
    precision: both / (both + labeledOnly),
    recall: both / (both + authoredOnly),
    kappa: expected === 1 ? 1 : (observed - expected) / (1 - expected),
  };
}

function main(argv: readonly string[]): void {
  if (argv.length !== 2 || argv[0] !== '--roles') throw new Error('usage: agreement.ts --roles <file>');
  const rows = agreementRows(JSON.parse(readFileSync(argv[1]!, 'utf8')));
  const lines = [`${rows.length} distinct authored names`];
  for (const role of CARD_ROLES) {
    const r = roleAgreement(rows, role);
    lines.push(
      `${role}: both ${r.both}, authored only ${r.authoredOnly}, labeled only ${r.labeledOnly}, ` +
        `precision ${r.precision.toFixed(3)}, recall ${r.recall.toFixed(3)}, kappa ${r.kappa.toFixed(3)}`,
    );
  }
  lines.push('', 'disagreements (authored -> labeled):');
  for (const row of rows)
    if (row.authored.join() !== row.labeled.join())
      lines.push(`  ${row.name}: [${row.authored.join(', ')}] -> [${row.labeled.join(', ')}]`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (process.argv[1]?.endsWith('agreement.ts') === true) main(process.argv.slice(2));
