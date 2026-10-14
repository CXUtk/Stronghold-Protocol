# deploy 分支规则改动记录

此文件记录用户主动要求的部署规则。它们与上游行为可能不同；同步或整理 `deploy` 时应核对并保留，不能仅因上游存在相关代码就删除。此记录随部署分支维护，不作为官服机制依据，不修改已发布版本的历史记录。

## Boss 可受到侵蚀损伤（2026-10-10）

- 用户要求：在 `deploy` 加入 Boss 侵蚀损伤机制，并记录。
- 上游基线：`1db8e510`（0.2.3）；`server/sim/content/bosses.js` 的全局 `elementHit` 钩子取消所有领袖的侵蚀损伤。
- 本分支改动：移除这一拦截，最终攻势与隐秘核心的 10 种领袖及其镜像均可累计侵蚀、发生爆发。适用于所有侵蚀来源，包括克莱门莎、珊比。
- 沿用现有数值：领袖元素值上限 2000；每次爆发永久降低 120 防御，可叠加，并造成 5000 元素伤害；爆发冷却 8 秒，期间所有元素均不能累计，冷却结束清空元素条。元素抗性、元素脆弱等仍按既有伤害管线结算。
- 共享血池：爆发伤害扣减当前战场绑定的 Boss 血池，计入造成侵蚀的干员及玩家的伤害统计；元素条和减防仍属于各个敌方单位，镜像之间不会共享元素条。
- 技能联动：克莱门莎 S2 漩涡可使 Boss 爆发，S3 可响应 Boss 的侵蚀爆发消耗弹药并轰炸。此改动不改变 Pith 的元素类型选择或元素爆发冷却规则。
- 性质：用户指定的部署分支规则；未声称官服已经取消该模式的领袖侵蚀免疫。关联问题线索为上游 [issue #469](https://github.com/sganggs/Stronghold-Protocol/issues/469)，此改动不提交到上游 PR。
- 验证：`test/content/enemies_bosses.test.js` 覆盖 10 种领袖的积累、共享血池伤害、减防、冷却及再次爆发；`test/content/deploy-boss-erosion.test.js` 用真实克莱门莎与卢西恩验证 S2 / S3、玩家伤害记账及镜像的独立元素条。相关四个测试文件共 313 项通过，文档检查 31 项通过；Golden 更新后复核 285 个场景全部一致，基准文件没有变化。修改文件的 ESLint 检查无错误，仅保留 `bosses.js` 原有的 6 项未使用变量警告。

## 联防开场重新部署倒地阿戈尔（2026-10-10）

- 用户确认：倒地的阿戈尔也要在协防开场站起来部署，并重新计算本场击倒、复活次数。
- 本分支改动：`server/sim/content/bonds/core.js installEgir` 在首次部署前清除享受已激活阿戈尔效果的干员的倒地继承状态，包括获得该效果的调和、变形同构体成员。倒地成员在整备位置以满血和初始技力部署，随后参与本场吞噬，不再先强制退场、等待再部署倒计时。
- 仍站着的成员继续保留上一场的生命比例、技力；其他倒地干员仍强制退场。普通作战、Boss 作战不受此例外影响。
- 击倒及复活计数：沿用每个新 `Battle` 独立创建的首次击倒记录与复活名额，不带入上一场的消耗。五阿戈尔本场仍最多复活 3 名首次被击倒成员，重新吞噬造成的击倒也会占用本场名额；埃芒加德同样有新的 3 次复活。联防不增加盟约层数。
- 性质：用户指定的部署分支规则；不作为官服机制依据，不修改已发布的 0.2.3 历史记录。
- 再次确认（2026-10-11）：用户了解 PRTS 未明确记载这一特殊联防规则后，仍要求按照上述规则实现。后续同步或整理 `deploy` 时继续保留此行为。
- 回归验证：`test/content/deploy-egir-unite-reset.test.js` 使用真实的普通战斗结果、`uniteBattleOpts` 与客户端共用的 `BattleSpec` 构建路径，覆盖倒地阿戈尔站起、阿戈尔和埃芒加德跨阶段复活次数重置，以及非成员 / 未激活盟约的边界；吞噬链、跨玩家吞噬与复活顺序测试同步更新。
- 验证结果：阿戈尔相关 26 项通过；协防状态继承、地图、其他复活规则及文档检查 88 项通过。Golden 更新后复核 285 个场景全部一致，基准文件没有变化；修改文件的 ESLint 无错误。完整 `bonds_core.test.js` 中另有 2 项原有叙拉古时长断言与 `deploy` 的持续时间 ×1.3 暗改冲突，不属于本次改动，未修改。

## 叙拉古持续时间改为原版的 90%（2026-10-11）

- 用户要求：取消原有的持续时间 ×1.3 增强，改为原版持续时间的 90%，显示文字保持原样，并部署到远端。
- 本分支改动：`server/sim/content/bonds/core.js installSiracusa` 每次部署时，将攻速增益与六人效果的隐匿持续时间设为 `(base_duration + duration_per_stack × 层数) × 0.9`；替换旧的 ×1.3，二者不叠加。按现有数据为 `(32 + 0.4 × 层数) × 0.9` 秒，例如 0 层 28.8 秒、10 层 32.4 秒、20 层 36 秒。
- 保持不变：攻速幅度、隐匿结束后的 10 秒触发窗口、触发概率、真实伤害与恐惧数值，以及盟约说明文字和生成数据。
- 性质：用户指定的部署分支规则；同步或整理 `deploy` 时以 ×0.9 代替此前 ×1.3，不修改已发布的 0.2.3 历史记录。
- 回归测试：`test/content/bonds_core.test.js` 的叙拉古用例同步覆盖增益到期、再次部署，以及隐匿结束后 10 秒内 / 外的触发行为；此前与 ×1.3 冲突的两个时长断言在本次一起修正。
- 验证结果：相关 42 项测试、31 项文档检查通过；Golden 更新后复核 285 个场景全部通过。因叙拉古增益更早结束，12 个场景的战斗过程或结算基准更新：`bond-siracusaShip-low`、`bond-soloShip-low`（其中含叙拉古成员）、`solo-NORMAL-1`、`solo-HARD-1`、`solo-ABYSS-1`、`coop2-NORMAL-3`、`coop2-HARD-4`、`coop3-ABYSS-5`、`coop4-FUNNY-6`、`coop4-ABYSS-7`、`coop2-NORMAL-8-serverrun`、`coop2-NORMAL-70-diy`。ESLint 无错误，仅保留 `fields.js` 原有的 3 项警告。

## 与上游 0.2.4 同步（2026-10-11）

- 上游基线更新为 `bc50cac0`（0.2.4）。干员伤害公告中的自选／补位名称改用上游实现，移除本地重复实现和测试。
- 保留上述 Boss 侵蚀、联防倒地阿戈尔重新部署和叙拉古 ×0.9 规则。
- 继续保留歌蕾蒂娅赠卡数量 +1（普通／精锐，说明文字不变）；上游新增白面鸮复制歌蕾蒂娅时跳过三人条件，复制的特质仍沿用本分支的 +1 数量。复制余时不额外增加数量。
- 保留买入快捷键、寒芒克洛丝连射视觉、小车左右轮换、AI 队友默认最后选择、逐火次数怪初始隐匿，以及敌人失去有效阻挡时的隐匿恢复修复。逐火初始隐匿仍是待原版实测确认的实现推导，上游暂未合入。
- 本次只更新本地 Git 分支；服务器和正在运行的本地对局仍使用此前启动的版本。
- 同步后的战斗基准以 0.2.4 为基线重算。保留的逐火隐匿、小车轮换、阻挡修复和部署规则使 31 个场景的事件、快照、时序或结算与纯上游不同：`roster-001`、`roster-003`、`roster-011`、`roster-012`、`roster-013`、`roster-016`、`roster-024`、`roster-025`、`roster-031`、`roster-034`、`roster-042`、`roster-047`、`bond-maniShip-high`、`bond-soloShip-low`、`hidden-boss_9-pair`、`hidden-boss_9-solo`、`solo-ABYSS-1`、`solo-ABYSS-2`、`coop2-NORMAL-3`、`coop2-HARD-4`、`coop3-ABYSS-5`、`coop4-FUNNY-6`、`coop4-ABYSS-7`、`coop2-NORMAL-8-serverrun`、`coop2-ABYSS-10-boosted`、`coop2-NORMAL-70-diy`、`coop2-NORMAL-1-coverage-standins`、`coop2-NORMAL-5-coverage-diy`、`standin-04`、`diy-030`、`diy-084`。其他 256 个场景与上游一致。本次 219 项相关测试及全部 287 个战斗基准复核通过，类型检查通过。

## 多人甄选与同阶普通干员的初始抽取权重一致（2026-10-11）

- 用户要求：多人模式下甄选五阶干员应与普通五阶干员有相同抽取权重；按同一规则处理六阶甄选。
- 上游基线：0.2.4 的协作普通干员共享库存翻倍，但甄选保持个人 8／5 张库存，抽取直接按剩余张数加权，导致初始甄选权重只有同阶普通干员的一半。
- 本分支改动：保留五阶／六阶甄选每人独立的 8／5 张库存，给每张剩余库存单独设置抽取倍率 `weightMultiplier`。单人为 1，多人取普通共享池倍率 `coopPoolMultiplier`（当前为 2）。满库存时五阶权重 16、六阶权重 10，与同阶普通干员一致；购买后按甄选剩余库存比例下降，出售后恢复。
- 同一加权规则适用于调度中心刷新、晋升奖励和按卡池张数抽取的随机发卡；不增加可购买张数，不使其他玩家消耗自己的甄选库存。用完库存、等级不足、禁用盟约等条件继续生效。按干员身份等概率抽取的拟态不使用该倍率，装备抽取不变。
- 性质：用户指定的 `deploy` 规则。甄选库存数量在上游标为 `[ASSUMED]`，目前没有原版实测资料明确多人甄选权重；此处不作为官服机制或上游 PR 的依据。
- 战斗基准：重新计算 287 个场景，仅 `coop2-NORMAL-70-diy` 与 `coop2-NORMAL-5-coverage-diy` 变化；甄选权重改变导致商店选择、阵容及后续战斗和随机数计数不同，两者仍在第 14 回合胜利，队伍剩余生命分别由 55 → 51、30 → 46。其余 285 个场景不变。
- 验证结果：甄选权重、商店、晋升奖励、随机发卡、个人库存隔离、买卖／耗尽、拟态、禁用／等级门槛、AI 自选采购、开局重选及文档检查共 79 项通过；287 个战斗基准更新后复核全部通过。修改文件的 ESLint 与 `git diff --check` 通过。

## 谢拉格不融冰可由天赋持续伤害触发（2026-10-11，本地修复）

- 将不融冰的触发由攻击事件改为携带者对敌人实际造成伤害时判定；阿斯卡纶「死亡拘审」的每秒法术伤害现在也有触发机会。
- 依据 PRTS 盟约记录对游戏文字的修正：原文“攻击时”，实际为“造成伤害时”。普通／进阶装备仍为 12%／20% 概率、1.5 秒寒冷，多件独立判定。
- 元素损伤积累、生命流失、无来源伤害、零伤害和装备衍生伤害不触发；阿斯卡纶天赋伤害仍不视为攻击，不额外叠加天赋层数。其他装备的触发逻辑不变。
- 装备、阿斯卡纶及文档检查共 104 项通过。战斗基准重算有 24 个场景变化，具体名单与原因记录在 `docs/history/0.2.4.md` §29.17；其余 263 个场景不变。

## 投资人发装备与装备溢出缓存（2026-10-11，本地修复）

- 修复缪尔赛思、洛洛、诗怀雅等获得时制造装备被库存上限截断的问题；投资人的两次／三次触发完整发放，装备仍占用共享库存，普通购买和库存抽取仍受限。
- 库存例外依据 issue #488 中修正后的社区反馈，尚无独立原版实测，机制文档标为 `[ASSUMED]`；不把制造的装备视为不占库存。
- 按 PRTS 帮助的隐藏溢出规则，装备在普通整备区及五个临时位都满时进入隐藏缓存；出现空位后自动补入，仍参与合成和库存统计。隐藏缓存按发放顺序补入为 `[ASSUMED]`。
- 保留原有临时装备的回合销毁期限；准备按钮的待处理数量包含隐藏装备，隐藏装备不能通过猜测编号直接装备／销毁。淘汰时清空。
- 机制见 [design/match.md](design/match.md) §6.2 的 “Equipment beyond temp”；本次不修改版本历史文档。
- 战斗基准重算仅 `coop2-NORMAL-5-coverage-diy` 变化：制造装备完整发放改变 AI 后期装备、阵容和后续战斗结果，仍于第 14 回合胜利，最终团队生命值由 37 变为 46；其余 286 个场景不变。更新后全部 287 个场景复核通过。
- 验证：装备发放、临时区、库存、合成、画卷、准备与清理相关 199 项测试，准备按钮计数 2 项测试和文档 31 项检查通过；修改文件 ESLint 无错误，类型检查与 `git diff --check` 通过。`playtest3.test.js` 的完整旧套件仍有一项原有 CSS 布局断言与伤害面板布局不符，本次未改动 CSS，也未宣称完整 CI 通过。
- 修复分支为 `fix/trait-equipment-overflow`，合入 `deploy` 后供开服使用；实际部署状态记录在本地工作区运维文档。

## 可选的已激活盟约招募加成（2026-10-13，本地规则）

- 房间开关“盟约招募加成（本地规则）”默认关闭；单人／多人均可由创建者在开局前设置，开始后锁定，同房间下一局保留设置。
- 自然刷新、手动刷新时，各玩家自己的已激活盟约相关干员卡抽取权重 ×1.2；同一卡匹配多个盟约只加一次。随机禁用名单中的盟约若通过其他干员／装备实际激活，也计入；模式禁用盟约不计入，禁用卡仍不可抽取。自选卡使用本人选择干员的实际盟约，沿用已有个人库存加权。
- 不改变库存、等级门槛、禁用卡、装备抽取、随机赠卡和晋升奖励；没有激活盟约时按原权重抽取，不增加随机数调用。
- 商店提示当前下次刷新会加权的盟约，卡片记录刷新时匹配的盟约；冻结后即使阵容改变，仍显示该卡原先的匹配理由。+20% 指相对抽取权重，不是概率增加 20 个百分点。
- 用户确认仅用于本地修改，不合入上游；本次没有远端部署。
- 本地分支为 `feat/active-bond-shop-weight`。相关 76 项测试通过，四种语言文本检查、类型检查和差异格式检查通过；页面确认了默认关闭、切换后的状态，以及桌面／手机尺寸下的开关可见性。

上述规则是否已部署以工作区运维文档中的部署记录为准；正在运行的对局继续使用启动时加载的代码。

## 悬赏联防真人优先（2026-10-14，本地规则）

- 用户要求：漏出的敌人中有仍携带正数击杀赏金的悬赏怪时，优先让本轮没漏怪的真人参与联防，并在右侧先接敌；AI 排在后方兜底。
- 最多两名协防者。两名合格真人可占据两个名额；只有一名时搭配原排序最优的合格 AI。真人之间、AI 之间沿用原场上人数、盟约、存活数等排序；漏怪或已淘汰的真人没有协防资格。
- 没有有效悬赏怪漏出时沿用原规则；不计数漏怪、失去赏金的分裂子怪、无法重新入场的未知敌人、按完美防守结算的悬赏不会误触发。
- 调整整场联防的人员和前后场顺序，不另改悬赏怪路线。赏金仍按实际击杀归属，漏怪扣血仍归来源玩家，不保证 AI 完全无法击杀悬赏怪。
- 本次仅本地实现，不属于上游原版规则；未增加房间选项，不修改版本号或为此增加版本历史记录。

## AI personal combat policy (2026-10-14)

The local lobby enables `terrain-parity-v12` for four-player ABYSS rooms with one to three AI teammates. It combines PR 445 personas, measured build scoring, expanded placement candidates and player-legal preparation-end rehearsals. The effective budget is eight layouts and three independent samples per layout. Public draft choices and focus remain reserved; the AI chooses available Russell, Touch, then Amiya fallback bands. Other modes and human autoplay do not receive this selected policy. Set `SP_BOT_POLICY=off` before starting the server to disable it. This does not change combat rules, card costs or player resources.

Selection evidence: 336 controlled full-match comparisons, seven maps and 42 cases across three team compositions, rounds 1–11. Each population is normalized per AI and weighted equally; round 11 has half weight. Selected policy / player-aligned PR 445 / player-aligned baseline mean own-clear rates were 79.9% / 74.8% / 61.4%. The runner controls human leaks and does not model human purchasing. This is the highest point estimate in this sample, not a guarantee of perfect play or a conclusive win over the close second candidate. All raw records and alternate policies remain in the local experiment archive.

Follow-up on `fix/ai-ranged-opening-block`: add optional ranged ground-blocking and forward-facing proposals to this
policy's existing rehearsal budget. Do not attribute the preceding 336-match results to the modified candidate set.
Fixed diagnostics with four-player ABYSS values reduced two-Vendela R1 leaks from 37 to 9 across 14 map/seed cases.
A separate injected Gummy/Insider/two-Vendela lineup over 28 R1/R7 cases produced 199 baseline leaks, 139 with ground
proposals only, 145 with forward proposals only and 118 with both. R7 uses injected elite units without an economy
trajectory; these are mechanism diagnostics on seen seeds, not new full-match validation. Turning existing layouts
RIGHT without moving them improved 5 cases, worsened 5 and tied 18. The intermediate opening-only candidate and
all diagnostic inputs, results and source snapshots are preserved in the workspace experiment index.
The combined proposal improved 10 cases, tied 17 and regressed one (seed 1801, act2autochess_m01 R7, 0 → 2 leaks).
It changes which candidates fit the fixed budget and is not guaranteed to retain the old winner. The fix remains
on its feature branch pending broader evaluation; the deployed v16 result is still the preceding implementation.

Mire follow-up: prioritize dry-ground and dry-ground-blocking proposals within the same eight-layout budget.
Existing simulation already applies mire stacks (observed ASPD 100 → 50 at ten stacks), damage, healing and deaths;
the gap was candidate coverage. The four-unit 28-case comparison retained baseline/ground/forward/combined/safe
totals 199/139/145/118/118. A six-unit mire-only R3/R7 diagnostic retained all five policies with totals
16/16/17/16/16. Safe versus combined: one R7 case improved 7 → 6 leaks and 2 → 0 deaths, another regressed
7 → 8 leaks; the aggregate is tied, not evidence of a stable overall gain. No hard terrain ban is applied.
The diagnostic replay now uses production `botPrepEnd` multipass legal placement instead of a one-pass sequence
that can fail on a legal swap refusal. The interrupted initial six-unit batch is retained and excluded from selection.
Full raw inputs/results, per-unit mire exposure/ASPD/damage/healing/deaths and source snapshots are archived;
these injected-roster scenarios do not reproduce the screenshot's exact game or a complete economy trajectory.

Route-defense follow-up: the old mandatory road preference covered self-range melee guards and selected ranged
units, but extended-range melee units could still stand off the path. The additional `botRouteBlockCandidates`
family gives melee blockers road preference and scores marginal blocking capacity separately on each ground route
(diminishing returns). It also tries two durable ranged blockers and, on mire, a dry variant. Pure healers retain
their supported-placement rule. These are proposals within eight layouts, not extra combat capacity or forced final
placements; real simulated leaks/health still decide, and lower-priority old candidates can be displaced.

The six-unit mire diagnostic rerun (`ai-route-block-mire-candidate1-20261014`) saved all six policies:
baseline/ground/forward/combined/mire-safe/route-block totals were 16/16/17/16/16/15 across eight cases. Versus
mire-safe, seed 1803 R7 improved 2 → 0, but seed 1804 R7 regressed 6 → 7; do not omit that regression.
The seven-unit diagnostic (`ai-route-block-seven-candidate1-20261014`) injects Indigo, Vendela, Insider, Underflow,
Texas and two Caper copies, normal at R3 and elite at R7. Across seven maps, two seen seeds and those two rounds,
the six totals were 75/62/66/64/61/58. Route-block versus mire-safe improved one case and tied 27; the improvement
was seed 1802, act1autochess_m04 R7, 17 → 14 leaks, with planned capacity on several routes increasing 5 → 6.
These are fixed-state mechanism diagnostics, not the screenshot's exact roster, independent validation, or full
economy/coop trajectories. Candidate plans, route capacities, final battle inputs/results, telemetry, all losing
policies and source snapshots are retained and indexed. The production policy gate enables this follow-up only
on the feature branch; deploy and the running remote server have not been changed by this work.
