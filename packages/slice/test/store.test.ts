import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASIC_LANDS, EXAMPLE_SET, exampleCard } from '@mtg/dsl';
import { closeStore, openStore, storeStats } from '@mtg/data';
import { runStoreStage, toLabCard } from '@mtg/slice';
import { removeDir, tempDir } from './helpers';

describe('the optional lab-card store', () => {
  it('projects a DSL creature onto the store shape', () => {
    const card = exampleCard('slc-emberflow-raider');
    const lab = toLabCard(card);
    expect(lab.oracleId).toBe(card.id);
    expect(lab.name).toBe(card.name);
    expect(lab.manaValue).toBeGreaterThan(0);
    expect(lab.typeLine).toContain('Creature');
    expect(lab.power).toBe(String(card.power));
    expect(lab.toughness).toBe(String(card.toughness));
    expect(lab.printing?.setCode).toBe(card.set.code);
  });

  it('leaves lands without a mana cost and gives them their produced colors', () => {
    const land = BASIC_LANDS[0];
    expect(land).toBeDefined();
    if (land === undefined || land.kind !== 'land') return;
    const lab = toLabCard(land);
    expect(lab.manaCost).toBeNull();
    expect(lab.power).toBeNull();
    expect(lab.colorIdentity).toStrictEqual([...land.producesMana]);
  });

  it('writes every card into a real store under source = lab, idempotently', () => {
    const dir = tempDir('mtg-slice-store-');
    try {
      const path = join(dir, 'lab.sqlite');
      expect(runStoreStage(EXAMPLE_SET, path).cardsWritten).toBe(EXAMPLE_SET.length);
      // Re-running the loop over the same set must not duplicate rows.
      runStoreStage(EXAMPLE_SET, path);

      const store = openStore(path);
      try {
        const stats = storeStats(store);
        expect(stats.oracleCards).toBe(EXAMPLE_SET.length);
        expect(stats.labCards).toBe(EXAMPLE_SET.length);
        expect(stats.printings).toBe(EXAMPLE_SET.length);
      } finally {
        closeStore(store);
      }
    } finally {
      removeDir(dir);
    }
  });
});
