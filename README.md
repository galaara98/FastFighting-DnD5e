# FastFighting D&D 5e

Dungeons & Dragons Fifth Edition support for [FastFighting Core](https://github.com/galaara98/FastFighting), the Foundry VTT module that simulates a battle (or a tense standoff) thousands of times, tells the story of one fair draw, and commits it to the tokens with **Make it So**.

- **Foundry:** v14
- **System:** dnd5e 4.0 or later (written against 6.0)
- **Needs:** FastFighting Core

## Installation

Install FastFighting Core first, then this module. In Foundry, go to **Add-on Modules → Install Module** and paste:

```
https://github.com/galaara98/FastFighting/releases/latest/download/module.json
https://github.com/galaara98/FastFighting-DnD5e/releases/latest/download/module.json
```

Foundry only offers this module in D&D 5e worlds. Metric worlds work too: speeds, reach and ranges are converted (1.5 m to a 5-foot square).

## What it reads

- **Attacks:** weapons and features through their attack activities: to-hit, damage (with your modifiers), melee reach, and ranged normal and long range.
  - A save beside an attack on the same item happens on a hit: a wolf's bite (Strength or prone), a spider's venom (Constitution, half on a success).
  - A grapple from an attack uses the core's grab, which the target can try to escape.
- **Multiattack:** NPCs make every strike their Multiattack lists in one action, read from the stat block's wording in both the 2014 and 2024 styles ("one with its bite and two with its claws", "one Bite attack and one Claw attack", "two melee attacks", "using Scimitar or Pistol in any combination"). Where there's a choice, each way is an option, and the simulation picks one each turn (melee up close, ranged from afar). Checked against all 329 SRD monsters with a Multiattack.
- **Extra Attack:** characters with Extra Attack (or more) make several weapon attacks with the Attack action.
- **Sneak Attack:** for characters, once a turn on a finesse or ranged weapon, with advantage or an ally next to the target.
- **Spells:**
  - attack, save and damage activities, plus the conditions their effects impose (Hold Person's paralysis, a Web's restraint, and so on);
  - spell slots, pact slots and innate uses, and one slot a turn (Healing Word and Guiding Bolt can't share a turn; Healing Word and a cantrip can);
  - darts, rays and beams: Magic Missile's three darts, Scorching Ray's three rays, Eldritch Blast's extra beams at levels 5, 11 and 17;
  - cones and lines from yourself reach as far as they're long, and areas catch more foes the bigger they are;
  - characters only use cantrips and prepared spells.
- **Healing:** spells and potions, as actions or bonus actions. Cure Wounds is a touch (walk over first); Healing Word reaches 60 feet.
- **Defenses:**
  - damage immunities, resistances and vulnerabilities;
  - condition immunities, so a spell isn't wasted on a creature immune to everything it would do.
- **Talking:**
  - Persuasion persuades, Intimidation threatens and Deception bluffs, all against passive Insight;
  - Sleight of Hand steals, against passive Perception;
  - languages;
  - Wisdom saves set how strong-willed a creature is.
- **Personality defaults:** Intelligence, Wisdom and creature type; beasts and the mindless fight on instinct; Pack Tactics.
- **Already under way:** current HP, death saves, conditions (prone, frightened, poisoned, restrained, grappled, paralyzed, stunned, unconscious and others) and exhaustion.

## The 5e rules it plays

- **The turn:** an action, a bonus action and your movement. Dash spends the action on a second move, and standing up costs half your movement.
- **Rolls:**
  - attacks crit on a 20 (dice doubled, not modifiers) and miss on a 1;
  - saves and checks simply meet the DC or don't;
  - half damage on a successful save, or none when the spell says so.
- **Opportunity attacks:** anyone with a melee weapon swings once (its reaction) at a foe leaving its reach. Disengage gets you out safely; rogues (Cunning Action) and goblins (Nimble Escape) do it as a bonus action.
- **Advantage and disadvantage:** helpless, prone or restrained targets; poisoned, frightened or blinded attackers; Pack Tactics; ranged attacks at long range or in melee. They cancel out.
- **Exhaustion:** −2 per level to d20 tests.
- **Dying:**
  - death saves at DC 10; a 20 brings you back with 1 HP and a 1 counts as two failures;
  - damage while down is a failure, two on a critical;
  - massive damage kills outright;
  - after the fight, allies stabilize the dying with a DC 10 Medicine check or heal them.
- **Encounter difficulty:** checked against the encounter XP budget the dnd5e system ships (low, moderate, high), against the foes' XP.

## Make it So

Make it So writes the outcome back to each token:
- HP and temporary HP;
- death saves;
- unconscious, prone and lingering conditions;
- death (and defeated in the Combat Tracker);
- spell and pact slots spent, potions drunk and limited uses spent.

It also:
- hides fleeing NPCs (PCs who retreat stay on the map);
- marks the surrendered;
- switches the disposition of creatures who change sides;
- hands coins or items over when someone is talked into giving them up or has them stolen.

Undo reverses all of it.

D&D 5e has no loot actors, so the "loot pile" setting leaves gear on the corpse.

## Development

```
npm install
npm test
```

The tests import FastFighting Core from a checkout beside this one (`../FastFighting`); set `FASTFIGHTING_CORE` to point elsewhere.

## License

MIT
