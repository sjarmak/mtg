# Prior art: card data, rules text, and asset sources

Researched 2026-08-09 against primary sources (live API responses, LICENSE files, official policy pages — all fetched today unless noted). Lane: data foundation for the MTG set-generation lab (design-brief target capability 1) plus the legal envelope for the whole project.

Quick verdicts (full rationale per section; adopt = use as-is/lightly wrapped, interop = speak its format/API, inspire = port the pattern, skip = documented reason):

| Artifact | License | Verdict |
|---|---|---|
| Scryfall bulk data (oracle/default cards, rulings, tags) | Free w/ [use guidelines](https://scryfall.com/docs/api) (WotC Fan Content umbrella) | **adopt** |
| Scryfall REST API | same | **interop** (spot lookups only; bulk for everything else) |
| Scryfall card imagery (`*.scryfall.io`) | WotC copyright, use per Scryfall image guidelines | **adopt** (cache-on-demand, attribution preserved) |
| MTGJSON (AllPrintings.sqlite, CardTypes, Keywords, EnumValues) | MIT (code + data project) | **interop** (secondary/derived views, DSL vocabulary) |
| Comprehensive Rules (WotC TXT) | WotC copyright; local ingestion is community norm, no redistribution | **adopt** (as ingested data, not redistributed) |
| Academy Ruins API (structured CR JSON, diffs, glossary) | AGPL-3.0 | **interop** (consume API; self-host only if we accept AGPL) |
| chaoticgoodcomputing/mtg-rules (CR → markdown pipeline) | no license | **inspire** (pattern only; code unusable without license) |
| Yawgatog (hyperlinked CR + rules-changes diffs) | site, no license | **inspire** (diff-presentation pattern) |
| Keyrune (set-symbol font) | Fonts SIL OFL 1.1, icons+code GPL-3.0 | **adopt** |
| Mana (mana-symbol font) | Font SIL OFL 1.1, CSS/LESS/Sass MIT | **adopt** |
| Beleren (card title font) | WotC-proprietary (Delve Fonts commission) | **skip** (do not bundle; OFL stand-in chosen at design time) |
| CardConjurer forks (frame/template assets) | original GPL-3.0 (2018 mirror); current forks unlicensed; WotC C&D history | **inspire** (frame anatomy/layout concepts; custom frames for our lab) |
| Proxyshop (PSD render automation) | MPL-2.0 | **skip** (Photoshop dependency; wrong stack) |
| Magic Set Editor 2 | GPL-2.0 | **skip** for rendering (C++/wxWidgets desktop; format interop belongs to the set-design lane) |
| 17lands public datasets | CC BY 4.0 (site's own statement) | **adopt** (calibration baseline, attribution required) |

---

## 1. Scryfall

### 1.1 Bulk data — the primary card + rulings source

Endpoint: `GET https://api.scryfall.com/bulk-data` returns a `bulk_data` object per file with `type`, `updated_at`, `jsonl_download_uri`, `compressed_size` ([docs](https://scryfall.com/docs/api/bulk-data)). Verified live 2026-08-09; the seven files, with descriptions quoted from the API response itself:

| `type` | Contents (verbatim description) | Size (gz, 2026-08-09) |
|---|---|---|
| `oracle_cards` | "one Scryfall card object for each Oracle ID on Scryfall. The chosen sets for the cards are an attempt to return the most up-to-date recognizable version of the card." | 24.5 MB |
| `unique_artwork` | "card objects that together contain all unique artworks. The chosen cards promote the best image scans." | 37.4 MB |
| `default_cards` | "every card object on Scryfall in English or the printed language if the card is only available in one language." | 77.5 MB |
| `all_cards` | "every card object on Scryfall in every language." | 390 MB |
| `rulings` | "all Rulings on Scryfall. Each ruling refers to cards via an `oracle_id`." | 5.3 MB |
| `art_tags` | "all art (illustration) tags sourced from Tagger, the Scryfall community tagging project." | 12.5 MB |
| `oracle_tags` | "all Oracle tags sourced from Tagger, the Scryfall community tagging project." | 5.8 MB |

So: **oracle_cards = one row per distinct game object** (the gameplay layer we key everything on), **default_cards = one row per printing** (frames, artists, set membership, collector data), **all_cards = printings × languages** (we don't need it), **unique_artwork = art-deduped** (useful only if we ever train on real art, which we won't — custom art pipeline is locked).

Format note that invalidates older tutorials: bulk files are now **gzipped JSONL** ("Each bulk file is a gzipped JSONL (JSON Lines) archive … it's just `.gz`, not `.tar.gz`"), streamable line-by-line; the field is `jsonl_download_uri`, not the old `download_uri` JSON array ([bulk docs](https://scryfall.com/docs/api/bulk-data)).

Cadence, quoted from the docs: "Bulk data is only collected once every 12-24 hours"; "URLs for files change their timestamp each day"; "Updates to gameplay data (such as card names, Oracle text, mana costs, etc) are much less frequent. If you only need gameplay information, downloading card data once per week or right after set releases would most likely be sufficient." Prices in bulk are "dangerously stale after 24 hours" (we don't care; ignore price fields on ingest). A `/cards/manifest` endpoint exists for change detection (rate-limited to 10/minute).

### 1.2 API rate limits and required headers

From [Rate Limits](https://scryfall.com/docs/api/rate-limits), verified 2026-08-09 — these are described as **hard** limits:

- `/cards/search`, `/cards/named`, `/cards/random`, `/cards/collection` — **2/second (500 ms)**
- `/cards/manifest` — **10/minute**
- All other methods — **10/second (100 ms)**
- "The direct file origins located at `*.scryfall.io` do not have rate limits." (bulk files and card images live there)
- HTTP 429 ⇒ access limited for 30 seconds; ignoring 429s risks temporary or permanent ban.
- "If you need to rapidly look up card names, prices, or resolve a large number of card images, you must use the bulk data files."

Required headers ([API overview](https://scryfall.com/docs/api)): every request to `api.scryfall.com` must send an accurate `User-Agent` ("the name of your application, such as MTGExampleApp/1.0 … Do not allow HTTP libraries to choose the header for you") and an `Accept` header (`*/*` is fine). HTTPS/TLS 1.2+ only.

### 1.3 Images

Per-card `image_uris` offer ([Card Imagery docs](https://scryfall.com/docs/api/images)): `png` 745×1040 transparent rounded full card; JPG `small` 146×204, `normal` 488×680, `large` 672×936, `border_crop` 480×680, `art_crop` (varies); plus newer WEBP variants `thumb`/`grid`/`display`/`crop`/`art` that "replace" the JPG set. `image_status` field flags `missing`/`placeholder`/`lowres`/`highres_scan`. Image files are served from `*.scryfall.io` (no rate limit, per §1.2).

### 1.4 Data/image use terms (the operative Scryfall envelope)

From [the API overview](https://scryfall.com/docs/api), "Use of Scryfall Data and Images" — Scryfall provides data "free of charge for the primary purpose of creating additional Magic software, performing research, or creating community content," under the WotC Fan Content Policy umbrella. Requirements (paraphrase of the enumerated guidelines):

- No implying Scryfall endorsement; no Scryfall logos/name misuse.
- **No paywalling** Scryfall data in any form (payments, surveys, subscriptions, mandatory accounts, follow-gates).
- "You may not use Scryfall data to **create new games**, or to imply the information and images are from any other game besides Magic: The Gathering." (Our lab is Magic software about Magic — inside the line. A shipped bundle re-themed as a *different game* would not be. The theme-indirection pattern must stay "custom Magic set," not "new game.")
- No bare repackaging/proxying — "Your software must create additional value for end-users."
- Images: don't crop off copyright/artist name, don't distort/recolor/watermark, don't misattribute; when using `art_crop`, "list the artist name and copyright elsewhere in the same interface."

The general site [Terms of Service](https://scryfall.com/docs/terms) additionally prohibits placing "undue burden … through the use of automated means" and (noteworthy) bans AI-synthesized content *on Scryfall itself* — irrelevant to our local lab, but do not push generated content into their ecosystem (e.g., Tagger).

**Verdicts.** Bulk data: **adopt** — it is the community-standard primary source (MTGJSON itself builds partly from it, §2). REST API: **interop** — spot lookups and `/cards/manifest` change detection only. Imagery: **adopt** with an on-demand cache and artist/© attribution wherever art is shown.

## 2. MTGJSON

[MTGJSON](https://mtgjson.com/) is "an open-source project that catalogs all Magic: The Gathering data in portable formats," built **daily** ("MTGJSON files are built daily…"; FAQ: builds at 1:00 AM EST, live ~9:00 AM EST — [FAQ](https://mtgjson.com/faq/)). Current version verified live: `5.3.0+20260809` (`https://mtgjson.com/api/v5/Meta.json`, fetched 2026-08-09). Data sources per FAQ: "Magic: The Gathering's own Gatherer, API's like Scryfall and TCGplayer, and many more" — i.e., it is partly **downstream of Scryfall** for card data.

License: FAQ states "MTGJSON is free and open source under the MIT License"; the [code repo](https://github.com/mtgjson/mtgjson) license is MIT (verified via GitHub API, `LICENSE.txt`, SPDX MIT).

Files ([all files](https://mtgjson.com/downloads/all-files/)), each in JSON plus CSV/SQL/SQLite/Parquet variants with `.gz/.bz2/.xz/.zip` compression, served from `https://mtgjson.com/api/v5/`:

- **AllPrintings** — every set with every printing/variation, keyed by set code (177.6 MB `.json.gz`; **AllPrintings.sqlite.gz 241 MB** — a ready-made relational mirror). Set files are also available individually per set code.
- **AtomicCards** — every unique card by name, "oracle-like entity" of evergreen fields (50.9 MB `.json.gz`); the [CardAtomic model](https://mtgjson.com/data-models/card/card-atomic/) includes `rulings[]`, `legalities`, `text` (oracle text), `identifiers` (incl. Scryfall oracle ID), types/subtypes/supertypes, `colorIdentity`, `printings`, `foreignData`.
- Format-restricted variants (Standard/Pioneer/Modern/Legacy/Vintage/Pauper, full + Atomic), **CardTypes**, **Keywords**, **EnumValues**, deck files, prices, TCGplayer SKUs, Meta.

Format stability: versioned data models with a public [changelog](https://mtgjson.com/changelogs/mtgjson-v5/) that documents breaking changes with deprecation windows (e.g., "Deprecated `convertedManaCost` … in favor of `manaValue` … Will be removed in `v6.0.0`" in v5.2.0; v5.0.0 nested identifiers into `identifiers`). Latest changelog entry: 5.3.0, 2026-02-08.

**How it differs from Scryfall:** Scryfall is the canonical live database with images and a query API; MTGJSON is a daily *derived batch product* with more formats (SQLite/CSV/Parquet), format-partitioned files, and clean enumerations (CardTypes/Keywords) but no images and no query API. For a lab that will ingest into its own store, Scryfall bulk is the source of truth and MTGJSON is a convenience layer.

**Verdict: interop.** Use `AllPrintings.sqlite` for ad-hoc relational exploration, and **CardTypes/Keywords/EnumValues as the machine-readable vocabulary for the card DSL's type/keyword enums** (that alone justifies the dependency). Don't make it the primary ingest; two upstreams for one truth invites skew — reconcile on Scryfall oracle IDs, which MTGJSON carries in `identifiers`.

## 3. Comprehensive Rules

Canonical home: [magic.wizards.com/en/rules](https://magic.wizards.com/en/rules), offering the current CR in **TXT, PDF, and DOCX** (verified 2026-08-09; current version effective **August 7, 2026**, e.g. `https://media.wizards.com/2026/downloads/MagicCompRules%2020260807.txt`). URLs embed the effective date, so historical versions are only reachable if you know the date; several projects archive them (below).

The TXT is ~977 KB UTF-8 (downloaded and inspected). Structure is extremely regular and trivially parseable: title + effective date, Intro, Contents, nine numbered sections (`1. Game Concepts` … `9. Casual Variants`), three-digit rules (`601. Casting Spells`), decimal rules (`601.2.`) and lettered subrules (`601.2a`) — with the documented quirk that "subrules skip the letters 'l' and 'o'" — then a Glossary and Credits. A `^\d{3}\.\d+[a-z]?` line grammar covers the rules body.

Existing parsers/consumers (GitHub survey via `gh search repos`, 2026-08-09):

- **[lunakv/academyruins](https://github.com/lunakv/academyruins)** + **[academyruins-api](https://github.com/lunakv/academyruins-api)** (AGPL-3.0, active 2026) — "This API provides access to various versions of MTG rules documents (CR, MTR, IPG), both in their raw form and (for the CR) as a structured JSON. It also contains diffs of those documents" (README). Live API verified at `https://api.academyruins.com` (OpenAPI 0.7.0): `/cr/{rule_id}`, `/cr/glossary`, `/cr/keywords`, `/cr/toc`, `/cr/trace/{rule_id}` (rule-number history across renumberings), `/diff/cr`, `/file/cr/{set_code}` (historical CR files). Python + PostgreSQL. This is the strongest prior art in the niche.
- **[chaoticgoodcomputing/mtg-rules](https://github.com/chaoticgoodcomputing/mtg-rules)** (no license, active 2026) — "automatically pulled from Magic's official rules page whenever new ruleset updates are released," parsed to per-section Markdown. Pattern worth copying (watch the rules page, re-ingest on change); code not reusable without a license.
- **[Yawgatog](https://yawgatog.com/resources/magic-rules/)** — long-running hyperlinked HTML CR plus [rules-changes diffs](https://yawgatog.com/resources/rules-changes/) between consecutive CR versions (both verified live). Presentation pattern, not a library.
- **[pit142857/mtg-cr](https://github.com/pit142857/mtg-cr)** (no license) — archive of historical CR text files.
- Assorted rule-search/experiment repos exist (MTGRuler knowledge graph, divination-api AGPL, RulesParser 2015, etc.) — none is a maintained, liberally-licensed parsing library. **Conclusion: parse the TXT ourselves (an afternoon of code given the grammar), interop with Academy Ruins for diffs/glossary/trace instead of adopting its AGPL code into our tree.**

Redistribution note: the Fan Content Policy explicitly excludes "the verbatim copying and reposting of Wizards' IP (e.g., freely distributing D&D rules content or books …)" from what it permits (§6). Mirrors of the CR exist all over GitHub, but the safe reading for us: **ingest the CR into the lab's local store; don't publish a CR mirror as part of any shipped bundle.**

## 4. Rulings

- **Scryfall bulk `rulings`** file (§1.1): all rulings, keyed by `oracle_id`, 5.3 MB gz, refreshed on the same 12–24 h bulk cycle; also per-card via `GET /cards/:id/rulings` ([rulings docs](https://scryfall.com/docs/api/rulings)). Rulings originate from WotC's Gatherer; Scryfall normalizes and keys them.
- **MTGJSON** embeds a `rulings[]` array per card in AtomicCards ([model](https://mtgjson.com/data-models/card/card-atomic/)).

**Adopt the Scryfall rulings bulk file** — same keying (`oracle_id`) as the card ingest, one source, one join.

## 5. Symbol, frame, and font assets

### 5.1 Keyrune — set symbols (adopt)

[andrewgioia/keyrune](https://github.com/andrewgioia/keyrune) (545★, pushed 2026-05-02; npm `keyrune` 3.19.0, license expression `(OFL-1.1 AND GPL-3.0-only)`). [LICENSE.md](https://github.com/andrewgioia/keyrune/blob/master/LICENSE.md) verbatim highlights, verified 2026-08-09:

> "Keyrune is free, open source, and GPL-friendly. You can use it for commercial or open source projects…"
> - "Icons: GPL 3.0 License … Keyrune's glyphs, including the packaged source SVG files, are distributed under the GPL 3.0 license as of version 3.6.1 … The underlying symbols that these glyphs are based on are trademarks of Wizards of the Coast."
> - "Code: GPL 3.0 License … applies to all non-font and non-icon files."
> - "Fonts: SIL OFL 1.1 License … The prepared font files distributed in Keyrune carry the SIL OFL 1.1 license."
> - Attribution: "The files themselves already contain embedded comments with sufficient attribution and there is no need to otherwise reference Keyrune or Andrew Gioia in your project."

17lands.com itself loads `keyrune.css` from CDN (observed in their page source) — this is the community-standard set-symbol asset. Using the OFL font files keeps us clear of GPL questions for the app bundle; custom sets will need our own symbol glyphs anyway (Keyrune covers real WotC sets).

### 5.2 Mana — mana symbols (adopt)

[andrewgioia/mana](https://github.com/andrewgioia/mana) (405★, pushed 2026-03-25; npm `mana-font` 1.18.0, license field MIT). [README license section](https://github.com/andrewgioia/mana#license) verbatim:

> "All mana, tap, and card type symbol images are copyright Wizards of the Coast"
> "The Mana font is licensed under the the SIL OFL 1.1"
> "Mana CSS, LESS, and Sass files are licensed under the MIT License"
> "Attribution is **greatly appreciated** but not required!"

Note the honest layering: the *glyph designs* are WotC copyright (fine under fan-content norms, same as every Magic tool), the font file is OFL 1.1, the CSS is MIT. Scryfall's own docs pages and 17lands use these symbol sets; this is the norm.

### 5.3 Card fonts — Beleren is proprietary (skip bundling)

Beleren was commissioned by WotC from **Delve Fonts** (introduced 2014, replacing Matrix Bold for titles; body text remains Plantin-derived "MPlantin" in community templates) — [Delve Fonts' own case page](https://delvefonts.com/custom/beleren/), [design history](https://www.tumblr.com/mtg-realm/189956147461/creation-of-the-beleren-typeface). It has never been licensed for public use; the copies on GitHub/Reddit are extractions.

Community norm, verified directly: the CardConjurer fork's [`fonts/` directory](https://github.com/Investigamer/cardconjurer/tree/main/fonts) bundles `beleren-b.ttf`, `beleren-bsc.ttf`, `Matrix Bold Small Caps.ttf`, `Plantin-SemiboldItalic.otf`, Gotham, Gill Sans, `goudy-medieval.ttf`, etc. — i.e., **custom-card tools ship the proprietary fonts anyway**. That is exactly the kind of asset that drew the CardConjurer C&D (§5.4). Our rule: **no proprietary WotC-commissioned fonts in the repo or any shipped bundle.** Pick OFL-licensed stand-ins for title/body at design time (candidates to evaluate visually: OFL serif/small-caps families; the exact choice is a design decision, not a research fact) and treat "looks-like-Beleren" as a non-goal — our sets carry custom frames anyway.

### 5.4 Card frames / renderer templates

- **CardConjurer** — the original web custom-card renderer received a **cease & desist from WotC on Nov 3, 2022** for "reproduction of official Magic trademarks and logos as well as copying of card text and artwork," and shut down ([TechRaptor](https://techraptor.net/tabletop/news/wizards-cds-card-conjurer-causing-closure), [TheGamer](https://www.thegamer.com/wizards-of-the-coast-shuts-down-popular-mtg-card-site/)). It survives as self-hosted forks ([Investigamer/cardconjurer](https://github.com/Investigamer/cardconjurer), 237★, **no license file**, last push 2024-08; a 2018-era mirror [shopglobal/cardconjurer](https://github.com/shopglobal/cardconjurer) is GPL-3.0; frame image assets mirrored in [2gnc/cardconjurer-assets](https://github.com/2gnc/cardconjurer-assets)). **Inspire**: its frame anatomy (layered frame/pinline/textbox/ptbox assets, per-frame text-region metadata) is the reference model for a renderer; its assets are WotC frame reproductions we should not ship. The C&D is the clearest data point on where WotC draws the line: wholesale trademark/logo/frame reproduction in a public tool.
- **[Investigamer/Proxyshop](https://github.com/Investigamer/Proxyshop)** (MPL-2.0, 147★, active) — Photoshop automation over community PSD templates. **Skip**: quality bar is real but the Photoshop dependency doesn't fit a TS/Python pipeline.
- **[Magic Set Editor 2](https://github.com/twanvl/MagicSetEditor2)** (GPL-2.0 per its `COPYING`, 131★, last push 2023) — desktop C++ set-design suite with a large community template library. **Skip** as a renderer (wrong stack, aging); whether to *interop* with `.mse-set` for import/export is a set-design-lane question, not a data-lane one.

**Our path** (consistent with the locked custom-art pipeline): design an original frame family for the lab (SVG/HTML-CSS composited over generated art), mana/set symbols from Mana + Keyrune OFL fonts, our own set symbols for custom sets. That keeps every shipped pixel either ours or OFL.

## 6. Legal envelope (plain statement)

Primary sources: [WotC Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy) (last updated 2017-11-15, fetched in full 2026-08-09), Scryfall [API guidelines](https://scryfall.com/docs/api) + [ToS](https://scryfall.com/docs/terms), 17lands guidelines (from their site bundle, §7).

**What the Fan Content Policy permits** — "Pretty much anything you create based on or incorporating our IP" as long as it is free: "You can't require payments, surveys, downloads, subscriptions, or email registration to access your Fan Content"; no selling or licensing it; sponsorships/donations/ad revenue are OK. Required notice, verbatim:

> "[Title of your Fan Content] is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC."

**What it prohibits** (verbatim clause heads): "Don't use Wizards' logos and trademarks"; "Don't mess with the legal notices in our stuff" (don't strip ©/™ already inside IP you use — matches Scryfall's image rules); "Don't use Wizards' IP **in other games**. This includes your own or other people's games or game components (e.g., rule books, tokens, figures), regardless of whether it is distributed for free"; no WotC video/music. Fan Content explicitly does **not** include "verbatim copying and reposting of Wizards' IP (e.g., freely distributing D&D rules content or books, creating counterfeit/proxy Magic: The Gathering cards)". The FAQ adds: "You cannot incorporate Wizards patents, game mechanics (unless … D&D Open Game License), logos, or trademarks into your Fan Content without our prior written permission" — read alongside the fact that game *mechanics* are generally not protectable by copyright and the famous "tap" patent expired years ago; in practice the entire custom-card/simulator ecosystem (Scryfall, MTGJSON, Forge, XMage, Draftmancer, Cockatrice, MSE) operates openly on card names, oracle text, and mechanics under this policy's umbrella, and Scryfall's data service itself is framed "as part of the Wizards of the Coast Fan Content Policy." Also note the grant-back: "By making Fan Content, you agreed to let everyone (including Wizards) share and use your stuff without asking your permission."

**Plain statement for this lab.** A strictly non-commercial MTG set-design/playtest lab with custom art is squarely inside the Fan Content Policy: it is Magic software, about Magic, free, with original creative additions. The norms it must observe:

1. **Free means free** — no paywall, mandatory accounts, or gated access to anything containing WotC IP or Scryfall data.
2. **Carry the FCP notice** (verbatim above) on shipped surfaces that contain WotC IP.
3. **No WotC logos/trademarks** (planeswalker symbol, set logos, "Magic: The Gathering" branding) in generated frames/bundles; naming the game in factual text is fine.
4. **It stays a Magic thing** — Scryfall data must not be used to "create new games" or be presented as from another game. Theme-indirection ships a *custom Magic set*, not a re-badged game.
5. **Don't republish raw WotC text wholesale** — the CR and full oracle-text corpus are ingested locally; shipped bundles contain our generated sets, not mirrors of WotC's documents. (Card names/oracle text *inside a tool's UI* is the universal, WotC-tolerated norm; verbatim document redistribution is the excluded case.)
6. **Image hygiene** per Scryfall: no cropping copyright lines, no watermarks, artist + © attribution for art crops.
7. **The C&D line, empirically** (CardConjurer 2022): full reproduction of official frames, trademarks, and logos in a public card-fabrication tool is what triggered enforcement — original frames with custom art keep us on the safe side of it.
8. **Non-commercial is locked** (design brief) and is also what keeps every upstream (Fan Content Policy, Scryfall no-paywall, fonts' WotC-glyph caveats) simultaneously satisfiable.

## 7. 17lands ToS (constraint check only; access mechanics are another lane)

Verified from 17lands' own site code (their [usage-guidelines route](https://www.17lands.com/usage_guidelines) is a client-rendered SPA; text extracted from their production JS bundle, 2026-08-09):

- **Public datasets** ([page](https://www.17lands.com/public_datasets)): "Unless otherwise noted, these data sets are licensed under a Creative Commons Attribution 4.0 International License." Draft/Game/Replay CSV dumps, published on a delay schedule (draft data ~2 weeks into a set, game ~3, replay ~6).
- **Curated site data** (card ratings pages etc.): citation required — "If you're using our data you must make it clear that the data comes from 17Lands" (stylized "17Lands", capital L), citation "clearly visible at the top level, not hidden in a footnote"; a **12-day embargo** on re-visualizing new-set data (7 days for specialty formats); scraping their API is discouraged ("we provide no guarantees that any part of the API will remain consistent"); and "we reserve the right to request anyone stop using our data for any reason."

For the lab: **adopt the CC BY 4.0 public dumps** (attribution: "Data from 17Lands", link), skip their live API, and the embargo is irrelevant for calibration on historical sets.

## 8. Recommended ingestion strategy

**Sources → concerns:**

| Concern | Source | File |
|---|---|---|
| Gameplay card entities (name, mana cost, types, oracle text, colors, legalities) | Scryfall bulk | `oracle_cards` (keyed `oracle_id`) |
| Printings (sets, rarity, frames, artists, collector numbers, image URIs) | Scryfall bulk | `default_cards` (keyed `id`, FK `oracle_id`) |
| Rulings | Scryfall bulk | `rulings` (FK `oracle_id`) |
| Function/theme labels for the deck lab (e.g. "removal", "ramp", tribal themes) | Scryfall bulk | `oracle_tags` (+ `art_tags` if ever needed) |
| DSL vocabulary: legal types/subtypes/keywords enums | MTGJSON | `CardTypes.json`, `Keywords.json`, `EnumValues.json` |
| Ad-hoc relational exploration | MTGJSON | `AllPrintings.sqlite` (side artifact, not source of truth) |
| Comprehensive Rules | WotC TXT | parsed to `(rule_id, parent_id, text, glossary_term?)` rows; Academy Ruins API for diffs/trace when tracking CR updates |
| Human-play calibration | 17lands | public CSV dumps (CC BY 4.0) |
| Card images | Scryfall `*.scryfall.io` | on-demand fetch + local content-addressed cache; never a bulk mirror |

**Storage shape:** one ingest job (TS, versioned) that streams the JSONL.gz files into a local SQLite/DuckDB store with three core tables (`oracle_card`, `printing`, `ruling`) mirroring Scryfall's own oracle/printing split, plus `oracle_tag` join table and a `cr_rule` table. Keep Scryfall's raw JSON per row (a `json` column) so schema evolution upstream never loses data; project typed columns for what the lab queries. Record `bulk_data.updated_at` per ingest for provenance. Refresh weekly or on set releases (Scryfall's own guidance for gameplay data); diff CR on Academy Ruins' feed. Custom-set cards live in the *same* `oracle_card`/`printing` shape with a `source: "lab"` discriminator — one schema for real and generated cards is what makes the deck lab, sim, and renderer indifferent to card origin.

**Etiquette:** a pinned `User-Agent: mtg-lab/x.y (contact email)` on every Scryfall request, bulk-first (their stated requirement), 429-respecting backoff on the rare API call.
