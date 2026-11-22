# Recorded fill calls

Every file here is one request/response pair from a paid generation run, named
by `hash(system, prompt, schema)` (`@mtg/llm`'s `fixtureKey`). The replay looks
a recording up by that file name and by nothing else, so a change to the system
prompt, the fill prompt or the answer schema does not degrade a recording; it
makes it unreachable.

## Two recordings nothing will ever replay

`1de0653e0e12f7eb23a26886f6bfa65f.json` ($1.39347) and
`da08dccf93c964491ae072d6791432d7.json` ($0.912338), both recorded 2026-08-14
against `claude-fable-5`, are the only two files here whose schema embeds a
counter enum. Both were keyed while the flagship set's part counter was called
`saberHorn`; `7d47f6e` renamed it to `horn` on 2026-08-16, so neither key can be
hit again. Nothing fails because of this and nothing ever will: every recorded
call in this repo keys to `FillBatchSchema`, `FillBatchWithAbilitiesSchema` or
the `llm-hearthglass` family, and none of them carries a counter enum, so the
mechanics tier is not replayed at all. The next mechanics-tier recording pays
for what these two hold a second time. That is $2.31 spent, written down here so
the next person does not spend a round of work rediscovering it (`mtg-b32i`).

They are kept rather than deleted, and not re-keyed, for a reason worth stating.
`../../tools/rekey-fixtures.ts` moves a recording onto the key its corrected
request hashes to, and this tree has used it three times; it rewrites the
request and leaves the model's answer exactly as written, which is what keeps a
re-key honest. That does not work here. The old name is in the prompt five
times as well as in the schema, and both recorded answers name the counter
`saberHorn` themselves, so a re-key would have to rewrite the model's own
output before the replayed answer would validate against today's DSL. Rewriting
an answer asserts the model would have produced it, which nobody has checked.
Deleting them is still available and costs nothing beyond the record above.
