/** Closed controller-surface discovery for pinned printed-card catalogs. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  parsePrintedCardCatalog,
  serializedPrintedCardCatalogContent,
  type PrintedCardCatalogEntry,
} from '@mtg/printed-card';
import { inventoryForgeScriptSyntax } from '@mtg/printed-card/node';
import {
  classifyLegacyCubeForgeScript,
  type LegacyCubeDecisionSyntaxToken,
} from '../legacy-cube/decision-ledger';
import { loadForgeSyntaxReview } from './forge-syntax-review';
import { generatedTokenScriptNames } from './token-references';

const digest = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const unique = (values: readonly string[]): string[] => [...new Set(values)].sort();
const FileSchema = z.strictObject({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const PrintedDecisionInventoryScriptSchema = z.strictObject({
  sourceScript: FileSchema,
  physicalIds: z.array(z.string().min(1)).min(1),
  names: z.array(z.string().min(1)).min(1),
  families: z.array(z.string().min(1)).min(1),
  evidenceMarkers: z.array(z.string()),
  candidateProfile: z.string().regex(/^candidate-[a-f0-9]{16}$/u),
  decisionShape: z.array(z.string()),
  generatedDependencies: z.array(
    z.strictObject({
      name: z.string().min(1),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      dependencies: z.array(z.string().min(1)),
    }),
  ),
  reviewState: z.literal('candidate'),
});
export const PrintedDecisionInventorySchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('printed-controller-decision-inventory'),
  catalogs: z.array(z.strictObject({ format: z.string().min(1), contentSha256: FileSchema.shape.sha256 })),
  scripts: z.array(PrintedDecisionInventoryScriptSchema),
  residual: z.strictObject({
    unknownRootSyntax: z.array(z.string()),
    unknownDependencySyntax: z.array(z.string()),
    missingGeneratedDependencies: z.array(z.string()),
  }),
  summary: z.strictObject({
    physicalCards: z.number().int().nonnegative(),
    rootScripts: z.number().int().nonnegative(),
    candidateProfiles: z.number().int().nonnegative(),
    generatedDependencies: z.number().int().nonnegative(),
    qualifiedScripts: z.literal(0),
  }),
});
export type PrintedDecisionInventory = z.infer<typeof PrintedDecisionInventorySchema>;
const FIELD_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  Amount: ['mana-x', 'naming-text-numbers', 'targets'],
  AnyNumber: ['targets', 'zone-card-selection'],
  ChangeNum: ['zone-card-selection'],
  ChangeType: ['zone-card-selection'],
  Chooser: ['zone-card-selection'],
  Choices: ['modes', 'naming-text-numbers'],
  Destination: ['zone-card-selection'],
  DividedAsYouChoose: ['targets'],
  Hidden: ['zone-card-selection'],
  Mandatory: ['replacement-trigger-choices'],
  Max: ['mana-x', 'naming-text-numbers'],
  MaxRepeat: ['zone-card-selection'],
  MayChooseTarget: ['targets'],
  Min: ['mana-x', 'naming-text-numbers'],
  NumTargets: ['targets'],
  Optional: ['optional-costs', 'replacement-trigger-choices'],
  Origin: ['zone-card-selection'],
  SacValid: ['zone-card-selection'],
  TargetMax: ['targets'],
  TargetMin: ['targets'],
  TargetType: ['targets'],
  TargetsWithSameController: ['targets'],
  UnlessCost: ['optional-costs'],
  ValidCards: ['zone-card-selection'],
  ValidTgts: ['targets'],
};

function reviewedSyntax(): readonly LegacyCubeDecisionSyntaxToken[] {
  return loadForgeSyntaxReview().entries;
}

function candidateProfile(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): {
  readonly id: string;
  readonly decisionShape: readonly string[];
  readonly families: readonly string[];
} {
  const reviewedByKey = new Map(inventory.map((entry) => [`${entry.kind}:${entry.token}`, entry]));
  const mappedSyntax = inventoryForgeScriptSyntax(bytes)
    .map((entry) => reviewedByKey.get(`${entry.kind}:${entry.token}`))
    .flatMap((entry) => (entry?.disposition === 'mapped' ? [`${entry.kind}:${entry.token}`] : []));
  const classification = classifyLegacyCubeForgeScript(bytes, inventory);
  const familySet = new Set<string>(classification.families);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/^K:AlternateAdditionalCost:Reveal</mu.test(text)) familySet.add('cost-card-selection');
  const decisionShape = text
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith('#'))
    .flatMap((line) => line.split('|'))
    .flatMap((part) => {
      const match = part.trim().match(/^([^:$]+)\$\s*(.+)$/u);
      if (match?.[1] === undefined || match[2] === undefined) return [];
      const key = match[1].trim();
      const review = reviewedByKey.get(`parameter-key:${key}`);
      const value = match[2].trim().replace(/\s+/gu, ' ');
      if (key === 'Cost') {
        if (/^(?:[0-9]+|[WUBRGCX])(?:\s+(?:[0-9]+|[WUBRGCX]))*$/u.test(value)) return [];
        if (/(?:^|\s)ExileFromGrave</u.test(value)) familySet.add('cost-card-selection');
        return [`Cost$${value}`];
      }
      const relevantFamilies = FIELD_FAMILIES[key] ?? [];
      if (
        !relevantFamilies.some((family) => familySet.has(family)) &&
        (review === undefined || review.families.length === 0)
      )
        return [];
      return [`${key}$${value}`];
    })
    .sort();
  const id = `candidate-${digest(
    JSON.stringify({
      families: [...familySet],
      evidenceMarkers: classification.evidenceMarkers,
      mappedSyntax,
      decisionShape,
    }),
  ).slice(0, 16)}`;
  return { id, decisionShape, families: [...familySet] };
}

/**
 * Discovers reusable-profile candidates but deliberately qualifies no script.
 * Parameter-sensitive review and bilateral scenario evidence are the promotion boundary.
 */
export function buildPrintedDecisionInventory(
  catalogInputs: readonly unknown[],
  readScript: (path: string) => Uint8Array,
  readGeneratedScript: (name: string) => Uint8Array | undefined,
) {
  const catalogs = catalogInputs.map(parsePrintedCardCatalog);
  const syntax = reviewedSyntax();
  const cards = catalogs.flatMap((catalog) => {
    if (digest(serializedPrintedCardCatalogContent(catalog)) !== catalog.contentSha256)
      throw new Error(`Printed catalog checksum mismatch: ${catalog.format}`);
    return catalog.cards;
  });
  const cardsByScript = cards.reduce<ReadonlyMap<string, readonly PrintedCardCatalogEntry[]>>(
    (groups, card) => new Map(groups).set(card.forgeScript, [...(groups.get(card.forgeScript) ?? []), card]),
    new Map(),
  );
  const unknownRootSyntax: string[] = [];
  const unknownDependencySyntax: string[] = [];
  const missingGeneratedDependencies: string[] = [];
  const dependencyDigests = new Set<string>();

  const scripts = [...cardsByScript.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, scriptCards]) => {
      const bytes = readScript(path);
      const sha256 = digest(bytes);
      if (scriptCards.some((card) => card.forgeScriptSha256 !== sha256))
        throw new Error(`Printed root script checksum mismatch: ${path}`);
      const classification = classifyLegacyCubeForgeScript(bytes, syntax);
      const candidate = candidateProfile(bytes, syntax);
      unknownRootSyntax.push(...classification.unknownDecisionSyntax.map((entry) => `${path}:${entry}`));
      const dependencies: {
        readonly name: string;
        readonly sha256: string;
        readonly dependencies: readonly string[];
      }[] = [];
      const visited = new Set<string>();
      const visit = (name: string): void => {
        if (visited.has(name)) return;
        visited.add(name);
        const dependencyBytes = readGeneratedScript(name);
        if (dependencyBytes === undefined) {
          missingGeneratedDependencies.push(`${path}:${name}`);
          return;
        }
        const childNames = generatedTokenScriptNames(dependencyBytes);
        for (const child of childNames) visit(child);
        const dependencyClassification = classifyLegacyCubeForgeScript(dependencyBytes, syntax);
        unknownDependencySyntax.push(
          ...dependencyClassification.unknownDecisionSyntax.map((entry) => `${name}:${entry}`),
        );
        const dependencySha256 = digest(dependencyBytes);
        dependencyDigests.add(`${name}:${dependencySha256}`);
        dependencies.push({ name, sha256: dependencySha256, dependencies: childNames });
      };
      for (const name of generatedTokenScriptNames(bytes)) visit(name);
      const generatedDependencies = dependencies.sort((left, right) => left.name.localeCompare(right.name));
      const profileId =
        generatedDependencies.length === 0
          ? candidate.id
          : `candidate-${digest(JSON.stringify({ root: candidate.id, generatedDependencies })).slice(0, 16)}`;
      return {
        sourceScript: { path, sha256 },
        physicalIds: scriptCards.map((card) => card.physicalId).sort(),
        names: unique(scriptCards.map((card) => card.name)),
        families: candidate.families,
        evidenceMarkers: classification.evidenceMarkers,
        candidateProfile: profileId,
        decisionShape: candidate.decisionShape,
        generatedDependencies,
        reviewState: 'candidate' as const,
      };
    });
  const candidateProfiles = new Set(scripts.map((script) => script.candidateProfile)).size;
  return PrintedDecisionInventorySchema.parse({
    schemaVersion: 1 as const,
    kind: 'printed-controller-decision-inventory' as const,
    catalogs: catalogs.map((catalog) => ({
      format: catalog.format,
      contentSha256: catalog.contentSha256,
    })),
    scripts,
    residual: {
      unknownRootSyntax: unique(unknownRootSyntax),
      unknownDependencySyntax: unique(unknownDependencySyntax),
      missingGeneratedDependencies: unique(missingGeneratedDependencies),
    },
    summary: {
      physicalCards: cards.length,
      rootScripts: scripts.length,
      candidateProfiles,
      generatedDependencies: dependencyDigests.size,
      qualifiedScripts: 0,
    },
  });
}
