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
