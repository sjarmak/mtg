#!/usr/bin/env -S npx tsx
/** Compare an executable DSL set against every pinned static reference profile. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  deriveCardSetProfile,
  loadReferenceProfileArtifact,
  profileScalarDiff,
  type StaticSetProfile,
} from '@mtg/data';
import { cardManaValue, renderOracleText } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { parseSetFile, type SetFile } from '../src/index';

function typesOf(card: Card): string[] {
  if (card.kind === 'creature') return card.artifact ? ['Artifact', 'Creature'] : ['Creature'];
  return [card.kind[0]?.toUpperCase() + card.kind.slice(1)];
}

export function profileExecutableSet(set: SetFile, source: string): StaticSetProfile {
  return deriveCardSetProfile({
    code: set.set.code,
    name: set.set.name,
    cards: set.cards.map((card) => ({
      id: card.id,
      name: card.name,
      rarity: card.rarity,
      colors: card.colors,
      colorIdentity: card.colors,
      types: typesOf(card),
      keywords: card.keywords,
      text: card.oracleText ?? renderOracleText(card),
      ...(card.kind === 'land' ? {} : { manaValue: cardManaValue(card) }),
      ...(card.kind === 'creature' ? { power: card.power, toughness: card.toughness } : {}),
    })),
    provenance: { kind: 'executable-dsl', source },
  });
}

export function runReferenceProfileDiff(path: string): void {
  const input = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  const subject = profileExecutableSet(parseSetFile(input), path);
  console.log(`${JSON.stringify(profileScalarDiff(subject, loadReferenceProfileArtifact()), null, 2)}\n`);
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(invoked).href) {
  const path = process.argv[2];
  if (path === undefined) {
    console.error('usage: npm run reference:diff -- <executable-set.json>');
    process.exitCode = 1;
  } else {
    runReferenceProfileDiff(path);
  }
}
