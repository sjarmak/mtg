/**
 * The one canonicalizer, and the fingerprints that must not move because of it.
 *
 * `@mtg/llm` declared a second `canonicalJson` until mtg-bc2.135 merged the two.
 * The merge was free only because the copies were measured identical, and the
 * measurement is worth keeping: both callers hash what this function returns, so
 * a change to it is never local. A moved `cardFingerprint` silently un-dedupes a
 * generated set, and a moved fixture key orphans every recorded response behind
 * it (`packages/slice/test/canonical-json.test.ts` holds that half).
 *
 * The table below is the fingerprint corpus. It is the hashes the sixteen
 * example cards carry now, written down so a later edit to the canonicalizer,
 * to `normalize`, or to a card's shape fails here by name instead of being
 * noticed the next time a set generates duplicates.
 *
 * It has moved once. Slice A of the ability model (mtg-bc2.132.1) gave every
 * card an `abilities` field, and `normalize` is a deny list, so the field
 * reached both hashes for all sixteen. The move was measured rather than
 * accepted: deleting `abilities` from the normalized record reproduces every
 * pre-slice-A hash exactly, here and across the ninety cards in the committed
 * set, so the new field is the whole of the difference. No fixture key moved,
 * because `fixtureKey` hashes a request and never a card.
 *
 * It has moved twice. `mtg-bc2.152.6` gave `ManaCostSchema` an `hasX` field and
 * `Card` a `costReduction` field, both `.default`/`.nullable().default(null)`,
 * so both are present on every parsed card whether or not it uses either — the
 * same shape the `abilities` move above took, and the same conclusion: neither
 * field is in `ALWAYS_OMITTED`, deliberately, because a printed cost reduction
 * or an `{X}` cost is exactly the kind of mechanical change `mechanicalFingerprint`
 * exists to catch, unlike `flavorText`. The move reaches every card, including
 * the ones that print neither, the same way `abilities` did.
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/canonical-json';
import { cardFingerprint, mechanicalFingerprint } from '../src/fingerprint';
import { EXAMPLE_CARDS, EXAMPLE_CARDS_BY_ID } from '../src/examples';

/** `[card id, cardFingerprint, mechanicalFingerprint]`, re-measured at slice A. */
const FINGERPRINTS: readonly (readonly [string, string, string])[] = [
  [
    'slc-skywatch-sentinel',
    'd5fa4fc8f18df52dc30e2bf53d0e11eba46be3edbe55eaa0f3bbc65fb9d29292',
    'e04b42311f5dcd2154d466031d012495140caadb5ad878670b8a7fe862fa7345',
  ],
  [
    'slc-radiant-charge',
    'ea2367dac67754aeb612730018bad43551de8687dc73c152e33c92fe46fa201f',
    '7359758d0a529577b55d401ec3185a50bbcbd635b355b4c857ed6f7f7eefe091',
  ],
  [
    'slc-lifebound-cleric',
    'd8467232368a2d38507873fbd6db1b24641f6aead2bbaeb282bf45bc247d001b',
    '6e16ee65a5ae7d80053ae878ebb6996f3ebfd1190267a3156d5fb7c26368380d',
  ],
  [
    'slc-windrider-drake',
    'b9ed05c72e3cfb8a4df064bd60c7a4e27d166a007762f87a8d1bb87d2d4cbf23',
    'e1a4548fe2e02154c6e9df23a29a481aa9c4f777afd7582af9d8870ba6627b67',
  ],
  [
    'slc-dissolving-word',
    '6e57363060a5b0fd68223b2390d9a40e2dd1c8764981362d67fea6207b5efe3c',
    'bbca0c18e5939b40aafcbc68610b9e77dd2ecc002a21f8540f3cb14f4e6200ab',
  ],
  [
    'slc-frostbind-current',
    'c6a8ad6473bff396290af5a5941ca4c8bd9749f5ae8733c19a310799b17450f7',
    '890d790f76c3cb3fa747b3a959ca7da2672a1dc480c57e8965213890c7d2b831',
  ],
  [
    'slc-undertow-snare',
    'ce964a47d06435976de54dcf57ae5a861c7a700a2b1fd32b4a0fd4a62b94a74d',
    '6ac772f246584e2b03da5879e0d25c3ce627a15fe65d591f618bc48536302262',
  ],
  [
    'slc-graveblade-stalker',
    '1586ebbe5521cd5f0d4c0429db518c54da57296ad7129c6d36bb9fea1d26b192',
    '704db2b65a1c878bc9b8ed774e494ae0807992cba203515d968561934f1fdc16',
  ],
  [
    'slc-mortal-verdict',
    '0037e5e62843e335b12820a8ec9cf31b54d77fdb49b34ab308d0334dd9ba73e7',
    '4a96402f4950f70e726dc94556ba74f048d93d3eaa9cbd19c4ca067af32f9d95',
  ],
  [
    'slc-grasping-mire',
    '16fd68ed8c8a8c86abfffda71d0142d75c61ca4ffadbeb959b493503ac3a2a3c',
    '6dfb235f3f4df6ad2e699bc15fa98090c9a1ef0e1def4e5a3d14e191581895c8',
  ],
  [
    'slc-emberflow-raider',
    '2a8700fada20b03b5b5617d86dd9dccd40ed368facacd8cefb2419d5fbee88b4',
    '3a6efe33af87a42c7f7ae0fb69fb6bab92c4a9fa507a2d41e6fba1fb5ce25884',
  ],
  [
    'slc-lightning-lash',
    '8fc8088b0b4ec7d181df25737e9cd590b2aea3434a19c9be5c6ef9203351b9a8',
    '59c68b37a242f6365410e085fbb23e08d92fceba1de5e1a30d3bc26ce12bc597',
  ],
  [
    'slc-thornhide-guardian',
    '8a447c20711d66c967eb4fba4718ff83262a13f81618b838e72affa0f3f89f11',
    'ef72d0c0c2268f2fe7614bf2c44ac3dfe3c60104d4eb09863a5dab5b98d649bd',
  ],
  [
    'slc-wild-summons',
    '2cdc5ca87acead7d606ada3ba7636c0e6424f1cdafd938bc84d801fb09e148a5',
    'f121388eae39f9a9b8c73796ff56fcba2c0e1b13121c6e3f0cebd78cd3618ea0',
  ],
  [
    'slc-ironclad-golem',
    'e927d373b03b5e7196203a8f0bd22021e768312fc896e59912f4a13ca81584f5',
    'bb8d95c6a6c935c488a3cfe77a7cda2eeb90e13b3ab943643a17dffb35c32f63',
  ],
  [
    'slc-bronze-monument',
    '82afc712ee8c0087ddcf1c4a631678b09451c72bf47789c8a27529a0015aa106',
    'a40624d8cf13ca641a612f7af03b57dc227e9352cc1d640c9b4a7c43873b208b',
  ],
  [
    'slc-heartwood-graft',
    'a53ab7a170ecb8861d5bbe6f958a3bf036d768c2395507fe17ffd042cd126a73',
    '5263e399bf2c18c47525ded057fdf7fa9eb98bd576e9baf30a5cceace1e014f7',
  ],
];

describe('canonicalJson', () => {
  it('sorts keys at every depth and drops undefined members', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it('sorts inside arrays and leaves array order alone, which carries meaning', () => {
    expect(canonicalJson([{ z: 1, a: 2 }, 'x', null])).toBe('[{"a":2,"z":1},"x",null]');
    expect(canonicalJson([2, 1])).toBe('[2,1]');
  });

  it('renders an array hole as null and a top-level undefined as no string at all', () => {
    // The second is the one input the merged copies disagreed on: `@mtg/llm`
    // coalesced it to 'null'. No caller can reach it — `fixtureKey` and
    // `cardFingerprint` both serialize an object — and the tests below are what
    // says so for the fingerprints.
    expect(canonicalJson([1, undefined, 2])).toBe('[1,null,2]');
    expect(canonicalJson(undefined)).toBeUndefined();
  });
});

describe('the fingerprint corpus', () => {
  it('covers every example card, so nothing below passes vacuously', () => {
    expect(FINGERPRINTS.length).toBe(EXAMPLE_CARDS.length);
    expect(FINGERPRINTS.map(([id]) => id).sort()).toEqual(EXAMPLE_CARDS.map((card) => card.id).sort());
  });

  it('hashes every example card to the value recorded above', () => {
    const moved = FINGERPRINTS.filter(([id, printed, mechanical]) => {
      const card = EXAMPLE_CARDS_BY_ID.get(id);
      if (card === undefined) return true;
      return cardFingerprint(card) !== printed || mechanicalFingerprint(card) !== mechanical;
    });
    expect(moved.map(([id]) => id)).toEqual([]);
  });

  it('serializes every example card as an object, which is why no fingerprint meets the hole above', () => {
    const notObjects = EXAMPLE_CARDS.filter((card) => !canonicalJson(card).startsWith('{'));
    expect(notObjects.map((card) => card.id)).toEqual([]);
  });
});
