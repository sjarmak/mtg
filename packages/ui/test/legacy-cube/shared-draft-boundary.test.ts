/**
 * Legacy Cube is a data source for the ordinary draft journey, not a second
 * implementation of that journey. Keep this source-level boundary beside the
 * browser assertions: a screenshot can drift back toward parity while a
 * duplicate pack or builder remains available for a future branch to mount.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE = join(HERE, '..', '..', 'src', 'routes', 'legacy-cube', 'LegacyCubeRoute.ts');
const DRAFT_GAME = join(HERE, '..', '..', 'src', 'routes', 'draft', 'DraftGame.ts');
const BUILDER = join(HERE, '..', '..', 'src', 'routes', 'play', 'SealedBuilder.ts');
const STYLE_INDEX = join(HERE, '..', '..', 'src', 'styles', 'index.ts');
const LEGACY_STYLE = join(HERE, '..', '..', 'src', 'styles', 'legacy-cube.ts');

describe('the Legacy Cube draft UI boundary', () => {
  it('can only compose the shared pack and Limited builder screens', () => {
    const source = readFileSync(ROUTE, 'utf8');

    expect(source).toContain("from '../draft/DraftPack'");
    expect(source).toContain("from '../play/SealedBuilder'");
    expect(source).toContain('createElement(DraftPackSurface');
    expect(source).toContain('createElement(PhysicalLimitedBuilder');

    const builder = readFileSync(BUILDER, 'utf8');
    expect(builder.match(/createElement\(LimitedBuilderSurface/g)).toHaveLength(2);
    expect(builder.match(/className: 'mtg-play mtg-builder'/g)).toHaveLength(1);
    expect(builder.match(/className: 'mtg-builder__panes'/g)).toHaveLength(1);

    expect(source).not.toContain('function printedCard(');
    expect(source).not.toContain('function cardList(');
    expect(source).not.toContain("className: 'mtg-legacy-draft'");
    expect(source).not.toContain("className: 'mtg-legacy-build'");
    expect(source).not.toContain("className: 'mtg-legacy-card'");
    expect(source).not.toContain('DeckEditor');
    expect(source).not.toContain('PrintedCardImage');
    expect(source).not.toContain('printedCardImageFaces');
    // The positive half of the two lines above: the route draws the shared
    // printed face rather than an image component of its own. It used to be
    // pinned as `size: 'art'`, which was the art window the route handed the
    // bottom strip of a compact column; mtg-mxkrk took that drawing off every
    // pane, so the component is what the boundary can still name.
    expect(source).toContain('createElement(PrintedCardFace');

    const legacyStyle = readFileSync(LEGACY_STYLE, 'utf8');
    expect(legacyStyle).not.toContain('export const');
    expect(legacyStyle).not.toContain('.mtg-legacy-');
    expect(readFileSync(STYLE_INDEX, 'utf8')).not.toContain("from './legacy-cube'");
  });

  it('uses the ordinary draft launch affordance without naming its backend', () => {
    const route = readFileSync(ROUTE, 'utf8');
    const draft = readFileSync(DRAFT_GAME, 'utf8');

    expect(route).not.toContain('Start Forge match');
    expect(route).toContain('PLAY_FRESH_LEGACY_CUBE_GAME_LABEL');
    expect(draft).toContain('PLAY_DRAFTED_DECK_LABEL');
  });
});
