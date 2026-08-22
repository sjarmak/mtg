// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { createElement as h } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EXPECTED_CALIBRATION_PROFILE_VERSION,
  EXPECTED_REFERENCE_PROFILE_VERSION,
  calibrationPayloadText,
  canonicalJsonText,
  classifyCalibration,
  classifyRetune,
  readCalibrationArtifact,
  readRetuneArtifact,
  sha256Text,
} from '../../src/routes/analysis/calibration-read';
import {
  CalibrationEvidencePanel,
  CalibrationPanel,
  RetuneEvidencePanel,
} from '../../src/routes/analysis/calibration';
import type { CalibrationArtifact, RetuneArtifact } from '../../src/routes/analysis/calibration-model';
import { AnalysisSurface } from '../../src/routes/analysis/AnalysisView';
import { LabApp } from '../../src/dev/LabApp';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { hashSource } from '../../src/app/router';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const METRIC_IDS = [
  'creature-rate',
  'removal-density',
  'interaction-density',
  'fixing-density',
  'mean-mana-value',
  'mean-stat-efficiency',
  'mean-oracle-words',
  'mean-ability-lines',
  'keyword-density',
  'decision-marker-density',
  'combat-keyword-share',
  'bomb-risk-proxy',
  'unplayable-risk-proxy',
  'mana-curve-0',
  'mana-curve-1',
  'mana-curve-2',
  'mana-curve-3',
  'mana-curve-4',
  'mana-curve-5',
  'mana-curve-6',
  'mana-curve-7+',
] as const;
const CONTEXT_IDS = new Set([
  'creature-rate',
  'fixing-density',
  'mean-stat-efficiency',
  'combat-keyword-share',
]);

const METRICS = METRIC_IDS.map((id, index) => ({
  id,
  unit: 'share' as const,
  subject: {
    value: index / 100,
    population: { id: 'nonlands', count: 201, description: 'Nonland cards.' },
  },
  anchors: [
    {
      setCode: 'M11' as const,
      exactValue: 0.2,
      band: { lower: 0.15, upper: 0.25 },
      population: { id: 'nonlands', count: 229, description: 'M11 nonland cards.' },
    },
    {
      setCode: 'M13' as const,
      exactValue: 0.22,
      band: { lower: 0.17, upper: 0.27 },
      population: { id: 'nonlands', count: 229, description: 'M13 nonland cards.' },
    },
  ],
  target: { lower: 0.17, upper: 0.25 },
  status: index === 0 ? ('below' as const) : index === 20 ? ('above' as const) : ('inside' as const),
  deltaToBand: index === 0 ? -0.17 : index === 20 ? 0.01 : 0,
  resolution: 'intersection' as const,
  rationale: 'The checked anchor bands overlap.',
  scope: CONTEXT_IDS.has(id) ? ('reference-context' as const) : ('canonical-target' as const),
}));

const REFERENCES = [
  'M11',
  'M13',
  'M15',
  'M20',
  'ORI',
  'ISD',
  'RTR',
  'RAV',
  'ROE',
  'SOM',
  'KTK',
  'MH2',
] as const;

const FINDINGS = [
  {
    id: 'vantia-field-medic',
    name: 'Vantia Field Medic',
    rarity: 'common',
    status: 'healthy' as const,
    basis: 'The card does not cross the versioned static warning proxy.',
    observations: 1 as const,
    anchors: [
      { setCode: 'M11' as const, flagged: 6, population: 155 },
      { setCode: 'M13' as const, flagged: 8, population: 157 },
    ],
  },
  {
    id: 'blank-bauble',
    name: 'Blank Bauble',
    rarity: 'common',
    status: 'weak-risk' as const,
    basis: 'The card crosses the versioned static weak-card warning proxy.',
    observations: 1 as const,
    anchors: [
      { setCode: 'M11' as const, flagged: 6, population: 155 },
      { setCode: 'M13' as const, flagged: 8, population: 157 },
    ],
  },
  {
    id: 'ancient-dragon',
    name: 'Ancient Dragon',
    rarity: 'rare',
    status: 'bomb-risk' as const,
    basis: 'The card crosses the versioned static bomb warning proxy.',
    observations: 1 as const,
    anchors: [
      { setCode: 'M11' as const, flagged: 5, population: 44 },
      { setCode: 'M13' as const, flagged: 7, population: 44 },
    ],
  },
];

function artifact(): CalibrationArtifact {
  return {
    schemaVersion: 1,
    payloadDigest: '0'.repeat(64),
    profileVersion: EXPECTED_CALIBRATION_PROFILE_VERSION,
    harnessVersion: 'static-profile-consumer-v1',
    profileDigest: '7850c31fad7a62bc37465c13a291d37ffdcb012801bf176fbabc93edc660b44e',
    referenceProfileVersion: EXPECTED_REFERENCE_PROFILE_VERSION,
    sourceCorpus: { provider: 'MTGJSON', version: '5.2.2+20260812', builtDate: '2026-08-12' },
    subject: {
      code: 'XMP',
      name: 'the flagship set',
      fingerprint: 'sha256:xmp',
      source: 'the staged executable set',
      evidence: {
        kind: 'static-proxy',
        caveat: 'Exact census and deterministic proxies, not gameplay or human evidence.',
      },
    },
    primaryCore: {
      policyVersion: 'primary-core-static-tolerance-v1',
      precedence: 'M13',
      caveat: 'M11 and M13 remain separately visible.',
      metrics: METRICS,
    },
    references: REFERENCES.map((code, index) => ({
      code,
      name: `Reference ${code}`,
      role:
        index < 2
          ? ('primary-core' as const)
          : index < 5
            ? ('secondary-core' as const)
            : index === 11
              ? ('stress-only' as const)
              : ('expansion' as const),
      mainSetSize: 249,
      cardFaceRecords: 249,
      provenance: { provider: 'MTGJSON', sourceVersion: '5.2.2+20260812', builtDate: '2026-08-12' },
      evidence: {
        kind: 'static-proxy' as const,
        caveat: 'No native games or human draft results are claimed.',
      },
      metrics: METRICS.map((metric) => ({
        id: metric.id,
        unit: metric.unit,
        subject: metric.subject.value,
        reference: 0.2,
        delta: metric.subject.value - 0.2,
        population: { id: 'nonlands', count: 229, description: `${code} nonland cards.` },
      })),
    })),
    findings: {
      population: {
        id: 'executable-cards',
        count: FINDINGS.length,
        description: 'Executable subject cards.',
      },
      evidence: {
        kind: 'static-proxy',
        uncertainty: 'Deterministic census proxy; no confidence interval applies.',
        caveat: 'A warning is not gameplay strength or human draft evidence.',
      },
      cards: FINDINGS,
    },
    formats: {
      draft: {
        status: 'static-only',
        evidence: 'Original booster collation and static as-fan are available.',
        caveat: 'No native draft games or human draft evidence are present.',
        collation: {
          status: 'unavailable',
          population: { id: 'executable-cards', count: 253, description: 'Executable subject cards.' },
          reason: 'No checked booster collation is carried by the executable set.',
        },
        mechanicAsFan: {
          status: 'unavailable',
          population: { id: 'executable-cards', count: 253, description: 'Executable subject cards.' },
          reason: 'No checked booster collation was supplied.',
        },
        archetypeSupport: {
          status: 'checked',
          population: { id: 'main-cards', count: 253, description: 'Executable subject cards.' },
          pairs: [
            {
              pair: 'WU',
              exactMulticolorCards: 4,
              firstColorCards: 31,
              secondColorCards: 29,
              fixingCards: 8,
              supportShare: 0.28,
            },
          ],
          evidence: 'Exact card-supply proxy; not gameplay evidence.',
        },
      },
      sealed: {
        status: 'unavailable',
        evidence: 'No sealed calibration artifact is present.',
        caveat: 'Draft proxies are not substituted for sealed evidence.',
      },
      native: {
        status: 'subject-executable',
        subjectCards: 253,
        anchorCards: { M11: 0, M13: 0 },
        evidence: 'All subject cards parse as executable DSL cards.',
        caveat: 'No M11 or M13 card is counted as natively exact until its semantics execute in the kernel.',
      },
      human: {
        status: 'unavailable',
        observations: 0,
        evidence: 'No human checkpoint artifact is present.',
        caveat: 'Bot and static evidence are not presented as human preference.',
      },
    },
  };
}

function retune(): RetuneArtifact {
  return {
    schemaVersion: 1,
    profileVersion: EXPECTED_CALIBRATION_PROFILE_VERSION,
    profileDigest: '7850c31fad7a62bc37465c13a291d37ffdcb012801bf176fbabc93edc660b44e',
    setCode: 'XMP',
    proposalId: 'xmp-retune-1',
    baseline: { fingerprint: 'sha256:xmp', runId: 'xmp-before' },
    candidate: { fingerprint: 'sha256:after', runId: 'xmp-after' },
    changes: [
      {
        kind: 'card',
        id: 'vantia-field-medic',
        label: 'Vantia Field Medic',
        field: 'manaCost',
        before: '{1}{W}',
        after: '{2}{W}',
      },
      {
        kind: 'deck',
        id: 'sky-islands',
        label: 'The Sky Islands',
        field: 'vantia-field-medic copies',
        before: 4,
        after: 2,
      },
    ],
    evidence: {
      kind: 'simulation',
      beforeSamples: 1200,
      afterSamples: 1200,
      measurementStatus: 'measured',
      gateStatus: 'pass',
      uncertaintyStatus: 'measured',
      uncertainty: '95% Wilson intervals, same pinned schedule and seeds.',
      caveat: 'Human approval is still required.',
    },
  };
}

async function addressedArtifact(fingerprint = 'sha256:xmp'): Promise<CalibrationArtifact> {
  const original = artifact();
  const value = { ...original, subject: { ...original.subject, fingerprint } };
  return { ...value, payloadDigest: await sha256Text(calibrationPayloadText(value)) };
}

async function readdress(value: CalibrationArtifact): Promise<CalibrationArtifact> {
  return { ...value, payloadDigest: await sha256Text(calibrationPayloadText(value)) };
}

describe('the calibration artifact boundary', () => {
  it('computes the same SHA-256 without SubtleCrypto on a plain HTTP origin', async () => {
    for (const value of ['', 'abc', 'the flagship set', '解放された劍']) {
      expect(await sha256Text(value, {})).toBe(createHash('sha256').update(value, 'utf8').digest('hex'));
    }
  });

  it('verifies and rejects addressed calibration payloads without SubtleCrypto', async () => {
    vi.stubGlobal('crypto', {});
    const ready = await addressedArtifact();
    expect(await classifyCalibration(ready, { code: 'XMP', fingerprint: 'sha256:xmp' })).toMatchObject({
      status: 'ready',
    });
    expect(
      await classifyCalibration(
        { ...ready, unaddressedClaim: 'This field was not produced.' },
        { code: 'XMP', fingerprint: 'sha256:xmp' },
      ),
    ).toMatchObject({ status: 'invalid' });
  });

  it('accepts the complete 12-profile, 21-metric document', () => {
    const read = readCalibrationArtifact(artifact());
    expect(read.references).toHaveLength(12);
    expect(read.primaryCore.metrics).toHaveLength(21);
    expect(read.primaryCore.metrics.filter((metric) => metric.scope === 'canonical-target')).toHaveLength(17);
  });

  it('keeps stale distinct from invalid and absent', async () => {
    const ready = await addressedArtifact();
    expect(await classifyCalibration(null, { code: 'XMP', fingerprint: 'sha256:xmp' })).toEqual({
      status: 'absent',
    });
    const stale = await readdress({ ...ready, profileVersion: 'reference-static-v0' });
    expect(await classifyCalibration(stale, { code: 'XMP', fingerprint: 'sha256:xmp' })).toMatchObject({
      status: 'stale',
    });
    expect(
      await classifyCalibration(await readdress({ ...ready, profileDigest: '0'.repeat(64) }), {
        code: 'XMP',
        fingerprint: 'sha256:xmp',
      }),
    ).toMatchObject({
      status: 'stale',
    });
    expect(
      await classifyCalibration({ ...ready, references: [] }, { code: 'XMP', fingerprint: 'sha256:xmp' }),
    ).toMatchObject({
      status: 'invalid',
    });
    expect(await classifyCalibration(ready, { code: 'XMP', fingerprint: 'sha256:xmp' })).toMatchObject({
      status: 'ready',
    });
  });

  it('rejects same-code sets with another fingerprint and payloads changed after addressing', async () => {
    const ready = await addressedArtifact();
    expect(
      await classifyCalibration(ready, { code: 'XMP', fingerprint: 'sha256:another-xmp' }),
    ).toMatchObject({ status: 'stale' });
    const first = ready.primaryCore.metrics[0];
    expect(first).toBeDefined();
    const tampered = {
      ...ready,
      primaryCore: {
        ...ready.primaryCore,
        metrics: [
          { ...first, subject: { ...first?.subject, value: 0.99 } },
          ...ready.primaryCore.metrics.slice(1),
        ],
      },
    };
    expect(await classifyCalibration(tampered, { code: 'XMP', fingerprint: 'sha256:xmp' })).toMatchObject({
      status: 'invalid',
    });
    expect(
      await classifyCalibration(
        { ...ready, unaddressedClaim: 'This field was not produced.' },
        { code: 'XMP', fingerprint: 'sha256:xmp' },
      ),
    ).toMatchObject({ status: 'invalid' });
  });

  it('rejects non-finite numbers and oversized hostile copy at the boundary', () => {
    const hostile = artifact();
    const first = hostile.primaryCore.metrics[0];
    expect(first).toBeDefined();
    expect(() =>
      readCalibrationArtifact({
        ...hostile,
        primaryCore: {
          ...hostile.primaryCore,
          metrics: [{ ...first, subject: { ...first?.subject, value: Number.POSITIVE_INFINITY } }],
        },
      }),
    ).toThrow(/finite number/);
    expect(() =>
      readCalibrationArtifact({ ...hostile, subject: { ...hostile.subject, name: 'x'.repeat(501) } }),
    ).toThrow(/subject\.name/);
    expect(() => readCalibrationArtifact({ ...hostile, profileDigest: 'not-a-digest' })).toThrow(/SHA-256/);
    expect(() =>
      readCalibrationArtifact({
        ...hostile,
        findings: {
          ...hostile.findings,
          population: { ...hostile.findings.population, count: 1_001 },
          cards: Array.from({ length: 1_001 }, (_, index) => ({
            ...FINDINGS[0],
            id: `hostile-${String(index)}`,
          })),
        },
      }),
    ).toThrow(/findings\.cards/);
  });

  it('requires the card-level denominator and honest native and human evidence blocks', () => {
    const value = readCalibrationArtifact(artifact());
    expect(value.findings.population.count).toBe(3);
    expect(value.findings.cards.map((finding) => finding.status)).toEqual([
      'healthy',
      'weak-risk',
      'bomb-risk',
    ]);
    expect(value.formats.native.anchorCards).toEqual({ M11: 0, M13: 0 });
    expect(value.formats.human.observations).toBe(0);
    expect(value.findings.evidence.uncertainty).toMatch(/no confidence interval/i);
  });
});

describe('CalibrationPanel', () => {
  it('shows separate M11 and M13 values, all 21 statuses, and denominators', () => {
    render(
      h(CalibrationPanel, { artifact: artifact(), referenceCode: 'M11', onSelectReference: () => undefined }),
    );
    expect(screen.getByRole('heading', { name: 'Primary core envelope' })).toBeTruthy();
    expect(screen.getAllByText('M11')).not.toHaveLength(0);
    expect(screen.getAllByText('M13')).not.toHaveLength(0);
    expect(screen.getAllByText(/n=201/)).toHaveLength(21);
    expect(screen.getAllByText(/inside|below|above/)).toHaveLength(21);
  });

  it('labels all references and changes the selected comparison semantically', () => {
    const selected: string[] = [];
    render(
      h(CalibrationPanel, {
        artifact: artifact(),
        referenceCode: 'M11',
        onSelectReference: (code) => selected.push(code),
      }),
    );
    for (const code of REFERENCES)
      expect(screen.getByRole('option', { name: new RegExp(code) })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reference set'), { target: { value: 'MH2' } });
    expect(selected).toEqual(['MH2']);
  });

  it('keeps draft and sealed separate and refuses to turn static proxies into confidence', () => {
    render(
      h(CalibrationPanel, { artifact: artifact(), referenceCode: 'M13', onSelectReference: () => undefined }),
    );
    expect(screen.getByRole('heading', { name: 'Draft evidence' })).toBeTruthy();
    expect(screen.getByText(/No native draft games/)).toBeTruthy();
    expect(screen.getAllByText(/No checked booster collation/)).toHaveLength(2);
    expect(screen.getByText(/Exact card-supply proxy/)).toBeTruthy();
    expect(screen.getByText(/WU · 4 multicolor · 8 fixing · n=253/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sealed evidence' })).toBeTruthy();
    expect(screen.getByText(/not substituted for sealed/)).toBeTruthy();
    expect(screen.getByText(/no confidence interval/i)).toBeTruthy();
  });

  it('shows card findings with their one-card and anchor denominators', () => {
    render(
      h(CalibrationPanel, { artifact: artifact(), referenceCode: 'M11', onSelectReference: () => undefined }),
    );
    expect(screen.getByRole('heading', { name: 'Card-level static findings' })).toBeTruthy();
    expect(screen.getByText('Blank Bauble')).toBeTruthy();
    expect(screen.getByText('Ancient Dragon')).toBeTruthy();
    expect(screen.getAllByText(/n=1 card/)).toHaveLength(3);
    expect(screen.getAllByText(/M11 6\/155/)).toHaveLength(2);
    expect(screen.getByText(/no confidence interval/i)).toBeTruthy();
  });

  it('states native coverage and the missing human checkpoint without borrowing either claim', () => {
    render(
      h(CalibrationPanel, { artifact: artifact(), referenceCode: 'M13', onSelectReference: () => undefined }),
    );
    expect(screen.getByRole('heading', { name: 'Native execution evidence' })).toBeTruthy();
    expect(screen.getByText(/M11 0 · M13 0/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Human evidence' })).toBeTruthy();
    expect(screen.getByText(/No human checkpoint artifact/)).toBeTruthy();
  });
});

describe('Analysis calibration workflow', () => {
  it('draws absent, stale, and invalid as different artifact states', () => {
    for (const state of [
      { status: 'absent' as const },
      { status: 'stale' as const, message: 'Profile version is old.' },
      { status: 'invalid' as const, message: 'references[0] is missing.' },
    ]) {
      cleanup();
      render(
        h(CalibrationEvidencePanel, {
          state,
          referenceCode: 'M11',
          onSelectReference: () => undefined,
        }),
      );
      const region: unknown = screen.getByRole('region', { name: 'Reference calibration' });
      expect((region as { getAttribute: (name: string) => string | null }).getAttribute('data-state')).toBe(
        state.status,
      );
    }
  });

  it('does not claim a proposal is absent when calibration prevented examination', () => {
    render(
      h(RetuneEvidencePanel, {
        state: { status: 'blocked', message: 'Calibration must be ready before retune can be examined.' },
      }),
    );
    expect(screen.getByText(/must be ready before retune can be examined/i)).toBeTruthy();
    expect(screen.queryByText(/No retune proposal is staged/i)).toBeNull();
  });

  it('overrides an absent proposal with blocked when calibration could not be examined', () => {
    render(
      h(AnalysisSurface, {
        runs: { status: 'absent' },
        games: { status: 'absent' },
        calibration: { status: 'invalid', message: 'Payload checksum mismatch.' },
        retune: { status: 'absent' },
        route: { mode: 'analysis', params: { section: 'calibration' } },
        onSetParams: () => undefined,
      }),
    );
    expect(screen.getByText(/must be ready before retune evidence can be examined/i)).toBeTruthy();
    expect(screen.queryByText(/No retune proposal is staged/i)).toBeNull();
  });

  it('remains available when no simulation run has been produced yet', () => {
    render(
      h(AnalysisSurface, {
        runs: { status: 'absent' },
        games: { status: 'absent' },
        calibration: { status: 'ready', artifact: artifact() },
        retune: { status: 'absent' },
        route: { mode: 'analysis', params: { section: 'calibration' } },
        onSetParams: () => undefined,
      }),
    );
    expect(screen.getByRole('heading', { name: 'Primary core envelope' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Proposed retune evidence' })).toBeTruthy();
    expect(screen.queryByText('Nothing measured yet')).toBeNull();
  });

  it('loads calibration.json through LabApp without importing the Node producer into the browser', async () => {
    const setDocument = { set: { code: 'XMP', name: 'the flagship set' }, cards: EXAMPLE_CARDS };
    const fingerprint = `sha256:${await sha256Text(canonicalJsonText(setDocument))}`;
    const calibration = await addressedArtifact(fingerprint);
    const source = hashSource();
    if (source === null) throw new Error('this test needs a browser location');
    source.location.hash = '#/analysis?section=calibration';
    vi.stubGlobal('fetch', (url: string) => {
      if (url === 'calibration.json') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(calibration) });
      }
      if (url === 'set.json') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(setDocument),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });
    render(
      h(LabApp, {
        cards: EXAMPLE_CARDS,
        setUrl: 'set.json',
        calibrationUrl: 'calibration.json',
        retuneUrl: 'retune.json',
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Primary core envelope' })).toBeTruthy();
    expect(await screen.findByText(/No retune proposal is staged/)).toBeTruthy();
  });
});

describe('retune evidence', () => {
  it('reads and displays exact card and deck before/after changes with simulation samples', () => {
    const value = readRetuneArtifact(retune());
    render(h(RetuneEvidencePanel, { state: { status: 'ready', artifact: value } }));
    expect(screen.getByText('Vantia Field Medic')).toBeTruthy();
    expect(screen.getByText('{1}{W}')).toBeTruthy();
    expect(screen.getByText('{2}{W}')).toBeTruthy();
    expect(screen.getByText(/1,200 before · 1,200 after/)).toBeTruthy();
    expect(screen.getByText(/Measurement measured; gate pass; uncertainty measured/)).toBeTruthy();
    expect(screen.getByText(/95% Wilson/)).toBeTruthy();
  });

  it('distinguishes absent, stale, invalid, and under-sampled proposals', () => {
    for (const state of [
      { status: 'blocked' as const, message: 'Calibration must be ready before retune can be examined.' },
      { status: 'absent' as const },
      { status: 'stale' as const, message: 'Profile version is old.' },
      { status: 'invalid' as const, message: 'changes[0].before is missing.' },
      {
        status: 'underSampled' as const,
        artifact: { ...retune(), evidence: { kind: 'none' as const, caveat: 'No paired run yet.' } },
      },
    ]) {
      cleanup();
      render(h(RetuneEvidencePanel, { state }));
      const region: unknown = screen.getByRole('region', { name: 'Proposed retune evidence' });
      expect((region as { getAttribute: (name: string) => string | null }).getAttribute('data-state')).toBe(
        state.status,
      );
    }
  });

  it('classifies an optional proposal against the staged calibration version and set', () => {
    expect(classifyRetune(null, artifact())).toEqual({ status: 'absent' });
    expect(classifyRetune({ ...retune(), profileVersion: 'reference-static-v0' }, artifact())).toMatchObject({
      status: 'stale',
    });
    expect(classifyRetune({ ...retune(), changes: [] }, artifact())).toMatchObject({ status: 'invalid' });
    expect(
      classifyRetune({ ...retune(), evidence: { kind: 'none', caveat: 'No paired run yet.' } }, artifact()),
    ).toMatchObject({ status: 'underSampled' });
    expect(
      classifyRetune(
        { ...retune(), evidence: { ...retune().evidence, uncertaintyStatus: 'under-sampled' } },
        artifact(),
      ),
    ).toMatchObject({ status: 'underSampled' });
    expect(classifyRetune(retune(), artifact())).toMatchObject({ status: 'ready' });
  });

  it('refuses zero-sample, same-run, and no-op simulation proposals as ready evidence', () => {
    expect(
      classifyRetune({ ...retune(), evidence: { ...retune().evidence, beforeSamples: 0 } }, artifact()),
    ).toMatchObject({ status: 'invalid' });
    expect(
      classifyRetune(
        {
          ...retune(),
          candidate: { fingerprint: retune().baseline.fingerprint, runId: 'candidate-distinct-run' },
        },
        artifact(),
      ),
    ).toMatchObject({ status: 'invalid' });
    expect(
      classifyRetune(
        {
          ...retune(),
          candidate: { fingerprint: 'candidate-distinct-fingerprint', runId: retune().baseline.runId },
        },
        artifact(),
      ),
    ).toMatchObject({ status: 'invalid' });
    expect(
      classifyRetune(
        {
          ...retune(),
          changes: [{ ...retune().changes[0], after: retune().changes[0]?.before }],
        },
        artifact(),
      ),
    ).toMatchObject({ status: 'invalid' });
  });
});
