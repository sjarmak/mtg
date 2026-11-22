import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readForgeEditionTexts, readForgeScriptArchive } from '../src/printed-card/forge-install';
import {
  FORGE_SYNTAX_CLOSURE_SNAPSHOT_PATH,
  ForgeSyntaxClosureSnapshotSchema,
  buildForgeSyntaxClosureReport,
  compareForgeSyntaxClosure,
  parseForgeEditionCards,
} from '../src/printed-card/forge-syntax-closure';
import { loadForgeSyntaxReview } from '../src/printed-card/forge-syntax-review';

describe('Forge edition parsing', () => {
  it('reads code, name and distinct card names, dropping artists, comments and suffixed numbers', () => {
    const edition = parseForgeEditionCards(
      [
        '[metadata]',
        'Code=XYZ',
        'Name=Example Set',
        '',
        '[cards]',
        '#Bonus cards',
        '1 C Abbey Griffin @Jaime Jones',
        '1F R Arcane Signet @Gaboleps',
        'A4 R Retaliator Griffin',
        '1 C Abbey Griffin @Someone Else',
        '',
        '[tokens]',
        'w_1_1_spirit_flying',
      ].join('\n'),
    );
    expect(edition).toEqual({
      code: 'XYZ',
      name: 'Example Set',
      cards: ['Abbey Griffin', 'Arcane Signet', 'Retaliator Griffin'],
    });
  });

  it('refuses an edition without a code', () => {
    expect(() => parseForgeEditionCards('[cards]\n1 C Abbey Griffin\n')).toThrow(/Code or Name/u);
  });
});

describe('Forge syntax closure snapshot', () => {
  it('matches the committed per-edition closed counts (refresh with `npm run forge:closure -- --write-snapshot`)', () => {
    const snapshot = ForgeSyntaxClosureSnapshotSchema.parse(
      JSON.parse(readFileSync(FORGE_SYNTAX_CLOSURE_SNAPSHOT_PATH, 'utf8')),
    );
    const review = loadForgeSyntaxReview();
    expect(snapshot.forge).toEqual(review.forge);
    expect(snapshot.reviewedTokens).toBe(review.entries.length);
    const report = buildForgeSyntaxClosureReport({
      review,
      scripts: readForgeScriptArchive(),
      editions: readForgeEditionTexts(),
    });
    const { dropped, changed } = compareForgeSyntaxClosure(snapshot, report);
    expect(dropped).toEqual([]);
    expect(changed).toEqual([]);
    expect(report.editions.find((edition) => edition.code === 'ISD')).toMatchObject({
      scripted: 254,
      closed: 254,
      missing: [],
    });
    expect(report.editions.find((edition) => edition.code === 'ZEN')).toMatchObject({
      scripted: 234,
      closed: 234,
      missing: [],
    });
    // The Commander precons (`mtg-bc2.154.6.5.5`): every one of the 337
    // scripts is closed by the shared review since `mtg-bc2.154.6.5.7.1`
    // reviewed the 30 tokens (Amass, Encore, Goad, Populate among them) that
    // had held 31 of them open. Pinned so a Forge upgrade or a dropped entry
    // reopens this number rather than silently narrowing what a Commander
    // table could be handed.
    const scd = report.editions.find((edition) => edition.code === 'SCD');
    expect(scd).toMatchObject({ scripted: 337, closed: 337, missing: [] });
    // Scars of Mirrodin (`mtg-j4ucd.1`): the 26 tokens its 234 scripts left open were reviewed for it.
    const som = report.editions.find((edition) => edition.code === 'SOM');
    expect(som).toMatchObject({ scripted: 234, closed: 234, missing: [] });
    // Mirrodin Besieged (`mtg-j4ucd.4`): the 11 tokens its 150 scripts left open were reviewed for it.
    const mbs = report.editions.find((edition) => edition.code === 'MBS');
    expect(mbs).toMatchObject({ scripted: 150, closed: 150, missing: [] });
    // Rise of the Eldrazi (`mtg-j4ucd.6`): the 25 tokens its 233 scripts left open were reviewed for it
    // (Rebound mapped to optional-costs; Umbra armor, CantSacrifice and MinMaxBlocker among the non-choice entries).
    const roe = report.editions.find((edition) => edition.code === 'ROE');
    expect(roe).toMatchObject({ scripted: 233, closed: 233, missing: [] });
    // New Phyrexia (`mtg-j4ucd.5`): the 20 tokens its 170 scripts left open were reviewed for it.
    const nph = report.editions.find((edition) => edition.code === 'NPH');
    expect(nph).toMatchObject({ scripted: 170, closed: 170, missing: [] });
    // Magic 2012 (`mtg-j4ucd.7`): the 17 tokens its 234 scripts left open were reviewed for it
    // (Bloodthirst, CantTarget, SkipPhase and MultiplyCounter among the non-choice entries).
    const m12 = report.editions.find((edition) => edition.code === 'M12');
    expect(m12).toMatchObject({ scripted: 234, closed: 234, missing: [] });
    const m10 = report.editions.find((edition) => edition.code === 'M10');
    expect(m10).toMatchObject({ scripted: 234, closed: 234, missing: [] });
    // Dark Ascension (`mtg-j4ucd.8`): the 8 tokens its 158 scripts left open were reviewed for it
    // (ProtectionAll mapped to naming-text-numbers; NumLimitEachTurn, RemoveFromCombat and CantTransform among the non-choice entries).
    const dka = report.editions.find((edition) => edition.code === 'DKA');
    expect(dka).toMatchObject({ scripted: 158, closed: 158, missing: [] });
    // Avacyn Restored (`mtg-j4ucd.9`): the 16 tokens its 234 scripts left open were reviewed for it
    // (Soulbond mapped to zone-card-selection; CantPayLife, LifeLost and StoreSVar among the non-choice entries).
    const avr = report.editions.find((edition) => edition.code === 'AVR');
    expect(avr).toMatchObject({ scripted: 234, closed: 234, missing: [] });
    // Gatecrash (`mtg-j4ucd.10`): the 33 tokens its 249 scripts left open were reviewed for it (Evolve, Detain,
    // Extort, Unleash and the GTC-only static restrictions among the non-choice entries; Cipher mapped to its
    // Encode and Play families; Scavenge mapped to priority and targets). Its Return to Ravnica dependency
    // catalog (254 scripts) closes with it.
    const gtc = report.editions.find((edition) => edition.code === 'GTC');
    expect(gtc).toMatchObject({ scripted: 249, closed: 249, missing: [] });
    const rtr = report.editions.find((edition) => edition.code === 'RTR');
    expect(rtr).toMatchObject({ scripted: 254, closed: 254, missing: [] });
    const rav = report.editions.find((edition) => edition.code === 'RAV');
    expect(rav).toMatchObject({ scripted: 291, closed: 291, missing: [] });
    const gpt = report.editions.find((edition) => edition.code === 'GPT');
    expect(gpt).toMatchObject({ scripted: 165, closed: 165, missing: [] });
    // Dragon's Maze (`mtg-j4ucd.11`): the 15 tokens its 141 scripts left open were reviewed for it (Fuse mapped to
    // priority: the bridge offers the fused pair as a third hand ability; AssignNoCombatDamage and Evolved among the
    // non-choice entries). Its Gatecrash and Return to Ravnica dependency catalogs close with the sets above.
    const dgm = report.editions.find((edition) => edition.code === 'DGM');
    expect(dgm).toMatchObject({ scripted: 141, closed: 141, missing: [] });
    // Magic 2014 (`mtg-j4ucd.12`): the 7 tokens its 234 scripts left open were reviewed for it
    // (Reveal mapped to zone-card-selection and MinChoiceAmount to targets; AllowRepeats, ForgetDefined, ForgetOnCast, RemoveTypes and the Shadowborn Apostle deck keyword among the non-choice entries).
    const m14 = report.editions.find((edition) => edition.code === 'M14');
    expect(m14).toMatchObject({ scripted: 234, closed: 234, missing: [] });
    // Born of the Gods (`mtg-j4ucd.14`): the 19 tokens its 165 scripts left open were reviewed for it
    // (Bestow mapped to optional-costs, Tribute and Exchange to replacement-trigger-choices, MultiplePiles
    // to zone-card-selection; Untaps, ControlSpell and the plain-text protection/bookkeeping parameters
    // among the non-choice entries). Its Theros dependency catalog (234 scripts) closes with it.
    const bng = report.editions.find((edition) => edition.code === 'BNG');
    expect(bng).toMatchObject({ scripted: 165, closed: 165, missing: [] });
    // Theros (`mtg-j4ucd.13`): the 19 scripts its 234 scripts left open were reviewed for it
    // (Bestow mapped to optional-costs, the same alternate-cast-cost family as Flashback,
    // Cycling and Overload; Protection from blue, RevealNumber, UnlessDefender and
    // UntapOtherPlayer among the non-choice entries).
    const ths = report.editions.find((edition) => edition.code === 'THS');
    expect(ths).toMatchObject({ scripted: 234, closed: 234, missing: [] });
    // Journey into Nyx (`mtg-j4ucd.15`): 25 review entries were added for the 564 scripts of its three
    // catalogs (Strive mapped to targets and mana-x, Tribute and Exchange to replacement-trigger-choices,
    // MultiplePiles to zone-card-selection, ReplaceMana to naming-text-numbers; Untaps, ControlSpell and
    // the plain-text bookkeeping parameters among the non-choice entries). ControlSpell and MultiplePiles
    // keep the classification Born of the Gods landed: `forge-effect-controller-calls-v1.json` reads
    // ControlSpellEffect as calling no PlayerController method, and MultiplePilesEffect as calling only
    // chooseCardsForEffect, which `forge-controller-method-families-v1.json` maps to zone-card-selection
    // alone. Its Born of the Gods and Theros dependency catalogs close with it.
    const jou = report.editions.find((edition) => edition.code === 'JOU');
    expect(jou).toMatchObject({ scripted: 165, closed: 165, missing: [] });
    // Khans of Tarkir (`mtg-j4ucd.17`): the 8 tokens its 254 scripts left open were reviewed for it
    // (Outlast mapped to the PutCounter families it expands into; ChangesZoneAll, LookAt, FaceDown,
    // RememberCountered, ExtraTurn, Skip and the one-counter Raid etbCounter among the non-choice entries).
    const ktk = report.editions.find((edition) => edition.code === 'KTK');
    expect(ktk).toMatchObject({ scripted: 254, closed: 254, missing: [] });
    // Magic Origins (`mtg-j4ucd.18`): its 257 scripts left nine tokens open, all reviewed for it (Renown and
    // its BecomeRenowned trigger mode as non-choice, MayFlashCost mapped to optional-costs, and six
    // parameter keys: Alone, a filter on the reviewed Attacks trigger, and five read by the already mapped
    // Charm, ChooseCard and NameCard classes).
    const ori = report.editions.find((edition) => edition.code === 'ORI');
    expect(ori).toMatchObject({ scripted: 257, closed: 257, missing: [] });
    // Ixalan (`mtg-j4ucd.21`): the 5 tokens its 264 scripts left open were reviewed for it (Explores, the
    // trigger condition for "whenever a creature you control explores", distinct from the already-mapped
    // Explore effect that performs the reveal; CombatDamageToughness, PlayerMustAttack, NonLegendary and
    // RememberAmount among the non-choice entries).
    const xln = report.editions.find((edition) => edition.code === 'XLN');
    expect(xln).toMatchObject({ scripted: 264, closed: 264, missing: [] });
    // Kaladesh (`mtg-j4ucd.19`): 17 tokens were reviewed for its 254 scripts.
    // The load-bearing ones are energy and the Vehicles: the lane generalized
    // the already-reviewed Crew route to plain Vehicles and let a player pay
    // {E} as an ability, as a mana ability and as an unless-cost. One of the
    // 17, the parameter key ChooseEach, Ixalan's lane had reviewed independently
    // from a different card to the same non-choice verdict, which is why the
    // merged review table holds 961 entries and not 962. Pinned for the reason
    // ORI and XLN are: a Forge upgrade or a dropped review entry should reopen
    // this number rather than narrow it quietly.
    const kld = report.editions.find((edition) => edition.code === 'KLD');
    expect(kld).toMatchObject({ scripted: 254, closed: 254, missing: [] });
    // Aether Revolt (`mtg-j4ucd.20`): merged with Kaladesh into kld-aer. Its 184
    // scripts closed against the table Kaladesh had already built (Energy,
    // Vehicles, Crew, Fabricate) plus two new entries this lane added: Improvise
    // (mapped to mana-x and zone-card-selection, the same families Convoke
    // already carried — an artifact taps to pay the generic cost unconditionally,
    // never offering a color) and Revolt's own NoMoveRevealed parameter key
    // (non-choice bookkeeping). Revolt's keyword condition itself needed no new
    // entry: it reads state the kernel already tracks and asks no PlayerController
    // question. Kaladesh Inventions (`MPS_KLD`, the Masterpiece reprint sheet
    // Aether Revolt shipped alongside) closes with it at 54/54: every card on it
    // is a reprint whose script Kaladesh, Aether Revolt or an earlier reviewed
    // edition already closed.
    const aer = report.editions.find((edition) => edition.code === 'AER');
    expect(aer).toMatchObject({ scripted: 184, closed: 184, missing: [] });
    const mpsKld = report.editions.find((edition) => edition.code === 'MPS_KLD');
    expect(mpsKld).toMatchObject({ scripted: 54, closed: 54, missing: [] });
    const ala = report.editions.find((edition) => edition.code === 'ALA');
    expect(ala).toMatchObject({ scripted: 234, closed: 234, missing: [] });
    const c13 = report.editions.find((edition) => edition.code === 'C13');
    expect(c13).toMatchObject({ scripted: 340, closed: 340, missing: [] });
    const c16 = report.editions.find((edition) => edition.code === 'C16');
    expect(c16).toMatchObject({ scripted: 339, closed: 339, missing: [] });
    const c17 = report.editions.find((edition) => edition.code === 'C17');
    expect(c17).toMatchObject({ scripted: 299, closed: 299, missing: [] });
    const cma = report.editions.find((edition) => edition.code === 'CMA');
    expect(cma).toMatchObject({ scripted: 289, closed: 289, missing: [] });
    const cmm = report.editions.find((edition) => edition.code === 'CMM');
    expect(cmm).toMatchObject({ scripted: 737, closed: 737, missing: [] });
  }, 180_000);
});
