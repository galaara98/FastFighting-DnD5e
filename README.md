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

Foundry only offers this module in D&D 5e worlds.

## What it reads

- **Attacks:** weapons and features through their attack activities: to-hit, damage (with your modifiers), melee reach, and ranged normal and long range.
- **Multiattack:** NPCs make every strike their Multiattack lists in one action.
- **Extra Attack:** characters with Extra Attack (or more) make several weapon attacks with the Attack action.
- **Sneak Attack:** for characters, once a turn on a finesse or ranged weapon, with advantage or an ally next to the target.
- **Spells:**
  - attack, save and damage activities, plus the conditions their effects impose (Hold Person's paralysis, a Web's restraint, and so on);
  - spell slots, pact slots and innate uses;
  - characters only use cantrips and prepared spells.
- **Healing:** spells and potions, as actions or bonus actions.
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
- **Advantage and disadvantage:** helpless, prone or restrained targets; poisoned, frightened or blinded attackers; Pack Tactics; ranged attacks at long range or in melee. They cancel out.
- **Exhaustion:** −2 per level to d20 tests.
- **Dying:**
  - death saves at DC 10; a 20 brings you back with 1 HP and a 1 counts as two failures;
  - damage while down is a failure, two on a critical;
  - massive damage kills outright;
  - after the fight, allies stabilize the dying with a DC 10 Medicine check or heal them.
- **Encounter difficulty:** checked against the 2014 thresholds (easy, medium, hard, deadly).

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
