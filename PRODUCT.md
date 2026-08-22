# Product

## Register

product

The default is product for Analysis, Deck and Replay: these are instruments, and
the tool should disappear into the task. Play and Cards are the stated
exception. A card face and a battlefield are the thing a person came for, not
chrome around it, and `mtg-bc2.46` is open precisely because the play surface
currently reads like an instrument. Treat those two routes as a surface where
design is part of the experience; treat everything else as a working tool.

## Users

One person, so far: the developer designing a Magic set and deciding whether it
is any good. Technical, fluent in the domain, reading the lab on a desktop
monitor beside a terminal that just finished a run. They are never a first-time
user needing onboarding, and they are frequently cross-referencing what the
screen says against a JSONL file or a metric gate they wrote themselves.

The job differs by route:

- **Analysis, Deck, Replay**: judge a run. "Did this set's color pairs land
  inside the band, and if not, which card is dragging it?" The answer has to be
  legible against the underlying data, because the next step is usually editing
  a generator input and running it again.
- **Play, Cards**: play the set, or look at it. This is where the work becomes
  the thing it was for. A person here is not auditing; they are seeing whether
  the set is fun.

Later: other people playing generated sets, and drafting against bots. Nothing
in the interface should assume a single seat forever.

## Product Purpose

A laboratory for Magic set design and play. Generate a set from desired
mechanics, build decks against real card data, simulate thousands of games,
assert playability as a CI gate, then sit down and play the result.

Success is that the loop closes without leaving the lab: a person changes a
generator input, re-runs, and can see in one screen whether the change helped.
Failure is a dashboard that reports a verdict a person has to go elsewhere to
understand.

## Brand Personality

Precise, evidence-first, unhurried. The interface states what it measured and
what it did not, and it does not perform confidence it has not earned.

The play surface carries a second voice: paper Magic on a table. Physical cards
with real depth and shadow, a ground that reads as a surface rather than a
background fill, a card face that looks printed rather than rendered. The serif
card font and the rarity seal already point this way; the board has not caught
up.

Nothing in the lab celebrates. A passing gate is a fact, not a win.

## Anti-references

- **The generic SaaS dashboard.** Hero-metric tiles, gradient accents, identical
  card grids, an icon beside every heading. Several of these are banned outright
  by the shared design laws; all of them are banned here.
- **Neon-on-black gamer dark mode.** Saturated glow, hard black, RGB accents.
  The dark palette is a soft cool gray at hue 265 and stays that way.
- **Fan-site clutter.** Competing panels, ad-shaped chrome, five type sizes per
  screen. This is the failure mode of most existing Magic tooling and the reason
  the lab exists as its own surface.
- **Wizards' official brand.** Also IP hygiene, not only taste: the lab is
  private and non-commercial under the Fan Content Policy, and looking like the
  real product cuts against that. Theme indirection is retired (`mtg-bc2.150`,
  2026-08-11), so the flagship set names its source outright; staying off the
  official look is a policy line, not a hedge about the theme.

## Design Principles

1. **Absent and broken are different states, and neither is a blank page.** A
   checkout that has never run a build gets the command to type. A document that
   failed its schema gets the field that failed. This is already enforced in
   `DeckRoute` and should hold everywhere.
2. **Every number carries its denominator.** A rate prints beside the sample it
   came from, and a statistic with too little evidence says so instead of
   reporting a confident value off four games. A grayed-out bar still reads as a
   measurement; a sentence does not.
3. **Provenance sits beside the claim.** "Black is 78% castable" is unactionable
   alone. The number appears with the sources it was computed from and the card
   that demanded them, or it does not appear.
4. **Unfinished announces itself.** A generative backlog rots silently unless
   every incomplete surface is labeled. A card with no art renders a hatched
   frame carrying its own id, so a screenshot of a set in progress is
   self-describing and a missing render never passes for a design choice.
5. **The instrument disappears; the game does not.** Consistency and density are
   virtues on the analysis routes. On the play routes they are not the point.

## Accessibility & Inclusion

WCAG 2.2 AA.

- Contrast holds in both themes. The palette is OKLCH, so this is checkable
  rather than eyeballed, and both palettes declare the same token names.
- Focus is always visible and every interactive path is reachable by keyboard,
  including the sealed builder's card toggles.
- `prefers-reduced-motion` is honored; it already collapses every transition to
  1ms in `styles/base.ts`.
- Color is never the only carrier of meaning. This is load-bearing here in a
  way it is not in most apps: the five Magic colors are the primary encoding
  across the card face, the identity filters, the mana base table and the
  archetype charts. Every one of those needs a glyph, a label or a position
  doing the same work as the hue.
