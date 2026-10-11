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
continuous development through eleven rounds. The stage-2 evaluator itself changes neither the production bot nor
deployment branches or version history; the optional whole-match policy below is a separate experiment.

## Whole-match policy experiments

```sh
node tools/botbench-policy-search.mjs --seed 11 --seeds 20 --policies baseline,core3-anchor,anchor3-wide --jobs 8 --out /path/to/output/development
node tools/botbench-policy-search.mjs --seed 201 --seeds 80 --policies baseline,anchor3-wide,live-layers-wide --jobs 8 --label held-out-fixed-inputs --out /path/to/output/validation
node tools/botbench/compare-policies.mjs /path/to/output/validation.json anchor3-wide /path/to/output/comparison.json
node --test test/botbench-support-policy.test.js test/botbench-policy-comparison.test.js
```

The comparison command accepts an optional fourth argument for round 11's weight (for example `0.5`);
rounds 1–10 retain weight 1. Without it all rounds remain equally weighted for historical replay.
The API also accepts `{ roundWeights: { 11: 0.5 } }` as its fourth argument. Reports keep actual LP,
per-round totals and the original intervals, and add explicitly named weighted scores and seed-clustered intervals.
Survival failures take priority over either score. Output files cannot overwrite existing records.
Freeze the objective before future evaluation; changing weights after inspecting results is post-hoc analysis,
not new held-out evidence. The batch's original summary still ranks unweighted LP: use the weighted comparison
report when evaluating a weighted objective.

Run every policy continuously from round 1 through 11, always with 2 human + 2 AI and four-seat ABYSS values.
Cross each seed with both anchor bands (阿米娅 / 罗素); maps rotate across all seven by seed, or use `--maps all`.
The other AI drafts normally. Human placeholders never buy or deploy: inject 1–3 controlled leaks from one or both
sources. This measures support capacity for those inputs, not human decision-making, human pool competition, natural
enemy frequencies, or performance after round 11. Neither a high human-survival percentage under these small inputs
nor lower AI leaks alone establishes better support.

`baseline` is mandatory and runs first within each case. Its full incoming human enemy keys, mods, tags, counted
flags and LP weights are frozen for every candidate. This is necessary even with the same match seed: different AI
elimination histories can change subsequent battle RNG allocation, including duck replacements in the empty human
fields. Fixture collection reaching fewer than 11 rounds fails the batch rather than silently truncating it. Actual
AI waves/results, helper selection, carry state, RNG and settlement are never replaced. Frozen incoming fixtures are
an intentional controlled input; later AI histories and random outcomes can still diverge naturally. Records include
code/data hashes, seed, policy parameters, shop levels, board, layers, skipped upgrades and actual source LP charges.

The experimental policy catalog in `support-policy.mjs` includes:

- `wider-layout`: 5 existing layout rehearsals instead of 3.
- `core3-both` / `core4-both`: both bots decline upgrades at shop level 3 / 4; ordinary buying spends the remainder.
- `core3-anchor` / `core3-partner`: only the anchor / partner declines upgrades above level 3.
- `anchor3-through7` / `anchor3-through9`: the anchor resumes ordinary upgrading after round 7 / 9.
- `anchor4`: only the anchor stops at level 4.
- `anchor3-wide` / `core3-wide`: the respective anchor-only / both-bot level-3 restriction plus 5 rehearsals.
- `live-layers` / `live-layers-wide`: enable real in-battle layer growth inside 3 / 5 isolated layout rehearsals.
  Those trial results are never settled into the match. Ordinary formal combat and unite flags are unchanged.

These are offline interventions on fresh match instances, with no changes to game rules, prices, pool size or human
operations. Develop on seeds 1–30, freeze candidate parameters, and test on new seeds. Keep discarded attempts and
regressions. Do not pick a seed or map subset after seeing held-out results and call it an independent validation.
The comparison tool checks paired cases and fixture equality, reports human failures first, actual LP, zero-loss
rescue events, eligible AI, AI eliminations, worst-decile loss, map/band/round breakdowns, and a paired bootstrap
interval clustered by match seed (the two bands sharing a seed are not two independent samples). An interval cannot
prove generalization to real player inventories or different fixture distributions. Early elimination must never
be sold as a lower-loss improvement. Use `--jobs 1` separately for meaningful timing; worker wall times are contended.

The partner-selection candidates `paired-fallback`, `team-medic`, and `team-medic-core` choose the other anchor band,
Touch, or Touch plus the anchor's level-3/5-rehearsal policy, respectively, through legal draft operations. The fixed
human incoming leaks exclude Touch's potential benefit to the humans' own clearing. No duplicate band is allowed.

This workflow does not train a neural network. It supplies controlled labels and regression cases before deciding
whether a small candidate-scoring model would improve on cheap policies. Experiments do not enable a live-server
policy automatically; a deployment decision needs both held-out support results and a measured online prep budget.

### Opt-in local gameplay

`Match` accepts `botSupportPolicy` (or the server environment variable `SP_BOT_SUPPORT_POLICY`) with an empty default.
`team-medic` makes two real AI seats in a four-seat ABYSS room prefer an available 阿米娅 (otherwise 罗素) + Touch pair.
The exact paired setup is experimental; when humans have taken the required bands or a different AI already picked,
the original band picker handles that turn. Human seats under autoplay and other modes keep the original policy.
`team-medic-core` additionally keeps only the anchor AI's shop at level 3 through round 11 and rehearses up to 5
distinct layouts for both AI seats. It requires the actual pair to have been selected; explicit rehearsal=0 still
disables rehearsal. From round 12 its economy/rehearsal restrictions cease, but previous spending and chosen bands
obviously persist. No effectiveness beyond round 11 is claimed. Offline `nativePolicy` allows the ordinary AI path
to be checked against the experimental intervention; the benchmark explicitly disables the environment's policy
unless `nativePolicy` is provided. No new or existing local/remote server is automatically restarted by these tools.

### Capability-driven build experiments

`combat-atlas.mjs OUTPUT_PREFIX` measures ordinary and elite operator records with real kits/default skills against
eight synthetic target profiles, using two fixed probe seeds. It retains first-20-second and 60-second DPS,
saturated HPS, physical hit strength, silence uptime and observed DEF/RES reductions. Raw per-probe JSONL is preserved.
These are stationary-target capabilities, not match win rates: no bonds/layers, route coverage or economy are present;
on-hurt skills and manually deployed summons are underestimated. The recorded damage includes 卫戍协议特质, including
weakness damage. Normal and elite entries must not be ranked by equal acquisition cost.

```sh
node tools/botbench/combat-atlas.mjs /path/to/output/atlas
node tools/botbench-policy-search.mjs --seed 11 --seeds 20 --policies baseline,team-medic-core,build-output,build-matchup,build-conservative,build-team-core --jobs 8 --atlas /path/to/output/atlas.json --out /path/to/output/build-development
```

`build-output` adds measured damage fit to purchases, bench values and lineup admission. `build-matchup` also values
usable healing under estimated incoming damage, debuff benefits to other damage dealers, and a silence item/carrier
against 折射. It mixes the current preview with 20% of the publicly known faction pools; it never reads hidden future
wave picks. `build-conservative` halves those heuristic weights. `build-team-core` combines matchup scoring with the
existing Touch/core policy. No build policy is enabled by default: the offline caller injects `botBuildPolicy` and
`botCombatAtlas`; no new server environment setting is exposed. The atlas file hash is retained in each batch.
Interpolation, healing coverage (65%), debuff coverage and crowd weights are experimental estimates, not official
mechanics or learned probabilities. The original bond/merge/layer/economy scores remain active. DEF extrapolation
is clamped at 1400; special hit-count defenses, summon placement and accumulated bond power need separate probes.
Only full matches can validate whether a candidate actually helps cooperative defense.

The second iteration retains `build-team-tanks` (no extra low-DPS penalty for defensive melee units),
`build-team-sustain` (map-medic capacity and the two-elite Touch upgrade threshold), and `build-team-resilient` (both).
`node tools/botbench/map-medic-probe.mjs INPUT_ATLAS OUTPUT_ATLAS` extends the atlas using real map-character kits.
These are separate candidates: adding two individually plausible rules need not improve their combined result.
The CLI rejects an atlas generated from different game data or one missing the map-medic measurements a policy needs.

Medical-only ablations (`medical-buy`, `medical-buy-keep`, `medical-lineup`, `medical-complete`, `medical-strong`,
`medical-small`, `medical-medium`, `medical-late`) remain available as rejected development comparisons. A healer
buy bonus alone may not pass the full-board lineup-gain gate. They use the explicit `Match.botMedicalPolicy` option,
default empty, and only run in rounds 3–11 of 2H2AI ABYSS without a living Touch teammate. Diagnostics retain affordable
healers passed, purchased/sold, owned/deployed counts; those proxies cannot substitute for actual human LP outcomes.

### Persistent experiment index

Completed policy batches automatically append to `ai-experiment-index.jsonl` beside the output. Import older runs
with `node tools/botbench/experiment-store.mjs RESULT.json [RESULT.json ...]`. Content hashes make re-registration
idempotent; original JSON and JSONL are not rewritten. The index stores parameters, baseline cases, seeds, maps,
code/data/atlas fingerprints, totals and paths. Incomplete runs retain their journal but are not marked completed.
Keep rejected candidates as well as winners, and clearly label development, unseen validation and timing repeats.
Before simulation, the CLI also writes a non-overwriting `.source.json` with the source files, base Git revision and
data fingerprint, so an interrupted run still retains its research code. Aggregates list their component batches;
do not add aggregate counts to their components as if they were additional simulated matches.

Use `comparisonCompatibility(a, b)` before comparing totals across batches: data, cases, fixed incoming human leaks
and complete baseline results must agree. Different seeds are not a paired comparison. Every new development and
validation batch should include `baseline` and the current best policy, not just a favorable comparison to an old
baseline. Archive the matching source revision and atlas alongside the raw results for future reproduction.

### Tactical rehearsal ablations

The next offline candidates inherit `build-team-tanks`. `build-team-context` fills the rehearsal's read-only public
prep facts (`contentInfo`), including alive teammate bands. Without that input, an anchor's isolated rehearsal does
not see a Touch teammate's map medic. `build-team-live` additionally enables real in-trial layer growth; no trial
result is settled into the match. `build-team-carry` ranks counted leaks first, then surviving operator proportion
and remaining HP, with a small kill tie-break. Stack counts of different bonds are not summed into an arbitrary
reward: their actual combat effects influence the trial. All existing candidate IDs remain frozen comparisons.

`build-team-terrain` adds a sixth layout proposal that shares measured HPS over threatened allies in actual rotated
healing ranges, includes the stage's map-medic slot, and penalizes uncovered infection damage. It retains ordinary
route exposure and lets the real battle decide whether the safer plan loses too much damage. `build-team-hazard`
adds this proposal only on infection stages, with a fourfold deficit penalty. These are experimental coefficients,
not game rules. The heuristic is approximate (partial greedy lineups, stationary HPS capacity, no full skill healing
coverage); the true trial includes routes, terrain buffs, skills, bonds and current layers. More layers or less own
leakage does not necessarily mean less human LP loss. Do not enable a candidate merely because it sounds plausible.

The optional Match-instance callbacks `botLayoutAdjustment` and `botRehearsalScore` are injected by these offline
tools only; absent callbacks preserve the original path. There is no new environment/server default or network API.
Public rehearsal context is a prep snapshot, not a full replay of potentially stateful `onBattleStart` meta hooks;
effects/grants at prep end remain a known approximation. Formal simulation rules are unchanged.

`runSupportPolicy({ ...config, observe: true }, id)` records actual healing amounts/source-target totals, terrain
damage, knockdowns and half-second samples of injured/infection exposure. Its uncovered time measures ordinary
healer target-range eligibility, not all skill/bard healing; use actual received healing alongside it. Observation
is opt-in and tested for complete-match parity. Rehearsal diagnostics include candidate boards, map medics, carry
state and per-bond gains. All raw batches, including regressions, remain in the experiment archive.
