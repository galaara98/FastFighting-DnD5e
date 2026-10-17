# FastFighting D&D 5e

> **AI use:** This module used AI in its creation.
> - **Programming:** I am a skilled programmer by profession, but AI was used heavily as a co-pilot.
> - **Strings:** ALL initial strings were proposed by a LLM to get the concepts out, ALL strings were  tracked to make sure they were re-written (for simple or ttrpg/game specific phrases, approved by) a native speaker.

Dungeons & Dragons Fifth Edition support for [FastFighting Core](https://github.com/galaara98/FastFighting), the Foundry VTT module that simulates a battle (or a tense standoff) thousands of times, tells the story of a typical fight, and plays it for real on the Combat Tracker with **Do it For Real Now**.

The core offers a large but fixed set of options: conditions, maneuvers, holds, reactions, resources, outcomes and more. Each system's helper maps its system into them. This one maps D&D 5e; the sections below say how each 5e idea maps, and why.

- **Foundry:** v14
- **System:** dnd5e 4.0 or later (written against 6.0)
- **Needs:** FastFighting Core 0.4.0 or later

## Installation

Install FastFighting Core first, then this module. In Foundry, go to **Add-on Modules → Install Module** and paste:

```
https://github.com/galaara98/FastFighting/releases/latest/download/module.json
https://github.com/galaara98/FastFighting-DnD5e/releases/latest/download/module.json
```

Foundry offers this module only in D&D 5e worlds.

## 2014 and 2024 rules

The module needs only the free SRD, 5.1 (2014) and 5.2 (2024), and reads both wordings; other books add spells and features, read the same way. Grapples, bonds, Burning and fate follow the world's dnd5e rules version, legacy (2014) or modern (2024). A spell or feature plays as the version on the sheet.

| | 2014 | 2024 |
| --- | --- | --- |
| Grapple escape DC, when the stat block gives none | 10 + the grappler's Athletics | 8 + the grappler's Strength modifier + proficiency |
| FastFighting's bonds, taken as rope | DC 17 Strength to burst | DC 15 Acrobatics to slip, DC 20 Athletics to burst |
| Putting out Burning (an action) | DC 10 Dexterity check | drop Prone, no roll |
| Counterspell | fails a spell of the slot's level or lower; a check for a higher one | the caster's Constitution save |
| Divine Smite | a feature: any slot, up to 5d8 | a spell, with the bonus action |
| Guidance | a d4 on one check | a d4 on every check with the chosen skill |
| Fate | Inspiration | Heroic Inspiration |

## How 5e maps into the core

### Reading a creature

FastFighting reads each item by what it does (its activities and effects), then by its words, never from a list of names, so homebrew and unseen books work too. Features it must recognise, such as Extra Attack or Pack Tactics, it finds by identifier, the same in every book and language. Babele-translated compendiums are read from the English Babele keeps; metric worlds count 1.5 m as a 5-foot square.

- An attack activity is the core's attack. A save on the same item happens on a hit when the item says so: a wolf's bite (Strength or prone).
- Multiattack: an NPC makes every strike it names, read from 2014 and 2024 wording ("one with its bite and two with its claws"). Each choice is an option the simulation picks per turn.
- Extra Attack (and Thirsting Blade) gives several weapon attacks with the Attack action; from two classes, it doesn't add up. Two light weapons, Martial Arts and Flurry of Blows give bonus-action strikes.
- Characters fight with equipped weapons and cast cantrips and prepared spells (and pact, innate and at-will ones). Magic Missile's darts, Scorching Ray's rays and Eldritch Blast's beams count, more for a higher slot or level.
- Summons (Spiritual Weapon, Conjure Animals ...) are the core's summons: the creatures dnd5e would call, with the caster's attack and DC where the spell says, and only what its players could call themselves. A spiritual weapon or a flaming sphere can't be attacked, and acts only on the caster's bonus action.

### The turn

A 5e turn is the core's turn with an action, a bonus action and movement, plus one spell slot, which plays 5e's rule on bonus-action spells: Healing Word and Guiding Bolt can't share a turn, Healing Word and a cantrip can. Dash spends the action on a second move; standing up costs half your movement. Slowed (the Slow spell): an action but no bonus action, and no reaction.

### Rolls

5e's d20 tests are the core's rolls with two results, since 5e has nothing beyond meeting the DC. Attacks crit on a natural 20 (dice doubled) and miss on a 1. A successful save halves the damage, or stops it where the spell says so. Advantage and disadvantage cancel out. They come from the conditions (a restrained target, a poisoned attacker), prone (up close or from afar), hiding, Pack Tactics, and ranged attacks in melee or at long range. Cover adds +2 (half) or +5 (three-quarters) to AC and Dexterity saves; exhaustion is −2 a level to d20 tests.

### Conditions

dnd5e's conditions are the core's: read from the sheet when the fight starts, and written back in a live battle. Most map one to one (Prone, Poisoned). Where the core splits an idea, the 5e condition sets both: Restrained also holds the creature in place, and Paralyzed or Stunned also stop it acting. Grappled is the core's grabbed, Sleeping its asleep, Hiding its hidden. A charm or a Dominate spell is the core's control, so the target fights for its caster; the sheet shows Charmed. FastFighting keeps conditions dnd5e has no status for (off guard, dazed) itself.

5e's Frightened is on or off. A frightened creature can't come closer to what frightens it, so it keeps away, however bold it is.

A creature immune to every condition a spell would lay is immune to the spell, so nobody wastes one on it.

### Holds

5e's grapples, webs and nets are the core's holds. Each try to break free takes an action, and so does freeing a friend.

- Grappled is the core's grabbed hold: escaping rolls the better of Athletics and Acrobatics against the grappler's escape DC ("escape DC 13"; else see the table above). A friend can't break a grapple for you.
- Webs, grasping plants and nets are the core's restraint, broken by the check their words name: a Strength check against the spell's DC, or DC 10 for a net, which a friend beside it can make too.
- FastFighting's bonds are rope (see the table above). A friend unties them with no roll.

### Swallowed and engulfed

A purple worm's swallow is the core's swallowed, and a gelatinous cube's engulfing its engulfed: the one inside moves with its holder, nobody outside can reach it, and it can go only for its holder. 5e adds Blinded and Restrained in a gullet, Restrained in an ooze, and the holder's damage each turn (a worm's 6d6 acid). No action gets it out of a gullet: enough damage from inside in one turn (30 for a worm) calls for the holder's save, and a failure brings them all up, Prone, as does the holder's death. An ooze is escaped with an action and its check (a cube's: DC 12 Strength), or by a friend's pull.

### Harm that lasts

Burning is the core's burning: 1d4 fire at the start of each of its turns, or what the source says (a 2014 fire elemental's 1d10). It comes from dnd5e's Burning status or words that set the target alight (alchemist's fire). Putting it out takes an action (see the table above), or a friend's. Acid Arrow's later acid is the core's corroding, and nothing scrapes it off.

### Riders on a hit

Smites, Stunning Strike and Battle Master maneuvers aren't actions: they're the core's riders, offered when a hit lands, and the creature decides whether that hit is worth the slot, Focus or superiority die. Divine Smite has a bigger version against fiends and undead, and Precision Attack rides on a close miss. Anything with no attack of its own that works "after you hit" counts too.

Free extras ride on the attack itself: Sneak Attack (once a turn, with a finesse or ranged weapon, with advantage or an ally beside the target), Radiant Strikes (a d8 radiant on every melee weapon hit), Hunter's Mark and Hex (moved to a new foe when the first drops), and Push mastery (10 feet, Large or smaller).

### Reactions

5e's reactions are the core's, one a round. Anyone with a melee weapon makes an opportunity attack on a foe leaving its reach; Disengage avoids it (a bonus action for Cunning Action and Nimble Escape). Shield, Uncanny Dodge, Hellish Rebuke, Counterspell, Parry, Riposte, Deflect Attacks, the Protection fighting style and any reaction spell that raises AC play too; a spell uses the cheapest slot that works.

### Resources

Spell slots, pact slots, a feature's uses, consumables, Legendary Resistance and legendary actions are the core's resources, spent in the simulation and on the sheet in a live battle.

- A multiclass character casts each spell with its own class's numbers, from any slot it can use (a pact slot too), cheapest first.
- "Recharge 5–6" comes back on a d6 at the start of the creature's turn.
- Legendary actions come between other creatures' turns, by their cost. Legendary Resistance turns a failed save that matters into a success.
- (Heroic) Inspiration is the core's fate: spent to keep someone from dying.

### Dying

A character at 0 HP makes death saves: DC 10; a 20 brings it back with 1 HP, and a 1 counts twice. Damage while down is a failure (two on a critical), and massive damage kills outright. NPCs die at 0 HP. An ally stabilizes the dying with a DC 10 Medicine check, or heals them.

The core's ways back up take 5e's numbers: Regeneration, read from its words (a troll's, stopped by acid or fire), and the Regenerate spell's hit point a turn; Undead Fortitude (a Constitution save against 5 + the damage, never against radiant or a critical hit); Relentless Endurance (1 HP instead of 0, once a long rest).

### Buffs, debuffs and edges

Spell and feature effects are the core's buffs and debuffs, read from their changes (Bless's d4, Shield of Faith's AC, Rage), their statuses (Hold Person's Paralyzed) and what only their words say (Faerie Fire's advantage, Haste's extra action, a save repeated each turn). Effects on a creature before the fight count too.

- Charm Person and the Dominate spells turn the target to your side until it saves, your concentration breaks, or, for a charm, your side harms it.
- Concentration: one spell at a time. Damage calls for a Constitution save (DC 10 or half the damage); being incapacitated ends it.
- 2024's Contagion is the core's tallied affliction: Poisoned until three saves made end it, or three failed keep it for the fight.

One-roll edges are the core's, each spent by the roll it helps: Help (advantage on a friend's next attack at a foe beside the helper), Insight before talking (DC 15: advantage on its next words), 2014's Guidance, Bardic Inspiration, Guiding Bolt, Vicious Mockery, Steady Aim and 2014's True Strike. A Lore-Collector sizes a foe up with the Study action: its best of Arcana, History, Investigation, Nature and Religion.

### Everyday actions

| Action | In 5e |
| --- | --- |
| Dodge | Anyone. A 5e shield is already in the AC, so the core's shield answer says how readily it Dodges instead. |
| Hide | Stealth against DC 15 (the SRD 5.2's), as an action, a bonus action with Cunning Action. Hidden, it's Invisible until it attacks; never with a foe beside it. |
| Shove, Grapple | Characters and humanoids: the target's Strength or Dexterity save against 8 + Strength + proficiency, at most one size larger. A shove pushes 5 feet or knocks prone. |
| Pushes | Thunderwave, Gust of Wind, Repelling Blast, a bronze dragon's breath ...: the core's forced movement. A fall deals 1d6 per 10 feet. |
| Moving past others | Through an ally's space, or one that's down, Incapacitated, Tiny or two sizes off, as difficult terrain; round anyone else. dnd5e's difficult terrain regions count. |
| Doors | AC 15, 18 HP; locked against DC 15 Athletics or thieves' tools. Opening is free; forcing or picking takes an action. |
| Free hands | Tied up, a creature can still bite, kick, or cast a verbal-only spell. A weapon (two-handed: two), a potion, a net, a grapple and a spell with a somatic or material component each take a hand. |

### Talking and stealing

Persuasion, Intimidation and Deception are the core's persuading, threatening and bluffing, against passive Insight. Sleight of Hand steals against passive Perception, for anyone with the wits (not a beast, nor Intelligence 3 or less). A creature speaks its sheet's languages, custom ones too; one that can't speak has none. A side's leader has the best Persuasion or Intimidation for its level, more with a feature like Leadership. In a standoff, a character can ask for something by dnd5e's item type, material (silvered) or rarity.

### Personality

The core's personality traits come from the sheet; each trait's tooltip in the planner says what moved it. A creature's traits start from its Intelligence, its Wisdom save and its type (beasts and the mindless fight on instinct), then move with its alignment, its kind (a devil's hierarchy, a demon's chaos), its features (Brave, Pack Tactics) and a loyalty score. A player character starts as the usual hero, and its abilities, level, classes, background, alignment, features, skills and exhaustion each move it a little. A summoned creature serves its summoner.

### Playstyles and tactics

Every perk a playstyle or tactics answer switches on does something here. These lean on 5e's own:

| Perk (playstyles) | In 5e |
| --- | --- |
| Hard to spot (Chicken, Fragile, Wallflower) | Hides readily; foes' attention slides off it. |
| Spoiling (Instigator most; Cruel, Wants to Lead, Wallflower, Puzzle-Maniac) | Shove, Grapple, and spells that lay a condition, over a plain blow. |
| Helping (Enabler, People-Pleaser, Moralist, Martyr, Redeem-Seeker, Tank) | Help; healing and buff spells. |
| In a hurry (Impatient, Speed-Runner) | No Disengage, Dodge or Hide; Dash when it has to. |
| Acting first (Instigator) | Its initiative. |
| Lore-Collector | The Study action. |
| Weak spots (Puzzle-Maniac) | Damage vulnerabilities. |
| Thief | Sleight of Hand. |
| Trap avoiders | A token the GM marks as a hazard (5e has no hazard actors). |
| Finishing the fallen (Cruel) | A blow on the downed is a failed death save. |
| Sparing the fallen (Moralist, Peacekeeper, a Diplomat now and then) | Knocks a foe out with the melee blow that would kill it. |
| Locked doors | Athletics or thieves' tools. |

The Shield or defending answer says how readily a creature Dodges. Magic and specialties means spells, features (Second Wind, a breath weapon), Reckless Attack and Action Surge.

### Set up by itself

When FastFighting first sets a character up by itself, 5e suggests playstyles from its class (a Rogue a Thief, a Paladin a Tank and a Martyr), species (an orc's Relentless Endurance), kind of creature (a fiend Cruel), alignment (neutral evil a Mercenary) and armor (a shield or heavy armor: a Tank). Keywords come from its appearance, personality traits, ideals and flaws, and a little from its biography, but not its bonds.

**Let this character decide** answers the tactics questions from 5e's data where it says something, and names what decided each: a Multiattack made only one way is the signature attack; a paladin protects its friends; a pack hunter runs when the pack is losing; a full caster saves its slots, while short-rest resources go freely; a true dragon wants tribute, ten gold for each challenge rating.

## Do it For Real Now

In a live battle, each turn goes onto the dnd5e sheets as it's played: HP, death saves and death; conditions as dnd5e's own (read back each turn, the GM's changes too); slots, Inspiration, Legendary Resistance, uses and consumables spent; and a spell's buff or debuff as the spell's own effect, for its rounds. Fleeing NPCs are hidden (unless the **Do it For Real Now: fled combatants** setting leaves them), the surrendered get an effect, and coins or items change hands. Summons appear the way dnd5e summons them. A player's turn is read from its dnd5e cards (attacks, damage, healing, and talking checks), and the GM confirms what FastFighting isn't sure of. A player's damage card at a creature FastFighting runs goes through dnd5e's own damage application (resistances, immunities, temporary hit points), applied at once or by the GM from the Battle Vantage. A reaction's strike, such as an opportunity attack, is rolled with dnd5e's own attack and damage rolls, a character's on its player's screen.

## Settings

**Lore-Collector advantage** (1.25× to 3×, default 2.5×): how much likelier a Lore-Collector's rolls against a foe are to succeed through its next turn, after a successful Study. Study costs the turn and works a little over half the time, so the default is high. Above about 1.75×, only long-shot rolls gain much.

## Other languages

In a language other than English, the settings recommend the system's translation module when it isn't on (Spanish: translate-dnd5e-sdr2-es). Babele-translated compendiums play as in English. Skills, conditions and coins go by the system's names, in English until the system is translated, to match the sheets. To translate this module, see **Translating** in the [core README](https://github.com/galaara98/FastFighting/blob/main/README.md).

## Not played, or played differently

- 2014's exhaustion table: every level is −2 to d20 tests, under either rules version.
- An incapacitated creature (Command's halt, Confusion) is attacked with advantage.
- A swallowed or engulfed creature takes its holder's damage at the start of its own turns (the SRD: the holder's).
- Lore-Collectors use 2024's Study action under either rules version.
- Hide never checks for cover; that's the GM's call.
- Hiding ends on an attack roll, not on a spell with a save. Blindsight and truesight don't see through it, or through Invisible.
- Pushes chosen instead of something else (Brutal Strike), moves that put a creature anywhere (Telekinesis), and every weapon mastery but Push.
- A Death Burst that deals no damage (a dust mephit's blinding).
- Summons that take longer than a bonus action (Find Familiar) or can't fight (Mage Hand), and more than 8 creatures from one casting.
- An effect's changes beyond attack, damage, saves, AC, speed, temporary hit points, resistances, immunities and a weapon's magic bonus, unless its words say what they do.
- Loot and corpses: this module leaves no loot piles and takes no corpses away, so the core's loot and corpse settings don't show in a D&D 5e world.

## License

MIT

---

Developer notes: [CODING_README.md](CODING_README.md). FastFighting itself: [FastFighting Core](https://github.com/galaara98/FastFighting) and its [developer docs](https://github.com/galaara98/FastFighting/blob/main/CODING_README.md). The numbers behind it all: [STATS_AND_FORMULAS_README](https://github.com/galaara98/FastFighting/blob/main/STATS_AND_FORMULAS_README.md).
