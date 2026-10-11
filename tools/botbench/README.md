# Cooperative support baseline (stage 1)

This is an offline diagnostic for AI teammates rescuing human-origin leaks in rounds 1–11, inclusive, in terminal
simulation (`ABYSS`). It leaves the production AI, game rules, network server and version history untouched.

```sh
# 2 anchor strategies × 3 human counts × 30 seeds = 180 matches; AI rehearsal stays at its default 3.
node tools/botbench.mjs --support --seeds 30 --jobs 8 --out /path/to/output/small

# Larger leaks, reported separately, not weighted into the small-leak baseline.
node tools/botbench.mjs --support --scenario pressure --seeds 30 --jobs 8 --out /path/to/output/pressure

# Paired maps: 2 human + 2 AI; the same 30 seeds on all 7 maps, both anchor bands (420 matches).
node tools/botbench.mjs --support --humans 2 --maps all --seeds 30 --jobs 8 --out /path/to/output/paired-maps
node tools/botbench/analyze-support.mjs /path/to/output/paired-maps.json /path/to/output/map-analysis

# Serial timing and an exact single-case replay (map/leak settings depend on absolute seed).
node tools/botbench.mjs --support --seed 17 --seeds 1 --humans 2 --bands band_ioleta --jobs 1 --out /path/to/output/replay

node --test test/botbench-support.test.js
```

`--out` is a required file prefix. The tool refuses to overwrite its JSONL checkpoint. A successful run also writes
JSON (manifest, aggregate metrics and complete records) and a Markdown report. Worker errors fail the run and leave
completed JSONL records for diagnosis; incomplete runs do not produce a success report. This is not a resume protocol.
Legacy botbench flags and all-bot benchmarks still work without `--support`.

## Fixed experimental design

- Four seats, with `--humans 1,2,3` and `--bands band_amiya,band_ioleta` by default. The first AI in the draft is
  assigned the specified strategy through the validated draft action. Other AI pick normally. Human placeholders
  reserve these two strategies, so no duplicated team strategy is forced. Actual choices are recorded.
- AI make their normal economic and deployment decisions and fight their own complete battles. Eligibility, helper
  selection/order, carried HP/SP/down state, map, AI bounties, real unite battle and settlement remain unchanged.
- Human decisions are **not modelled**. Human seats have no deployed army, make no purchases, and cannot contribute
  helper firepower. Immediately before `planUnite`, their normal results are replaced with controlled leak inputs.
  Each input selects distinct actual leaked instances of that round, retaining enemy modifiers. Other enemies are
  assumed handled by humans. The fixture suppresses human perfect eligibility even on zero-input seats; this is an
  explicit isolation assumption, not a game rule. Human purchases competing for the shared pool are outside scope.
- `small` selects 1/2/3 leaks per leaking human; `pressure` selects 5/10. Counts rotate by absolute seed. Source mode
  rotates every three seeds: one living human in rotation, or all living humans simultaneously. All eleven rounds
  receive a controlled input. This is a sustained-support probe, not an estimate of real weak-round frequency.
- Selection rotates among enemy types present that round, rather than drowning rare threats in fodder. No extra
  instances are created when fewer enemies are available. Inputs record requested and actual counts, enemy IDs and
  modifiers. It does not claim to reproduce which enemies real humans are most likely to leak.
- Seven multiplayer maps rotate by seed. These are balanced map fixtures, not natural map probability. Each band
  uses the same seed/map/input policy for comparison; shared resources and later state may still diverge.
  `--maps all` crosses every seed with all seven maps; `--maps ID,ID` selects an explicit subset. Records include
  mode ID, all four seat flags, wave type/entry, round multipliers and scheduled main/bounty counts per AI field.
  Scheduled counts exclude later summons/children and are not a denominator for exact per-enemy escape probability.
- End immediately after round 11 settlement, or once all original humans are eliminated. No round 12 is started,
  no fake victory is emitted. Fewer rounds due to death never count as lower-loss success. `--rounds 1..11` supports
  short smoke runs; reports always state their actual cutoff.

## Recorded outcomes

The main practical measure for small inputs is the fraction of human leak events with zero final LP loss, broken
down by input size and source count. Also record survival through the cutoff, actual LP charged, uncapped survivors
by source, AI perfect/selected rates, board composition, existing/gained layers and normal-battle end state.
Use `uniteSurvivors` directly so offspring, unspawned and not-reentered enemies keep their true source attribution.
Base and bounty own leaks have separate groups; AI-origin bounty leaks cannot count as rescued human inputs.

`avoidedLP = min(roundCap, ownCountedLeaks) - actualChargedLP` is an immediate same-result arithmetic reference. It
may be negative due to spawned children. It is not a replay without unite and does not estimate alternate later
decisions. The critical-rescue label similarly compares pre-loss LP with that arithmetic reference, not a full
counterfactual including settlement-triggered healing. Small inputs often cannot kill by round 11 even without any
rescue, so a high survival rate alone is not evidence of good support. Pressure runs must remain separate.

Wall time and per-thread CPU time cover an AI prep callback (virtual-time, unbounded slices); rehearsal step time
is tracked separately. Node versions without `process.threadCpuUsage` report CPU as null. Parallel wall time is
load-sensitive: use `--jobs 1` for timing comparisons. These numbers are not real-server event-loop latency,
network delay or browser performance. Stage 2 must measure and budget those separately before deployment.

The manifest records Git HEAD/status, code/data hashes, runtime and fixture version. Keep JSON records for A/B
comparison. Seeds 1–30 are development baselines, not a held-out test set. This stage neither trains a neural
network nor changes the AI policy; it makes the next policy change measurable.

## Stage 2: isolated cooperative candidate evaluation

```sh
node tools/botbench-evaluate-support.mjs --seeds 5,6,7,8,9,10 --rounds 4,7,9,11 --jobs 8 --out /path/to/output/evaluation
node --test test/botbench-support.test.js test/botbench-support-evaluator.test.js
```

This tool always uses **2 human + 2 AI, four-seat ABYSS stats**, crossing the specified seeds, anchor bands and
rounds with 活性源石 / 排气格栅. Each target prep is reconstructed from the match seed in a separate `Match` and virtual
scheduler. All earlier rounds use the original bot. Branch immediately before prep-end effects, after the bots have
bought and arranged; do not copy function closures or callback queues. Candidate application uses validated
`PlayerState.move` / Ready operations. Tokens and their owners stay fixed; inventory, funds and pool are not invented.

The diagnostic checkpoint hashes inventories, shop, bonds/layers/effects, pool, six RNG states, wave, time and timer
metadata. It is **not** a general save/restore format: effect callbacks and their closures are reconstructed by replay.
Every candidate must reach the same checkpoint and prefix-results hash. Separate match instances isolate callbacks,
caches, resources and timers; tests also check game data remains unchanged and evaluation order gives identical results.
The no-op formal-seed result must equal the ordinary runner's normal → unite → actual settlement result.

Candidates are `baseline` (unchanged), `terrain` (healing / environmental attrition / smog exposure), `balanced`
(also rewards the weakest material route, weighted by enemy count and HP), `sustain` (tries an already-owned reserve
medic when none is deployed), and `guarded` (at most four moves, only for existing infection/smog hazards, with an
estimated route-coverage floor). These are experimental offline proposals, not production rules. They use rough
attack/healing and range estimates; skills, taunt, item stealth and bond effects are not all represented by the
heuristic. The actual simulator remains authoritative. Hidden blockers are penalized only when there are exposed
backliners potentially reachable by ranged enemies; it is not a blanket ban on blocking on smog.

Generate labels on two trial battle seeds (101, 202). Choose by mean human LP loss, eligible AI count, own leaks,
then carried HP; freeze the choice and validate on unseen trial seed 303. Trial seeds only change target-round normal
and unite RNG; shopping, prior rounds and bot rehearsal RNG are unchanged. All candidates get the same human-origin
leak fixture within each trial. The held-out seed cannot affect candidate selection. These are exploratory checkpoint
comparisons on development match seeds, **not** the plan's final held-out whole-match acceptance test.

JSON/JSONL records preserve the code/data fingerprint, checkpoint checksums, actions/refusals, before/after features,
helper selection, HP/SP/down carry, layers/gains, human source attribution and real LP charge. Markdown reports held-out
paired totals and regressions, never just the best training result. A worker error prevents a completed success report.
All target rounds, including 11, stop after settlement without advancing to round 12.

Full-prefix replay is intentionally a correctness-first offline implementation. Prefix, candidate generation and total
cost are recorded separately. It does not meet an online decision budget yet and does not install a neural network.
No reserve medic means layout search cannot solve missing sustain: earlier purchasing / lineup and bond-threshold
preservation belong to the next economic-candidate step. A single changed checkpoint also cannot demonstrate improved
continuous development through eleven rounds. Production bot, deployment branches and version history stay unchanged.
