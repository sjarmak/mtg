/** Evidence IO belongs to Node, while the compatibility contract stays browser-safe. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  PrintedPlayAdmissionSchema,
  PrintedPlayProbeReceiptSchema,
  PrintedPlaySubjectSchema,
  evaluatePrintedPlayAdmission,
  parsePrintedCardCatalog,
  parsePrintedFormat,
  parsePrintedLimitedFormat,
  serializedPrintedCardCatalogContent,
  serializedPrintedFormatContent,
} from '../index';
import type { PrintedFormat } from '../index';
import {
  scriptQualificationProbeResult,
  verifyPrintedScriptQualificationReceipt,
} from './script-qualification';
import { digestOf, memoizedReader } from './evidence-memo';

/**
 * A script-qualification receipt was measured against a Forge runtime other
 * than the one the caller is verifying against. That is a fact about the
 * admission's evidence going stale (a rebuilt bridge, a reinstalled Forge),
 * not a defect in the verifier or its caller, so it is a distinct type from
 * the other throws in this module: a caller may choose to treat it as a
 * refusal instead of a fatal error.
 */
export class PrintedAdmissionRuntimeMismatchError extends Error {}

type Admission = ReturnType<typeof PrintedPlayAdmissionSchema.parse>;
type AdmissionProbe = Admission['probes'][number];
type AlternativeEvidenceVerifier = (input: {
  readonly artifact: Admission;
  readonly probe: AdmissionProbe;
  readonly bytes: string | Uint8Array;
  readonly readEvidence: (relativePath: string) => string | Uint8Array;
}) => void;

function checkedEvidencePath(path: string): string {
  // Relative artifact identifiers only. The caller owns a confined artifact root;
  // these are not URLs, operating-system paths, or arbitrary read requests.
  if (
    !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/u.test(path) ||
    path.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new Error(`Invalid printed admission evidence path: ${path}`);
  }
  return path;
}

/** Caller supplies independently measured runtime identity and the complete catalog card IDs. */
export function verifyPrintedPlayAdmission(
  body: string,
  expectedSubject: unknown,
  requiredCardIds: readonly string[],
  readEvidence: (relativePath: string) => string | Uint8Array,
  verifyAlternativeEvidence?: AlternativeEvidenceVerifier,
) {
  const artifact = PrintedPlayAdmissionSchema.parse(JSON.parse(body));
  const read = memoizedReader(readEvidence);
  // Validate every reference before touching any evidence; never partially trust a manifest.
  const references = artifact.probes.flatMap((probe) =>
    probe.evidence === null
      ? []
      : [{ probe, ...probe.evidence, path: checkedEvidencePath(probe.evidence.path) }],
  );
  for (const reference of references) {
    const bytes = read(reference.path);
    const digest = digestOf(bytes);
    if (digest !== reference.sha256) {
      throw new Error(`Printed admission evidence checksum mismatch: ${reference.path}`);
    }
    if (reference.kind === 'script-qualification') {
      if (verifyAlternativeEvidence === undefined) {
        throw new Error(`Unsupported printed admission evidence kind: ${reference.path}`);
      }
      verifyAlternativeEvidence({ artifact, probe: reference.probe, bytes, readEvidence: read });
      continue;
    }
    let receipt;
    try {
      receipt = PrintedPlayProbeReceiptSchema.parse(
        JSON.parse(typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('utf8')),
      );
    } catch (cause) {
      throw new Error(`Invalid printed admission evidence receipt: ${reference.path}`, { cause });
    }
    const { evidence: _reference, ...claimedResult } = reference.probe;
    if (
      !isDeepStrictEqual(receipt.subject, artifact.subject) ||
      !isDeepStrictEqual(receipt.result, claimedResult)
    ) {
      throw new Error(`Printed admission evidence receipt mismatch: ${reference.path}`);
    }
  }
  return evaluatePrintedPlayAdmission(artifact, expectedSubject, requiredCardIds);
}

/** The Limited entry point, kept for the callers that hold a booster-shaped format. */
export function verifyPrintedLimitedPlayAdmission(
  body: string,
  formatInput: unknown,
  catalogInputs: readonly unknown[],
  measuredRuntime: unknown,
  readEvidence: (relativePath: string) => string | Uint8Array,
) {
  return verifyPrintedFormatPlayAdmission(
    body,
    parsePrintedLimitedFormat(formatInput),
    catalogInputs,
    measuredRuntime,
    readEvidence,
  );
}

/**
 * A format of either kind with its source catalogs, each checksum re-derived
 * from its own bytes and the catalogs returned in recipe order. This is the
 * identity every admission subject binds, so the probe runner, the admission
 * builder and the verifier all read one derivation of it.
 */
export function verifiedPrintedFormat(formatInput: unknown, catalogInputs: readonly unknown[]) {
  const format = parsePrintedFormat(formatInput);
  const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
  if (hash(serializedPrintedFormatContent(format)) !== format.contentSha256) {
    throw new Error('Printed admission format checksum mismatch');
  }
  const catalogs = catalogInputs.map(parsePrintedCardCatalog);
  const byFormat = new Map(catalogs.map((catalog) => [catalog.format, catalog]));
  if (byFormat.size !== catalogs.length || catalogs.length !== format.sources.length) {
    throw new Error('Printed admission requires exactly the recipe source catalogs');
  }
  const ordered = format.sources.map((source) => {
    const catalog = byFormat.get(source.catalogFormat);
    if (catalog === undefined) throw new Error(`Printed admission missing catalog: ${source.code}`);
    if (
      catalog.contentSha256 !== source.catalogSha256 ||
      hash(serializedPrintedCardCatalogContent(catalog)) !== source.catalogSha256
    ) {
      throw new Error(`Printed admission catalog checksum mismatch: ${source.code}`);
    }
    return catalog;
  });
  return { format, catalogs: ordered };
}

/**
 * Derive the subject and full printing population from independently loaded
 * catalogs, never from the evidence manifest or just the submitted deck.
 * The caller must measure the runtime it will launch; this does not attest a process.
 *
 * Either format kind: the subject binds a format's identity, its hash and its
 * source catalogs, and every printing in those catalogs is the population,
 * whether a product opens packs of them or a deck list names them.
 */
export function verifyPrintedFormatPlayAdmission(
  body: string,
  formatInput: unknown,
  catalogInputs: readonly unknown[],
  measuredRuntime: unknown,
  readEvidence: (relativePath: string) => string | Uint8Array,
) {
  const { format, catalogs: ordered } = verifiedPrintedFormat(formatInput, catalogInputs);
  const runtime = PrintedPlaySubjectSchema.omit({ formatId: true, formatSha256: true, catalogs: true }).parse(
    measuredRuntime,
  );
  const cards = ordered.flatMap((catalog) => catalog.cards);
  return verifyPrintedPlayAdmission(
    body,
    {
      ...runtime,
      formatId: format.id,
      formatSha256: format.contentSha256,
      catalogs: Object.fromEntries(format.sources.map((source) => [source.code, source.catalogSha256])),
    },
    cards.map((card) => card.physicalId),
    readEvidence,
    ({ artifact, probe, bytes, readEvidence: nestedReader }) => {
      const receipt = verifyPrintedScriptQualificationReceipt(bytes, nestedReader);
      if (!isDeepStrictEqual(receipt.runtime, runtime)) {
        throw new PrintedAdmissionRuntimeMismatchError(
          'Printed admission script qualification runtime mismatch',
        );
      }
      const cardIds = cards
        .filter(
          (card) =>
            card.forgeScript === receipt.sourceScript.path &&
            card.forgeScriptSha256 === receipt.sourceScript.sha256,
        )
        .map((card) => card.physicalId)
        .sort();
      if (cardIds.length === 0) {
        throw new Error(`Printed admission script qualification is foreign: ${receipt.sourceScript.path}`);
      }
      const expected = scriptQualificationProbeResult(receipt, probe.controller, cardIds);
      if (!isDeepStrictEqual(probe, { ...expected, evidence: probe.evidence })) {
        throw new Error(`Printed admission script qualification claim mismatch: ${probe.id}`);
      }
      if (!isDeepStrictEqual(artifact.subject.catalogs, subjectCatalogs(format))) {
        throw new Error('Printed admission script qualification catalog mismatch');
      }
    },
  );
}

function subjectCatalogs(format: PrintedFormat): Record<string, string> {
  return Object.fromEntries(format.sources.map((source) => [source.code, source.catalogSha256]));
}
