# FastFighting D&D 5e: developer notes

How this helper teaches FastFighting Core the dnd5e system. For what it does at the table, see [README.md](README.md). The core's helper API (`SystemAdapter`, `CombatantSpec`, the rules object, hooks) is in the core's [developer docs](https://github.com/galaara98/FastFighting/blob/main/CODING_README.md).

## How it plugs into the core

`scripts/main.js`:

- On `init`: registers the **Lore-Collector advantage** world setting (`lore.js`: `loreBoost`, 1.25 to 3, step 0.05, default 2.5).
- On `fastFighting.init`: does nothing outside a `dnd5e` world (module.json's `relationships.systems` already limits it; this is a guard). Then it checks the core's API version (below) and, unless the core is too old:
  - `api.registerAdapter("dnd5e", Dnd5eAdapter, { priority: 10, source: "fast-fighting-dnd5e" })`;
  - `api.adviseTranslation(MODULE_ID, game.system.title, KNOWN_TRANSLATIONS)`: in another language, the settings name the last translation we knew of (`es`: translate-dnd5e-sdr2-es);
  - `api.keepEnglish(MODULE_ID)`: the keys in `hardcoded-toEN.json` stay English.
- On `ready`: warns a GM when FastFighting Core isn't active (`FFDND5E.NeedsCore`).

### The core's API version

The core's API version is `major.bug`: `api.version` is `"19.0"`, `api.major` 19, `api.bug` 0. The helper decides whether it works with a core; the core never refuses it. `KNOWN_API` in `main.js` lists the API majors this helper is known to work with, now `[18, 19]`.

- Below the oldest major listed, it doesn't register, and tells the GM the core is too old (`FFDND5E.CoreTooOld`).
- On any other major it isn't known to work with, it registers, and warns the GM once that it hasn't been tried with that core (`FFDND5E.CoreUntested`).

When a new core major arrives, test the helper with it and add the major to `KNOWN_API`.

Everything taken from the core goes through `scripts/core.js`, which re-exports `../../fast-fighting/scripts/core-api.js` (in Foundry both modules sit in `Data/modules`; the tests alias the path).

When new functionality can't be played "close enough" with what the core already offers, asking for a new core hook is the right move, rather than forcing a poor fit or working around the core. (API 17 replaced several of this module's workarounds with core hooks.)

## Files

| File | What it does |
| --- | --- |
| `main.js` | Registration (above). |
| `core.js` | The core API, re-exported. |
| `adapter.js` | `Dnd5eAdapter`: actors into `CombatantSpec`s, actions, reactions, riders, summons, traits, tactics, live-battle entry points. |
| `rules.js` | `dnd5eRules`, the rules object, and `proficiency(level)`. Pure. |
| `effects.js` | Effect changes and spell words into buffs and debuffs. Pure. |
| `riders.js` | What rides on a hit (smites, Stunning Strike, maneuvers). Pure. |
| `edges.js` | Help, Insight before talking, the Study check. Pure. |
| `holds.js` | Breaking grapples, restraints and bonds; escape words and DCs. Pure. |
| `inside.js` | Swallowed and engulfed: a gullet's hold, being brought up, out of a corpse. Pure. |
| `multiattack.js` | A Multiattack description into strike sequences. Pure. |
| `traits.js` | Personality traits and flags. Pure. |
| `auto.js` | Playstyle hints, "Let this character decide" answers, biography, languages. Pure. |
| `leadership.js` | Ranking leaders and their bonus. |
| `conditions.js` | dnd5e statuses and the core's conditions, both ways. |
| `commit.js` | Writing a live turn onto a sheet, the fight's summary lines, handing things over. |
| `read-turn.js` | A player's turn from dnd5e's chat cards. |
| `lore.js` | The Lore-Collector setting. |
| `words.js` | Words for the table: the system's own names first, then this module's (`FFDND5E`). |

## The adapter

`Dnd5eAdapter` (`systemId = "dnd5e"`) overrides: `label`, `rules`, `canHandle` (actor types `character` and `npc`), `toCombatantSpec`, `deriveTraits`, `playstyleHints`, `tacticHints`, `biography`, `detectLeaders`, `itemCatalog`, `describeRegionBehavior` (`dnd5e.difficultTerrain` → `{difficult: true}`), `term` (`DND5E.AC`, `DND5E.HP`), `resourceLabel`, `supportsLive` (true), `placeSummons`, `commitChanges`, `sheetCarries`, `conditionLabel`, `conditionChoices`, `readTurn`, `damageCard`, `applyDamageCard`, `appliesPlayerDamage`, `rollStrike`, `rollSave`, `rollCheck`, `useAction`, `rollDamage`, `reactionsOf`, `rerollResource`, `describeOutcome`, `commitConcession`. It leaves `supportsLoot` false, so the core hides its loot and corpse settings.

It's written against dnd5e 6 on Foundry v14, and reads values defensively so older data still works (`s.method ?? s.preparation?.mode` and the like).

### The spec

`toCombatantSpec` sets, beyond the usual (HP, defenses, speeds, actions):

- `level`: character level, or challenge rating. `kind`: `pc` or `npc`. `diesAtZero`: every NPC.
- `defenses.ac`, a save per ability (`abilities.<a>.save.value`, else the modifier). `shield: null`: a 5e shield is in the AC.
- `initiative: {mod, stealth}`. `speeds` in feet (`FEET`: m × 10/3, mi, km; 30 walking when it has none).
- `resources` (keys below), `resourceNames`, `riders`, `reactions`, `legendary: {pool}` (legendary actions' max), `standFirm: {pool: "legres", label}`.
- `dying`, `stable`, `deathSaves` from `attributes.death`.
- `regen`, `holdOn` (`#mending`), `fastHealing` (`#lastingHealing`), `burns`, `lingering`, `inside` (`#insideSpec`).
- `magicResistance`, `evasion: "dex"`, `saveAura: {bonus, range}` (`#saveFeatures`).
- `conditions` (`sheetConditions`), `perception`, `senses: {lowlight, feel}`, `mods` (`#activeMods`: dice on attacks and saves, helpful statuses and a spell's words, for effects already on it).
- `fateLabel`, `firstAid: {mod}` (characters and humanoids with Medicine), `theft` (Sleight of Hand: characters, or a non-beast with Intelligence above 3), `doorWork: {force, pick}`.
- `rulesVersion`: `"modern"` or `"legacy"` from dnd5e's `rulesVersion` setting (modern when there's none). `escapeWork: {mod, ath, acr, str, dex}`, `escapeDC` (`#escapeDC`).
- `sizeUp` (`studyCheck`; none for the mindless), `creatureTraits: [type]`, `creatureKind: "type:subtype"`, `size` (0 tiny to 5 gargantuan), `throughLarger` (Halfling Nimbleness).
- `social`: `pitches` (persuade, intimidate, deceive), `resist` (passive Insight against all three, passive Perception against `steal`), `resolve` (Wisdom save − (proficiency + 1)), `languages`, `mindless`.
- `valuables`: money in copper, `denominations` (pp, gp, sp, cp), `stowed` and `wielded` items with `category`, `material` (`ada`, `sil`) and `rarity`.
- `leadership` (none for Intelligence 3 or less).

### Resource keys

`slots:<level>`, `pact`, `fate` ((Heroic) Inspiration), `legres` (Legendary Resistance), `feature:<itemId>` (a feature's uses: Focus or ki, superiority dice, Relentless Endurance), `item:<itemId>` (a consumable: quantity × uses left). An action's own limited `uses` may carry `recharge: {on, die: 6}` (`rechargeOf`).

### Actions

`#fromActivity`, per activity:

| Activity | Becomes |
| --- | --- |
| `attack` | `strike` (a weapon or feature) or `spell-attack`; one per projectile in a `sequence` (`projectileCount`); riders from its effects, its Push mastery, `FORCED_MOVES` |
| `save` | a rider on the item's attack when it rides on a hit (`#ridesOnHit`); else `save` (with damage), `control` (no damage: `onSave` per degree) or a tallied affliction (`tallied`) |
| `damage` | `auto` (Magic Missile's darts multiplied) |
| `utility`, `enchant` | `#support`: a `buff`, a mark (`control` with `outcome.mark`: Hunter's Mark, Hex) or a debuff `control` |
| `heal` | `heal`; temporary hit points or a raised maximum become a buff; lasting healing as `outcome.fastHealing` |
| `summon` | `#summonFrom`: `summon` with up to 8 creatures |

A `save` or `damage` action's `area` is `{targets, shape, feet, angle, width}`: `targets` from `areaTargets`, the rest from its template's `areaTargetTypes` key (`areaOf`, in feet). `cone` (53.13°) and `line` (5 feet wide unless it says) come from the user; `cube` and `square` a `cube` against the user; `sphere`, `cylinder` and `circle` a `burst` (an `emanation` at range self); `radius` (dnd5e's emanation) an `emanation`. Put down away (at a touch, anywhere, or farther off than its size), a `radius` is a `burst`, a cube a `burst` half its side, a cone or line nothing; several at once, one `burst` √count as big; `wall` and `ring`, nothing. One from the user reaches as far as it spreads where its range gives no distance (a creature's breath).

Skipped: activations other than action, bonus and legendary (except a spell's push played as its casting); an item's lingering damage activity (`#lingering`); "at Advantage" attack variants (`ADVANTAGE_VARIANT`: their extra damage goes on the plain attack as `bonusDamage` with `when: "advantage"`); `NEVER`; `IDLE_CONSUMABLES` (trinket, food); a character's unequipped weapons; spells that aren't ready (`#spellReady`: for a character, cantrips and `pact`, `innate`, `atwill`, `always` or prepared spells; for an NPC, all).

`#actions` adds: Dodge (`guard`, `setup`), Hide (`hide`, `leans: ["lowProfile"]`, Stealth against 15; a bonus action with Cunning Action; not for the mindless), Help and Insight (`edges.js`; not for the mindless), Reckless Attack and Action Surge (`economy: "free"`), Shove, Shove (prone) and Grapple for characters and humanoids (maneuvers `shove`, `trip`, `grapple`; save `["str", "dex"]` against 8 + Strength + proficiency; `maxSize` its size + 1), Sneak Attack and Radiant Strikes as `bonusDamage`, Extra Attack sequences (`<id>.extra`), bonus strikes (`#bonusStrikes`), Multiattack options, legendary actions that only name an attack, and each action's `hands` (`#hands`). `#atSlotLevels` gives a leveled spell an entry per usable slot (and the pact slot), lowest first; one that doesn't grow gets only the cheapest higher slot.

### Found by identifier

dnd5e's `system.identifier` is the same in every book, edition of the SRD and language. `featureKeys` lists a creature's feature identifiers and English names (Babele's `englishName`); `hasFeature(features, id, name)` matches the identifier, else a name containing `name`.

| What | Identifiers | Where |
| --- | --- | --- |
| Extra attacks | `extra-attack`, `two-extra-attacks`, `three-extra-attacks`, `thirsting-blade` | `#actions` |
| Rogue, barbarian, fighter | `sneak-attack`, `cunning-action`, `reckless-attack`, `action-surge` | `#actions`, `traits.js` |
| Monk | `martial-arts`, `flurry-of-blows`, `heightened-focus`; its pool: `monks-focus`, `ki`, `focus-points`, `ki-points` | `#bonusStrikes`, `#usesItem` |
| Two weapons | `two-weapon-fighting` | `#bonusStrikes` |
| Paladin | `radiant-strikes` (or a name with "improved divine smite"), `aura-of-protection`, `divine-smite` | `#actions`, `#saveFeatures`, `#hitCost` |
| Saves | `magic-resistance`, `evasion` | `#saveFeatures` |
| Getting back up | `regeneration`, `undead-fortitude`, `relentless-endurance` | `#mending` |
| Creatures | `multiattack`, `pack-tactics`, `nimble-escape`, `halfling-nimbleness`, `ooze-cube` | `#actions`, `toCombatantSpec`, `traits.js`, `#inside` |
| Unarmed | `unarmed-strike` (or an attack classified `unarmed`) | `unarmedStrike` |
| Swallowing | `swallow` → swallowed, `engulf` → engulfed (`INSIDE`); else an effect with `coverTotal` and Restrained is a swallow; 2014's bite by `bite` | `#inside` |
| Reactions | `shield`, `counterspell`, `hellish-rebuke`, `uncanny-dodge`, `deflect-attacks`, `deflect-missiles`, `parry`, `riposte`, `death-burst`, `protection`, `fighting-style-protection` | `#reactions` |
| Riders on a hit | `ON_HIT`: the smites, `eldritch-smite`, `stunning-strike`, the Battle Master maneuvers (`precision-attack`: a die on a miss); their pool `combat-superiority`, `superiority-dice` | `riders.js`, `#onHit` |
| Pushes | `FORCED_MOVES`: `thunderwave`, `gust-of-wind`, `thunderous-smite`, `repelling-blast` (lends to `eldritch-blast`), `whirlwind`, `repulsion-breath`, `cold-gale`, `hammer-throw`, `forceful-hand`, `deadly-leap` | `#forced` |
| Not creatures | `NOT_CREATURES`: `spiritual-weapon`, `flaming-sphere`, `arcane-sword`, `mordenkainens-sword`, `bigbys-hand`, `arcane-hand` | `#summonFrom` |
| Never used | `NEVER`: `staff-of-the-magi`'s `retributive-strike` | `neverUsed` |
| Story looks | `WEAPON_LOOKS`: firearms' base items → ballistic, `laserpistol`, `laserrifle` → laser; the `fir` property → ballistic | `weaponLook` |

`FORCED_MOVES` leaves out pushes chosen instead of something else (Brutal Strike, Open Hand Technique), moves that put a creature anywhere (Telekinesis), and identifiers other creatures share without the push (`tail`, `charge`, `hooves`, `warhammer`, `breath-weapons`). Of weapon masteries, only `push` plays (`masteryOf`, `PUSH_MASTERY`: 10 feet, Large or smaller), and only the weapon's own.

Personality and tactics key on identifiers too: `traits.js` (`CLASS_LEANS`, `SUBCLASS_LEANS`, `BACKGROUND_LEANS`, `ITEM_LEANS`, `SKILL_LEANS` by skill key, `ALIGNMENT_LEANS`, `LOYAL_BY_KIND` by type or subtype word; `effectLeans` reads `system.traits.ci.value` and `system.abilities.wis.save.roll.mode` changes, half for a disabled effect) and `auto.js` (`CLASSES`, `SPECIES`, `CREATURES`, `ALIGNMENTS`; for tactics `GUARDS`, `MELEE_STYLES`, `EVERY_FIGHT`, `FINISHERS`, `FANATICS`, `ENDURING`, `HUNTERS`, `COMMANDERS`, `LIFE`, `LIFE_FEATURES`, `MONEYED`, `PEOPLE`, `STYLE_WEAPONS`, `ITEM_USERS`, and single identifiers such as `agonizing-blast`, `pact-of-the-blade`, `patient-defense`). `leadership.js` matches `LEADER_FEATURE` against identifiers and names (Pack Tactics excluded).

### Read from words

Everything is read from the item's English (`englishDescription`: what Babele keeps), as plain text (`plainText` resolves `&Reference`, `[[/item]]`, `[[lookup]]` and `@UUID` enrichers). A pattern that could backtrack across a long, player-written description is searched a sentence at a time (`inSentence`, sentences of at most 1000 characters; Regeneration's words).

| What | Function or constant |
| --- | --- |
| Multiattack, 2014 and 2024 phrasing, up to 4 options; a hydra's heads count as 5 | `parseMultiattackOptions` |
| Regeneration's amount and what stops it | `regenerationFrom` |
| Regenerate's hit point a turn | `lastingHealingFrom` |
| Undead Fortitude's save | `holdOnFrom` |
| Contagion's three successes or failures, and its weakened saves | `tallyFrom`, `tallied` |
| Setting alight | `setsAlight` |
| Damage at the end of the target's next turn | `LINGERING_WORDS` |
| Darts, rays and beams, and more per slot level | `projectileCount`, `moreProjectilesPerLevel` |
| A grab's escape DC, with dnd5e's `[[lookup]]` | `grabEscapeDC` |
| The check that breaks webs, plants and nets (2014 prose, 2024 enrichers) | `escapeWords` |
| A legendary action that names an attack; "(Costs 2 Actions)" | `legendaryAttack`, `legendaryCost` |
| Swallow sizes, grappled-only, pushed clear, damage to bring it up | `SMALLER`, `GRAPPLED_FIRST`, `CLEAR`, `SPIT_AFTER` |
| A push's distance in words | `forcedMoveOf` (`byWords`) |
| A rider with no attack of its own ("after you hit") | `HIT_WORDS` |
| A save beside an attack tied to its hit | `#ridesOnHit` |
| A save's condition with no effect ("or be knocked prone"), and its duration | `#effects` |
| What a spell's changes can't say | `fromWords` (`WORDED`) |
| A reaction that answers damage (Hellish Rebuke and the like) | `#reactions` |
| A summon commanded with a bonus action | `#summonFrom` |
| Languages ("Common plus one other language"; "understands ... but can't speak") | `spokenLanguages`, `speaksAtAll` |

### Effects

`modsFromChanges` reads only these changes (`modeledChange` says which): mode ADD (2) on `system.bonuses.{mwak,rwak,msak,rsak}.attack` and `.damage`, `system.rolls.damage.*.bonus`, `system.bonuses.abilities.save`, `system.attributes.ac.bonus`, movement (`walk`, `all`, `bonus`, `speed`), `system.attributes.hp.temp`/`tempmax`, `system.traits.dr.value`, `system.traits.di.value`; MULTIPLY (1) on `system.attributes.movement.multiplier`; ADD, UPGRADE (4) or OVERRIDE (5) on `system.magicalBonus`. A lone die stays a die (`attackDie`, `saveDie`); anything else is its average. Statuses map through `EFFECT_CONDITIONS` (Restrained adds `immobilized`, Unconscious adds `incapacitated`, Charmed is `controlled`, Grappled becomes the core's grab); `STATUS_MODS` gives Invisible `{adv: 1, defAdv: -1}`. `durationRounds`: round and turn 1, minute 10, hour 600, day 14400.

## Rules

`dnd5eRules` (`rules.js`), by the core's keys:

| Keys | 5e |
| --- | --- |
| `mainPool: "action"`, `movement: "feet"`, `turn(u)` | `{action: 1, bonus: 1, move: walk speed, slot: 1}`; Slowed: no bonus |
| `costOf`, `basicAction`, `talkCost`, `tauntCost`, `firstAidCost`, `stealCost`, `feintCost` | an action (a bonus action for `economy: "bonus"`, nothing for `"free"`), plus `slot` for `slots:*` or `pact`; a feint is free |
| `reactions(u)`, `opportunity`, `disengage` | 1 a round (0 Slowed); none while incapacitated; Disengage a bonus action with `flags.nimble` |
| `concentration` | Constitution, DC max(10, half the damage), at most 30; broken by incapacitated, paralyzed, stunned, unconscious, petrified |
| `door`, `doorCosts`, `doorDamage` | AC 15, 18 HP, threshold 0, force and pick DC 15; open free, force or pick an action |
| `standCost`, `handsKnown`, `fallDamage`, `fallProne`, `handlesCover`, `passThrough` | half the walk speed; hands per action; 1d6 per 10 feet (max 20d6), prone only if hurt; cover 5e's own; through allies, the down or incapacitated, Tiny or two sizes off (`throughLarger` too) as difficult |
| `escapeFrom`, `bondsDC`, `breakFree`, `escapeCost`, `untieCost` | `holds.js`; each an action |
| `conditionHarm`, `conditionProfile`, `remedies` | burning 1d4 fire (or `spec.burns`) at turn start; corroding from `spec.lingering`, no remedy; swallowed or engulfed: `spec.inside.harm` at turn start, no core mods; dousing (`dnd5e:burning`) |
| `holds`, `afterHarm`, `letGo` | `inside.js`: no way out of a gullet; brought up after `spit.after` damage and a failed save; out of a corpse Prone |
| `degreeOfSuccess`, `roll`, `attackPenalty`, `saveMultiplier`, `critical`, `applyIwr` | 20 crits and 1 misses (attacks only), else meet the DC; half on a save unless `basic: false`; dice doubled; immunity, resistance halves (down), vulnerability doubles |
| `initUnit`, `onDropped`, `adjustRoll`, `onHealed`, `recoveryCheck`, `firstAidDC`, `firstAid`, `knockOut`, `capture` | death saves; Relentless Endurance as a save that spends its pool; DC 10 Medicine |
| `persistentFlatCheck` | even odds |
| `typical` | AC 12 + prof, save prof + 1, skill prof + 2, DC 10 + prof |
| `modifiers.{exposed, defense, attack, save, check, steal, actionsLost}` | advantage, disadvantage (hidden: both ways), cover, exhaustion (−2 a level), auto-failed Strength and Dexterity saves, Contagion's `weakSave` |
| `isImmune`, `conditionWishes`, `conditionWeight`, `conditionMods` | immune to every condition an action lays (aliases: incapacitated → unconscious, immobilized → restrained, controlled → charmed), and size limits; Frightened: `avoid` its source at 60; hidden and prone mods |
| `usable`, `afterRoll`, `pullsBlow`, `storyDamageType` | no Hide beside a foe, `grappledOnly`; hidden ends on an attack, after its roll; any melee blow can knock out; lightning → electricity, thunder → sonic, necrotic → void, psychic → mental |

`holds.js`: a grapple is the better of Athletics and Acrobatics against the grappler's `escapeDC` (its words', else 2024's 8 + Strength + proficiency, or 2014's passive Athletics); with no known grabber, the hardest `escapeDC` among standing foes within their reach, else `typical.dc`. Webs and nets use the checks `escapeWords` read. Rope (`ROPE`): 2024 escape 15 or burst 20; 2014 burst 17; a friend unties with no roll.

`inside.js`: `insideHolds` offers the gullet's hold with no DC so nobody spends a turn on it; `spitUp` counts damage from inside per turn and makes the holder's save at once (the SRD: at the end of the turn).

## Live battles

`conditions.js` maps statuses to the core's keys (`READ`): `grappled` → grabbed + immobilized; `restrained` → restrained + immobilized; `paralyzed`, `petrified`, `stunned`, `unconscious` → themselves + incapacitated; `sleeping` → asleep + unconscious + incapacitated; `hiding` → hidden; `burning`, `silenced` and the rest → themselves. The first key is the one written back (`SHEET_STATUSES`); `WRITES` adds `controlled` → `charmed`. A status this world's dnd5e lacks isn't written (`hasStatus`). Exhaustion goes to `system.attributes.exhaustion`.

`commitDnd5eChanges` writes one turn's changes, so writing twice changes nothing more, and returns an undo record (its shape is at the top of `commit.js`):

- `system.attributes.hp.value` and `.temp`; a character's `death.success` and `.failure`;
- `system.spells.pact.value`, `system.spells.spell<n>.value`, `system.attributes.inspiration`, `system.resources.legres.spent`, an item's `system.uses.spent`, a consumable's quantity (deleted at 0);
- statuses with the core's `toggleStatus`, before HP (dnd5e adds Bloodied itself); Unconscious and Prone on falling; `dead` as an overlay, and the combatant defeated;
- fled NPCs hidden unless `options.fledMode === "leave"`; the surrendered get an ActiveEffect (`FFDND5E.Surrendered`, `icons/svg/cancel.svg`, flag `surrendered`);
- spell effects laid with `layEffect` from the action's `effectRef`, for the rounds left, flagged `fast-fighting.laid: {key, sourceId}` so `liftEffect` takes them off.

`commitDnd5eConcession` pays coins with the core's `payFrom` (`COINS`; the receiver gets gp, sp and cp) and hands items over with `handOverItem`, unequipped and out of any container. `describeDnd5eOutcome` gives the planner's summary lines. `placeSummons` uses dnd5e's own `Actor5e.fetchExisting`, `activity.getChanges` and `getTokenData` (no rolled NPC HP), and falls back to the core's way. `readDnd5eTurn` reads dnd5e 6 cards (`system` data) and older ones (`flags.dnd5e`): attacks (hit against the target's AC, `sure` when the AC is known), damage onto the last hit, healing, and Persuasion, Intimidation or Deception checks (never `sure`). `reactionsOf` lists a reaction spell once, whatever its slot, and never a passive or free one.

Players' damage (API 19): `damageCard` is `damageCardOf` (`read-turn.js`: the damage rolls' total, healing for a `healing` card or one of healing types only, targets by `system.targets[].token`, `save` for an `onSave` of `half` or `none`); `applyDamageCard` is `applyDnd5eDamageCard` (`commit.js`: `actor.applyDamage` with the tray's damages and `{multiplier, isDelta, originatingMessage, origin}`, as dnd5e's damage tray calls it; undo: stored HP, temp and tempmax, death saves at 0, items and effects made or removed, `statusesBefore`); `appliesPlayerDamage` is null (dnd5e's `allowPlayerDamageTray` and `autoApplyDowned` don't apply players' damage; Midi-QOL isn't asked).

`rollStrike` (API 19) is `rollDnd5eStrike` (`adapter.js`), for every strike in a turn FastFighting plays and for reactions: the strike's attack activity by its id (`attackActivityOf`; a legendary copy, the item's attack; a Multiattack's part, `<multiattack>.<k>.<i>`, the attack its name names, `activityNamed`), rolled with `activity.rollAttack` (no dialog; the attack mode it's made in, a throw's for a throw, dnd5e's own for a shot, else in hand; the engine's advantage or disadvantage; message `rollMode: "gm"` when secret; the target's AC as the roll's `target` and its `TargetsField` descriptor as the cards' `system.targets`, so the user's own targets are untouched); on a hit `activity.rollDamage` (`isCritical` on a critical), damage by type from `damagesOf`; null with no such attack or no AC to hit.

`rollSave` and `rollCheck` (API 19) are `rollDnd5eSave` and `rollDnd5eCheck`, for every save and check in a turn FastFighting plays: `actor.rollSavingThrow`, `rollSkill` or `rollAbilityCheck` with the DC as `target` (no dialog; the token the cards' speaker; `rollMode: "gm"` when secret), graded by `dnd5eRules.degreeOfSuccess` with the kept d20. A save is the spec's key; of several (a shove's `["str", "dex"]`) its better; a Constitution save for an item of its own that takes concentration (by the action id the engine sends, else by name) is `rollConcentration`. A check's skill is `checkOf`'s: the helper's own actions by key (`OWN_CHECKS`: `hide` Stealth, `insight` Insight), the skill named (a dnd5e key, or this client's name for it: the spec names pitches' and theft's skills so), a talk by its kind (`TALK_SKILLS`), else by purpose (`PURPOSE_SKILLS`: `theft` Sleight of Hand, `firstAid` Medicine, `escape` the better of Athletics and Acrobatics); none else (`cast`, `heal`, `disengage`, a taunt's skill in another language), null. Neither returns `{gm: true}`: shoves and grapples are the target's save in both rule sets (2014's contests aren't played). The helper's own escapes (`holds.js` `breakFree`) ask the core's `systemRolled` (core-api) as the engine's own do (purpose `escape`, the one held the target, the hold's key the label, the way's dnd5e key as `skill`: `acr`, `ath`, `str` and the like) and take its answer as rolled; against the same DC, so 2014's grapple contest stays the engine's DC of 10 + the grappler's Athletics, the escaper alone rolling.

`useAction` and `rollDamage` (API 19) are `useDnd5eAction` and `rollDnd5eDamage` (`adapter.js`), in a turn FastFighting plays: `useAction` for a spell, a save or damage action, and a buff or heal with no check of its own; `rollDamage` for a save's or a damage action's damage. Both find the action's item and activity with `activityOf`: the id `<actor>.<item>.<activity>` (`#fromActivity`) with whatever `#actions` adds after it (`.0`, `.extra`, `@slots:3`, `@pact`), the slot as dnd5e keys it (`spell3`, `pact`; none, the spell's own); a Multiattack's part (`<multiattack>.<k>.<i>`) or a legendary copy (`<item>.legendary`) by its name (`activityNamed`, as `#fromActivity` names them); the helper's own that are a feature's (`OWN_FEATURES`: `<actor>.reckless`, `<actor>.action-surge`) by the feature's identifier or English name, its first activity. The rest of the helper's own (Dodge, Help, Hide, a shove) name no item: null.

- `useDnd5eAction`, for a `save`, `damage`, `heal`, `utility` or `enchant` activity (`SHOWN`): `activity.use({consume: false, create: false, concentration: {begin: false}, subsequentActions: false, spell: {slot}}, {configure: false}, message)`, the usage card as the sheet makes it, with nothing spent (slots, uses, recharge, actions), no template or summons, no concentration, and no damage or healing rolled after it. The message: the targets' `TargetsField` descriptors as `system.targets` (the user's own targets untouched), the token its speaker, `rollMode: "gm"` when secret. `{card}`, the usage card's id; null for an attack (its `rollStrike` card shows it), a summoning, an action with no item, a feature with no activity, an activity whose `canUse` is false, or no card made. (The core doesn't ask for a buff or heal that a check lands: Hide, Insight; the check's card shows it.)
- `rollDnd5eDamage`, for a `save` or `damage` activity (`ROLLED_ONCE`): `activity.rollDamage({}, {configure: false}, message)`, as the usage card's Damage button rolls it: on the activity of `item.scaledClone(scaling)`, `scaling` the card's `system.scaling` (with no card, `scalingOf`: the slot's level, or a pact spell's pact slot's, less the spell's own); the card as `system.origin`, its targets as `system.targets`. Damage by type from `damagesOf` (`untyped` for none), as rolled; `card`, the damage card (the rolls' `parent`). Null for an attack, healing, or darts (`dartsApart`: a spell's damage activity of several darts; dnd5e's Magic Missile rolls one dart, the spec counts them all, so the engine rolls it).
- The core applies each target's share with `applyDamageCard` and its save's `multiplier`: `applyDnd5eDamageCard`, `actor.applyDamage` at that multiplier. dnd5e multiplies each type and truncates the sum, so a half can be a point off the engine's per-type floor; the target takes what its sheet lost. At 0 nothing is applied and no record made.

What could apply it twice (all the GM's cards, since the GM's browser rolls them):

- The damage card's tray: dnd5e shows every GM Apply Damage, at the card's targets or the selected tokens. Pressing it applies the damage again, over FastFighting's share, and Rewind doesn't take it back. A strike's damage card from `rollStrike` is the same.
- The usage card's buttons: Damage rolls a second damage card (applied only if someone applies it); a save's buttons roll targets' saves; Healing; Place Template lays a second area; the effects tray lays the spell's effects (Bless, Hold Person's Paralyzed), which FastFighting lays itself. There's no Consume or Refund button, as nothing was consumed.
- A module acting on dnd5e's hooks (`dnd5e.preUseActivity`, `dnd5e.postUseActivity`, `dnd5e.rollDamage`: Midi-QOL's workflows and auto-apply) could roll or apply it again. None is checked.
- Not the core: it reads damage cards as a player's only while a player's turn is open (`onMessage`), and these are made in a turn FastFighting plays.

Uncanny Dodge's reaction spec says `applies: "halve"`: in a live battle the blow it's used against is applied through `applyDamageCard` with `halve` (dnd5e's own `applyDamage` at a multiplier of 0.5), not the engine's sum.
Surprise (API 19): `rules.surprise` (`rules.js`, the planner's Follow System): each hidden token rolls Stealth (d20 + Stealth); anyone against them whose passive Perception (10 + Perception) is under every roll is surprised: `surprised` under the 2014 rules (its first turn lost, no reactions until then), `disadvantage` on initiative under the 2024 rules (the creature's `rulesVersion`). No surprise round.

## Safety

Item data is a player's to write, and the GM's client acts on it:

- Summon formulas are filled with `Roll.replaceFormulaData` and worked out as arithmetic (`formulaNumber`, `plainDice`), never evaluated; `summonDice` refuses anything but dice and numbers.
- `mayCall`: a summoning calls only a creature each of its players could open (a compendium) or owns (a world actor). The creature is a temporary copy, never saved.
- `embedded`: a biography's `@Embed` is followed only for Foundry UUIDs (none with `://`), the first 5000 characters, and only pages its players could read.
- `asPlayed`: an effect from a player's item is copied onto another sheet with only the statuses the engine plays, the changes it reads (no `macro.*`), and `core` and `dnd5e` flags.

## Words

The code holds keys, never English (`tests/i18n.test.js` checks). `t(key)` reads `FFDND5E.<key>`. `words.js` prefers the system's own names (skills, conditions, coins, abilities, alignments, creature types, languages) and uses this module's where the system has none or isn't translated into the reader's language.

`hardcoded-toEN.json` lists words that stay English, whatever the reader's language: keys of `languages/en.json`, or a group (`"FFDND5E.Skill"`), whose translation would contradict an untranslated game system. It holds `lastUpdated` (a date) and `keys` (now `FFDND5E.Skill`, `FFDND5E.Cond`, `FFDND5E.Coin`), and is edited like the language files. Translators copy `languages/en.json` (see **Translating** in the [core README](https://github.com/galaara98/FastFighting/blob/main/README.md)).

## Development

```
npm install
npm test
npm run test:reworded
```

`npm run test:watch` runs vitest in watch mode. The tests import FastFighting Core from a checkout beside this one (`../FastFighting`); set `FASTFIGHTING_CORE` to another core's `scripts/` folder to test against that. `vitest.config.js` aliases `../fast-fighting/scripts/` (and `../FastFighting/scripts/`) to it.

`tests/setup.js` gives every test a `game.i18n` that reads this module's and the core's `languages/en.json` (`tests/foundry-i18n.js`). `test:reworded` (`--mode reworded`) rewords every string (accented, in ⟦brackets⟧, placeholders and markup kept), so no test may depend on wording. `tests/load.test.js` imports every script in Node, as Foundry would load it.

CI: `.github/workflows/test.yml` runs both modes on pushes to `main` and on pull requests, with the core checked out beside. `release.yml`, on a `v*` tag, tests, sets `version` and `download` in `module.json`, zips `module.json`, `scripts`, `languages`, `hardcoded-toEN.json`, `README.md` and `LICENSE`, and attaches `module.json` and `module.zip` to the release.
