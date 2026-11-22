/** Offline integrity checks for the official 2021 MTGO Legacy Cube corpus. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_CUBE_PROVENANCE_PATH,
  LegacyCubeProvenanceSchema,
  correctedLegacyCubeRows,
  loadLegacyCubeProvenance,
  normalizedLegacyCubeRowsSha256,
  verifyForgeCubeSnapshot,
  verifyForgeScriptEntries,
  verifyLegacyCubeProvenance,
  verifyLegacyCubeSnapshot,
  verifyStoreIdentityLookup,
  type ForgeScriptEntry,
  type LegacyCubeProvenance,
} from '@mtg/data';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function copyOf(artifact: LegacyCubeProvenance): LegacyCubeProvenance {
  return structuredClone(artifact);
}

function pageSnapshot(artifact: LegacyCubeProvenance): Uint8Array {
  const changes = artifact.changeRows
    .map((row) => `<tr><td>${row.cardIn}</td><td>${row.cardOut}</td></tr>`)
    .join('\n');
  const cards = artifact.sourceRows
    .map((row) => `<tr><td>${row.name}</td><td>${row.color}</td></tr>`)
    .join('\n');
  const date = artifact.source.lastUpdatedOn.split('-');
  const html = `<!doctype html>
    <p>Last Updated: ${String(Number(date[1]))}/${String(Number(date[2]))}/${date[0]}</p>
    <h1 class="accordion"><em>Legacy Cube</em> Cardlist Changes</h1>
    <table><tbody>${changes}</tbody></table>
    <h1 class="accordion"><em>Legacy Cube</em> Full Cardlist</h1>
    <table><tbody>${cards}</tbody></table>`;
  return new TextEncoder().encode(html);
}

function forgeCubeSnapshot(artifact: LegacyCubeProvenance): Uint8Array {
  const names = correctedLegacyCubeRows(artifact).map((row) => row.correctedName);
  for (const contradiction of artifact.contradictions) {
    const official =
      contradiction.fullCardlist === 'card-in-present' ? contradiction.cardIn : contradiction.cardOut;
    const forge =
      contradiction.forgeCube2021August === 'card-in-present' ? contradiction.cardIn : contradiction.cardOut;
    names[names.indexOf(official)] = forge;
  }
  return new TextEncoder().encode(
    `[metadata]\nname=fixture\n[Main]\n${names.map((name) => `1 ${name}|TST`).join('\n')}\n`,
  );
}

describe('official 2021 MTGO Legacy Cube provenance', () => {
  const artifact = loadLegacyCubeProvenance();

  it('pins the complete Full Cardlist and both byte-level identities', () => {
    expect(LEGACY_CUBE_PROVENANCE_PATH).toMatch(/legacy-cube-2021-v1\.json$/);
    expect(artifact.source).toMatchObject({
      url: 'https://www.mtgo.com/legacy-cube-cardlist',
      publishedOn: null,
      lastUpdatedOn: '2021-08-19',
      publicationDateEvidence:
        "The page exposes only 'Last Updated: 8/19/2021'; no distinct publication date is present.",
      retrievedOn: '2026-09-03',
      rawBytes: 117_764,
      rawSha256: 'c06b50c4646e3418ae2503be44f1dc22b59d9f91ed85972020da59aa515e3dab',
      membershipAuthority: 'Full Cardlist',
    });
    expect(artifact.normalization).toEqual({
      version: 1,
      format: 'name-tab-color-lf-v1',
      sha256: 'c94e334fc7e0ac0368f51eec2c6c2c7c75ddef3ba7deffadab460c483e26ddd2',
    });
    expect(artifact.sourceRows).toHaveLength(600);
    expect(new Set(artifact.sourceRows.map((row) => row.name))).toHaveLength(600);
    expect(artifact.normalization.sha256).toBe(normalizedLegacyCubeRowsSha256(artifact.sourceRows));
    expect(LegacyCubeProvenanceSchema.parse(artifact)).toEqual(artifact);
    expect(() => verifyLegacyCubeProvenance(artifact)).not.toThrow();
  });

  it('preserves the source defect apart from its one reviewed correction', () => {
    expect(artifact.sourceRows[303]).toEqual({
      position: 304,
      name: 'Sulfuric Vortext',
      color: 'Red',
    });
    expect(artifact.reviewedCorrections).toEqual([
      {
        sourceName: 'Sulfuric Vortext',
        correctedName: 'Sulfuric Vortex',
        reason: 'The Full Cardlist misspells the printed card name; the Changes table spells it correctly.',
      },
    ]);
    expect(correctedLegacyCubeRows(artifact)[303]?.correctedName).toBe('Sulfuric Vortex');
  });

  it('records all three contradictions without using Forge as membership authority', () => {
    expect(artifact.contradictions).toEqual([
      {
        cardIn: 'Lonis, Cryptozoologist',
        cardOut: 'Oko, Thief of Crowns',
        changeRow: 37,
        fullCardlist: 'card-out-present',
        forgeCube2021August: 'card-in-present',
      },
      {
        cardIn: 'Palace Jailer',
        cardOut: 'Sublime Archangel',
        changeRow: 7,
        fullCardlist: 'card-out-present',
        forgeCube2021August: 'card-in-present',
      },
      {
        cardIn: 'Prismatic Vista',
        cardOut: 'Prismatic Lens',
        changeRow: 48,
        fullCardlist: 'card-in-present',
        forgeCube2021August: 'card-out-present',
      },
    ]);
    expect(artifact.forge.membershipAuthority).toBe(false);
    expect(artifact.identities).toHaveLength(600);
    expect(new Set(artifact.identities.map((row) => row.storeOracleId))).toHaveLength(600);
    expect(new Set(artifact.identities.map((row) => row.forgeScript))).toHaveLength(600);
  });

  it('rejects an unrecorded correction', () => {
    const changed = copyOf(artifact);
    changed.reviewedCorrections = [];
    expect(() => verifyLegacyCubeProvenance(changed)).toThrow(/unrecorded correction.*Sulfuric Vortext/i);
  });

  it('rejects duplicate and missing source rows even when the checksum is recomputed', () => {
    const duplicate = copyOf(artifact);
    duplicate.sourceRows[599] = { ...duplicate.sourceRows[599]!, name: duplicate.sourceRows[0]!.name };
    duplicate.normalization.sha256 = normalizedLegacyCubeRowsSha256(duplicate.sourceRows);
    expect(() => verifyLegacyCubeProvenance(duplicate)).toThrow(/duplicate.*Giver of Runes/i);

    const missing = copyOf(artifact);
    missing.sourceRows = missing.sourceRows.slice(0, -1);
    missing.normalization.sha256 = normalizedLegacyCubeRowsSha256(missing.sourceRows);
    expect(() => verifyLegacyCubeProvenance(missing)).toThrow(/exactly 600/i);
  });

  it('rejects a deleted Changes-table row', () => {
    const missing = copyOf(artifact);
    missing.changeRows = missing.changeRows.slice(0, -1);
    expect(() => verifyLegacyCubeProvenance(missing)).toThrow(/exactly 49 Changes rows/i);
  });

  it('rejects normalized and supplied-snapshot checksum drift', () => {
    const changed = copyOf(artifact);
    changed.sourceRows[0] = { ...changed.sourceRows[0]!, color: 'Blue' };
    expect(() => verifyLegacyCubeProvenance(changed)).toThrow(/normalized.*checksum/i);

    const snapshot = pageSnapshot(artifact);
    const syntheticPin = copyOf(artifact);
    syntheticPin.source.rawBytes = snapshot.byteLength;
    syntheticPin.source.rawSha256 = sha256(snapshot);
    expect(() => verifyLegacyCubeSnapshot(syntheticPin, snapshot)).not.toThrow();
    const drifted = new Uint8Array([...snapshot, 10]);
    expect(() => verifyLegacyCubeSnapshot(syntheticPin, drifted)).toThrow(/raw.*checksum/i);
  });

  it('detects order and color drift in a supplied snapshot independently of its raw checksum', () => {
    const ordered = pageSnapshot(artifact);
    const reorderedArtifact = copyOf(artifact);
    [reorderedArtifact.sourceRows[0], reorderedArtifact.sourceRows[1]] = [
      reorderedArtifact.sourceRows[1]!,
      reorderedArtifact.sourceRows[0]!,
    ];
    reorderedArtifact.sourceRows = reorderedArtifact.sourceRows.map((row, index) => ({
      ...row,
      position: index + 1,
    }));
    [reorderedArtifact.identities[0], reorderedArtifact.identities[1]] = [
      reorderedArtifact.identities[1]!,
      reorderedArtifact.identities[0]!,
    ];
    reorderedArtifact.identities = reorderedArtifact.identities.map((row, index) => ({
      ...row,
      position: index + 1,
    }));
    reorderedArtifact.source.rawBytes = ordered.byteLength;
    reorderedArtifact.source.rawSha256 = sha256(ordered);
    reorderedArtifact.normalization.sha256 = normalizedLegacyCubeRowsSha256(reorderedArtifact.sourceRows);
    expect(() => verifyLegacyCubeSnapshot(reorderedArtifact, ordered)).toThrow(
      /membership, order, or color drift/i,
    );
  });

  it('fails unresolved or ambiguous pinned-store identities', () => {
    const byName = new Map(
      artifact.identities.map((row) => [
        row.correctedName,
        [{ oracleId: row.storeOracleId, storedName: row.storeName }],
      ]),
    );
    const first = artifact.identities[0]!;
    byName.delete(first.correctedName);
    expect(() => verifyStoreIdentityLookup(artifact, (name) => byName.get(name) ?? [])).toThrow(
      /unresolved store identity.*Giver of Runes/i,
    );

    byName.set(first.correctedName, [
      { oracleId: first.storeOracleId, storedName: first.storeName },
      { oracleId: 'duplicate-oracle-id', storedName: first.storeName },
    ]);
    expect(() => verifyStoreIdentityLookup(artifact, (name) => byName.get(name) ?? [])).toThrow(
      /ambiguous store identity.*Giver of Runes/i,
    );
  });

  it('fails a missing or duplicate Forge card script', () => {
    const entries: ForgeScriptEntry[] = artifact.identities.map((row) => ({
      name: row.correctedName,
      path: row.forgeScript,
    }));
    expect(() => verifyForgeScriptEntries(artifact, entries.slice(1))).toThrow(
      /missing Forge script.*Giver of Runes/i,
    );
    expect(() =>
      verifyForgeScriptEntries(artifact, [
        ...entries,
        { name: entries[0]!.name, path: `duplicate/${entries[0]!.path}` },
      ]),
    ).toThrow(/duplicate Forge script.*Giver of Runes/i);
  });

  it('accepts only the three recorded bundled-Forge membership differences', () => {
    const deck = forgeCubeSnapshot(artifact);
    const pinned = copyOf(artifact);
    pinned.forge.bundledCube.sha256 = sha256(deck);
    expect(() => verifyForgeCubeSnapshot(pinned, deck)).not.toThrow();

    const changed = new TextEncoder().encode(
      new TextDecoder().decode(deck).replace('Giver of Runes', 'Absent Card'),
    );
    pinned.forge.bundledCube.sha256 = sha256(changed);
    expect(() => verifyForgeCubeSnapshot(pinned, changed)).toThrow(/differences exceed/i);
  });
});
