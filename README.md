# FastFighting D&D 5e

> **AI use:** This module used AI in its creation.
> - **Programming:** I am a skilled programmer by profession, but AI was used heavily as a co-pilot.
> - **Strings:** ALL initial strings were created by AI. An AI-made Spanish translation was used to test localization and has since been removed.

Dungeons & Dragons Fifth Edition support for [FastFighting Core](https://github.com/galaara98/FastFighting), the Foundry VTT module that simulates a battle (or a tense standoff) thousands of times, tells the story of one fair draw, and plays it for real on the Combat Tracker, a turn at a time, with **Do it For Real Now**.

- **Foundry:** v14
- **System:** dnd5e 4.0 or later (written against 6.0)
- **Needs:** FastFighting Core (API 16)

## Installation

Install FastFighting Core first, then this module. In Foundry, go to **Add-on Modules → Install Module** and paste:

```
https://github.com/galaara98/FastFighting/releases/latest/download/module.json
https://github.com/galaara98/FastFighting-DnD5e/releases/latest/download/module.json
```

Foundry only offers this module in D&D 5e worlds. Metric worlds work too: speeds, reach and ranges are converted (1.5 m to a 5-foot square).

## What it reads

Everything works from the free SRD alone, the 2014 SRD 5.1 and the 2024 SRD 5.2 (their wordings differ, and both are read). The Player's Handbook, the Dungeon Master's Guide and other books only add more spells and features, read the same way: from what an item does (its activities and effects), then its words, never from a list of names. Features it has to recognise (Extra Attack, Sneak Attack, Rage's companions Reckless Attack and Action Surge, Pack Tactics, Nimble Escape, Multiattack) are found by their identifier, the same in every book and language.

- **Attacks:** weapons and features through their attack activities: to-hit, damage (with your modifiers), melee reach, and ranged normal and long range.
  - A save beside an attack on the same item happens on a hit: a wolf's bite (Strength or prone), a spider's venom (Constitution, half on a success).
  - A grapple from an attack uses the core's grab, which the target can try to escape.
- **Multiattack:** NPCs make every strike their Multiattack lists in one action, read from the stat block's wording in both the 2014 and 2024 styles ("one with its bite and two with its claws", "one Bite attack and one Claw attack", "two melee attacks", "using Scimitar or Pistol in any combination"). Where there's a choice, each way is an option, and the simulation picks one each turn (melee up close, ranged from afar). Checked against all 329 SRD monsters with a Multiattack.
- **Extra Attack:** characters with Extra Attack (or more) make several weapon attacks with the Attack action (from two classes it doesn't add up; a warlock's Thirsting Blade counts).
- **Multiclassing:** each spell's attack bonus and save DC come from its own class; a spell can be cast from any slot it can use, a higher one adding its damage (and darts or rays) for each level up, and, as the multiclassing rules allow, from a warlock's pact slot (or a warlock's spell from the other slots), the cheapest first.
- **Sneak Attack:** for characters, once a turn on a finesse or ranged weapon, with advantage or an ally next to the target.
- **What rides on a hit** (by identifier, or for anything that says it works "after you hit"), each used when this hit is worth what it costs:
  - Divine Smite (2014's feature with any slot up to 5d8, 2024's spell with the bonus action) and the smite spells, at each slot level the character has, the bigger version against fiends and undead;
  - Eldritch Smite (a pact slot), Stunning Strike (a Focus or ki point), Battle Master maneuvers (a superiority die: Trip, Menacing, Pushing, Disarming ... and Precision Attack on a close miss);
  - Improved Divine Smite (Radiant Strikes): a d8 of radiant on every melee weapon hit.
- **Reactions:** Shield (perhaps a miss after all), Uncanny Dodge (half the blow), Hellish Rebuke, Counterspell (2014: by the slot's level or a check; 2024: the caster's Constitution save), a Battle Master's Parry and Riposte, a monk's Deflect Attacks (or Missiles), and any reaction spell whose effect raises AC. Spells spend the cheapest slot that works.
- **Summons:** a summon activity's creatures (Spiritual Weapon, Flaming Sphere, Animate Objects, Conjure Animals, a magic item's elementals ...), read like any creature as dnd5e would summon them (at the casting's level), with the caster's spell attack and save DC where the spell says, and more damage for a higher slot. How many come, and their bonuses, are worked out with the caster's own numbers as dnd5e works them out (@scaling, its spellcasting modifier, class levels, hit points; the creature's own where a bonus counts them), as arithmetic only, never run as code. A spell that names a challenge rating and type gets one from the installed books. A spiritual weapon or a flaming sphere can't be attacked, and acts only when the caster spends its bonus action. Rituals and what can't fight (Find Familiar, Mage Hand) are left out.
- **Regeneration, Undead Fortitude and Relentless Endurance:** a troll's (or a vampire's) Regeneration, read from its words: so many hit points a turn, stopped by the damage it names; the Regenerate spell's hit point at the start of each turn, after its heal, for its hour (and on a creature it was cast on before the fight); a zombie's Undead Fortitude: the Constitution save against 5 + the damage, never against radiant damage or a critical hit; an orc's Relentless Endurance: 1 hit point instead of 0, no save, once a long rest (Do it For Real Now spends it), never when the blow kills it outright.
- **Recharge and legendary creatures:** "Recharge 5–6" abilities come back on a d6; legendary actions (by their cost, including one that only names its attack, "makes a tail attack") are taken between other creatures' turns; Legendary Resistance turns a failed save that matters into a success, and Do it For Real Now spends it.
- **Saves:** Magic Resistance (advantage against spells), Evasion, and a paladin's Aura of Protection (Charisma to its own and nearby friends' saves, 10 feet, 30 from 18th level).
- **Bonus-action strikes:** a light weapon in each hand gives a bonus-action attack with the second (without its ability modifier, unless the character has the Two-Weapon Fighting style); a monk's Martial Arts (an unarmed strike) and Flurry of Blows (two unarmed strikes, three with Heightened Focus, for a point of Focus or ki).
- **Pushes:** spells and features that push, by identifier (Thunderwave, Gust of Wind, Thunderous Smite, Repelling Blast, a bronze dragon's breath ...); a bulette's Deadly Leap, which pushes whoever saves out of its way; and a weapon's Push mastery (10 feet, a creature Large or smaller), for a wielder with mastery of that weapon.
- **Size:** Shove only works on a creature up to one size larger.
- **Terrain:** dnd5e's own difficult terrain regions (Spike Growth's, Plant Growth's, or one the GM draws) are difficult terrain.
- **Spells:**
  - attack, save and damage activities, plus the conditions their effects impose (Hold Person's paralysis, a Web's restraint, and so on);
  - spell slots, pact slots and innate uses, and one slot a turn (Healing Word and Guiding Bolt can't share a turn; Healing Word and a cantrip can);
  - darts, rays and beams: Magic Missile's three darts, Scorching Ray's three rays, Eldritch Blast's extra beams at levels 5, 11 and 17;
  - cones and lines from yourself reach as far as they're long, and areas catch more foes the bigger they are;
  - characters only use cantrips and prepared spells.
- **Healing:** spells and potions, as actions or bonus actions. Cure Wounds is a touch (walk over first); Healing Word reaches 60 feet.
- **Buffs and debuffs** (from their effects' changes, statuses and words):
  - for friends: Bless (+1d4 to attacks and saves), Shield of Faith, Haste (and its extra action), Aid and False Life (extra hit points), Divine Favor, Magic Weapon, Longstrider, Blur, Mirror Image, Greater Invisibility, Protection from Evil and Good, Warding Bond;
  - for foes: Bane (−1d4), Faerie Fire (advantage against it), Slow, Ray of Enfeeblement, Vicious Mockery's disadvantage, Ray of Frost's slowing;
  - Hunter's Mark and Hex: extra damage on your own hits, moved to a new foe when the first one drops, at no new slot;
  - Hold Person, Hideous Laughter, Confusion, Command, Entangle, Fear, Grease, Sleep and the like, with the save they repeat each turn;
  - 2024's Contagion: Poisoned (its Constitution saves at Disadvantage, the caster's choice taken as the save that ends it), the save repeated at the end of each of its turns until three made end it or three failed keep it for the fight;
  - Charm Person and the Dominate spells turn the target to your side (saved with advantage in a fight, as the spells say), until it shakes it off, your concentration breaks, or (for a charm) your side harms it;
  - class features: Rage (its damage and its resistance to weapons), Reckless Attack, Action Surge, Bardic Inspiration, Turn Undead, Intimidating Presence and others with effects;
  - concentration: one spell at a time; damage calls for a Constitution save (DC 10 or half the damage), and being incapacitated ends it;
  - anyone can Dodge; characters and humanoids can Shove a foe prone (Strength or Dexterity save, whichever is better);
  - gaining an edge, good for one roll and aimed where it counts: anyone with a mind can **Help** (advantage on a friend's next attack at a foe within 5 feet of the helper, or its next ability check toward whoever it's set on: its words, a Medicine check); a creature proficient in Insight that can talk may first read the one it means to talk round (**Insight** against DC 15: advantage on its next words to them); **Guidance** (2014: a d4 on one ability check; 2024: on every check with the skill), **Bardic Inspiration** (the bard's own die on one attack, check or save), **Guiding Bolt** (the next attack at the target has advantage), **Vicious Mockery** (disadvantage on its next attack), **Steady Aim** and 2014 **True Strike** (advantage on your next attack) are each spent by the roll they help;
  - a Lore-Collector sizes a foe up with the **Study** action: its best of Arcana, History, Investigation, Nature and Religion; it has to work to pay off, by the **Lore-Collector advantage** setting (1.25× to 3× as likely to succeed, through its next turn; default 2.5×, since it costs the whole turn; ordinary attacks get all they can by about 1.75×, the rest helps long-shot rolls); what it learns holds for every foe of the same sort;
  - already on a creature when the fight starts: what dnd5e's numbers leave out (Bless's d4 on attacks and saves, invisibility, a Faerie Fire outline); flat bonuses such as Shield of Faith's AC are already in them;
  - in a live battle, on the creature as the spell's own effect, for the rounds it has.
- **Senses:** sorted into the core's with their ranges: darkvision and truesight see in the dark; blindsight and tremorsense are felt; blinded and deafened.
- **Fate:** a character's (Heroic) Inspiration is spent to keep someone from dying, and Do it For Real Now takes it away.
- **Defenses:**
  - damage immunities, resistances and vulnerabilities;
  - condition immunities, so a spell isn't wasted on a creature immune to everything it would do.
- **Talking:**
  - Persuasion persuades, Intimidation threatens and Deception bluffs, all against passive Insight;
  - Sleight of Hand steals, against passive Perception (a character, or a creature with the wits to: not a beast, nor one with an animal's Intelligence or none);
  - languages: those on its sheet, and those its custom languages name ("Common plus one other language"); none for one that understands but can't speak;
  - Wisdom saves set how strong-willed a creature is.
- **A creature's personality** comes from what it is: its Intelligence, its Wisdom save for its challenge rating and its creature type (beasts and the mindless fight on instinct; Pack Tactics). Then its alignment moves it (good less selfish, evil more, lawful more loyal, chaotic less), and so do its kind's loyalty (a devil's hierarchy, a demon's chaos, a celestial's devotion), an immunity to being frightened (a fearless one) or charmed, its features (Brave, Martial Advantage, Aggressive, Pack Tactics, a reckless or frenzied one ...), healing others, exhaustion, and a loyalty score where the world keeps one. A creature dnd5e summoned serves its summoner. Nothing moves the mindless.
- **A player character's personality** starts as the usual hero's (bold, loyal, unselfish, a good head), and everything on its sheet moves it a little:
  - Intelligence, Wisdom and experience for Tactical; its Wisdom save against the usual hero's at its level, and its Constitution, for Brave;
  - its classes (by their share of its levels) and subclasses: a paladin selfless and loyal, a berserker bold and rash, a thief or a fiend's warlock out for itself, a wizard or a lore bard a planner;
  - its background: an acolyte selfless, a criminal less so, a sage a planner, a soldier bold and loyal;
  - its alignment, half as much as a creature's;
  - its features by what their effects do (an immunity to being frightened; advantage on Wisdom saves, like Gnomish Cunning; Mindless Rage's immunities count half, being on only while it rages), the rest by identifier (Brave, Aura of Courage, Relentless Endurance, Danger Sense, Indomitable ...). Its species speaks through its traits;
  - its condition immunities, and the features and prepared spells it heals others with;
  - skills that say something (Sleight of Hand, Deception, Medicine, Investigation, History, Insight, Perception, Intimidation, Persuasion), expertise more;
  - exhaustion, and whether it's in the party (dnd5e's primary party).

  Each trait's tooltip in the planner lists where it started and every part that moved it.
- **Already under way:** current HP, death saves, conditions (prone, frightened, poisoned, restrained, grappled, paralyzed, stunned, unconscious and others) and exhaustion.

## The 5e rules it plays

- **The turn:** an action, a bonus action and your movement. Dash spends the action on a second move, and standing up costs half your movement.
- **Rolls:**
  - attacks crit on a 20 (dice doubled, not modifiers) and miss on a 1;
  - saves and checks simply meet the DC or don't;
  - half damage on a successful save, or none when the spell says so.
- **Doors:** a wooden door is AC 15 with 18 hit points, locked against a DC 15 Strength (Athletics) check or thieves' tools (proficiency, and the tools themselves for a character); opening one is a free object interaction, forcing or picking it takes an action.
- **Moving past others:** through an ally's space, one that's down or Incapacitated, a Tiny creature's or one two sizes off, as Difficult Terrain; round any other foe. A halfling's Nimbleness takes it through any creature larger than it.
- **Opportunity attacks:** anyone with a melee weapon swings once (its reaction) at a foe leaving its reach. Disengage gets you out safely; rogues (Cunning Action) and goblins (Nimble Escape) do it as a bonus action.
- **Breaking free** (each try an action, and so is freeing a friend):
  - a grapple: an Athletics or Acrobatics check, whichever is better, against the grappler's escape DC: the one its attack gives ("escape DC 13"), else 8 + its Strength modifier + proficiency (2024), or 10 + its Athletics (2014's contest, as a passive check). Grappled on the sheet with no grabber known: the hardest grab among the foes within reach, else a typical DC for its level;
  - webs, grasping plants and a net say what breaks them: a Strength check (2024: Strength (Athletics)) against the spell's save DC, or DC 10 for a net, which a friend beside it can make too;
  - FastFighting's bonds are taken as rope: 2024, DC 15 Acrobatics to slip them or DC 20 Athletics to burst them; 2014, a DC 17 Strength check to burst them. A friend unties them with no roll.
- **Free hands:** tied up, a creature can still use what needs none: a bite, an unarmed strike (a kick will do), a spell with only a verbal component. A weapon takes one hand (two-handed, two), and so do claws, a fist, a spell with a somatic or material component, a potion or a net, and a grapple.
- **Advantage and disadvantage:** helpless, prone or restrained targets; poisoned, frightened or blinded attackers; Pack Tactics; ranged attacks at long range or in melee. They cancel out.
- **Exhaustion:** −2 per level to d20 tests.
- **Dying:**
  - death saves at DC 10; a 20 brings you back with 1 HP and a 1 counts as two failures;
  - damage while down is a failure, two on a critical;
  - massive damage kills outright;
  - allies stabilize the dying with a DC 10 Medicine check (an action, in the fight as after it) or heal them.

## Playstyles in 5e

Every perk a playstyle (or a tactics answer) can switch on does something here. Most play as they do in any system (who a character goes for, when it loses heart, whom it listens to, how it talks). These lean on 5e's own:

| Perk (playstyles) | In 5e |
| --- | --- |
| Hard to spot (Chicken, Fragile, Wallflower) | Foes' attention slides off it, and it would rather **Hide**: Dexterity (Stealth) against DC 15 (the SRD 5.2's), as an action (a rogue's Cunning Action: a bonus action). Hidden, it's Invisible: its attacks at advantage, those against it at disadvantage, until it attacks. Not with a foe beside it; whether there's cover enough is the GM's call, so the simulation only asks that. |
| Spoiling (Instigator most; Cruel, Wants to Lead, Wallflower, Puzzle-Maniac) | **Shove** (prone) or **Grapple** (the SRD 5.2's Unarmed Strike: a Strength or Dexterity save against 8 + Strength + proficiency, or Grappled until it breaks free), and spells and features that lay a condition, over a plain blow. |
| Helping (Enabler, People-Pleaser, Moralist, Martyr, Redeem-Seeker, Tank) | **Help**; healing and buff spells. |
| In a hurry (Impatient, Speed-Runner) | It doesn't Disengage (it takes the opportunity attacks), Dodge or Hide; it Dashes when it has to. |
| Acting first (Instigator) | Its initiative. |
| Lore-Collector | The **Study** action. |
| Weak spots (Puzzle-Maniac) | Damage vulnerabilities. |
| Thief | Sleight of Hand, against passive Perception. |
| Trap avoiders | A token the GM marks as a hazard (5e has no hazard actors of its own). |
| Finishing the fallen (Cruel) | Death saves: a blow on one who's down is a failed save (two on a critical). |
| Sparing the fallen (Moralist, Peacekeeper, a Diplomat now and then) | Knocks a foe out with a melee blow that would kill it (the rules allow any melee attack to), and leaves the fallen be. |
| Mending, healing, rescue | Healing spells and potions; a friend dying is stabilized with a DC 10 Medicine check, in the fight as after it. |
| Locked doors | Strength (Athletics) or thieves' tools. |

Tactics answers:

- **Shields** (keep it raised, raise it with spare actions, don't bother): a 5e shield is already in the AC, so this says how readily it **Dodges** instead: half again as readily; as it would anyway; never.
- **Magic and specialties** (an Un-Mundane character leans on them): spells, and the activities of its features (a class's, a species', a creature's own: Second Wind, a breath weapon), Reckless Attack, Action Surge. Its weapons, Dodge, Help, Hide, Shove and potions are what anyone could do.

## Set up by itself

When FastFighting sets a character up by itself (the first time it sees it: see the core's README), 5e has its say:
- **Classes, by identifier** (several add up):
  - a Barbarian a Brawler, impatient; a Bard a People-Pleaser and a Diplomat; a Cleric an Enabler; a Druid Un-Mundane and a Lore-Collector; a Fighter a Brawler or a Tank; a Monk a Speed-Runner;
  - a Paladin a Tank and a Martyr; a Ranger a Wallflower; a Rogue a Thief; a Sorcerer or Warlock Un-Mundane; a Wizard Un-Mundane and a Lore-Collector; an Artificer a Puzzle-Maniac.
- **Species, by identifier,** only where an SRD trait leans somewhere (an orc's Relentless Endurance, a gnome's cunning).
- **Kind of creature:** a beast a Brawler; undead, constructs, oozes and plants Relentless (constructs and oozes never run); a fiend Cruel; a celestial a Moralist; fey a Wildcard; a giant a Brawler.
- **Alignment** (read by the system's own names for them, in any language): good leans Moralist, chaotic neutral Wildcard, neutral evil Mercenary, evil Cruel.
- **Gear:** a shield or heavy armor worn makes a Tank likelier.
- **Keywords:** what's said of a character (its appearance, personality traits, ideals and flaws) counts in full, and its biography, a story with others in it, a little; its bonds are about others, and left out. A creature's biography is its lore, said of it. A lore page a biography embeds is read only where the character's players could read it themselves.

### Let this character decide

What "Let this character decide" stands for comes from 5e's own data wherever it says something, each answer shown to the GM with the system's name for what decided it (a class, feature, spell, skill, alignment or kind of creature). Classes, subclasses and features are known by identifier (and by what they do: healing that reaches others, healing only itself, a condition immunity, what recharges). Where the sheet says nothing, the core's reading of the character stands; for a player character only what its build clearly implies.
- **Signature attack:** a creature's Multiattack (when it makes it one way); a warlock's Eldritch Blast with Agonizing Blast; the one weapon its fighting style is made for (Archery a bow or crossbow, Great Weapon Fighting a two-handed weapon, Dueling a one-handed one).
- **Style:** its main class (the one with the most levels): Paladins protect, Barbarians and Fighters hold the front line, Monks and Rogues skirmish, Rangers shoot, spellcasters cast. Its fighting style before that (Protection guards, Archery shoots, a ranger with a melee style closes in), a pact blade, a cleric's or druid's armored order, Nimble Escape (a skirmisher), a creature's Spellcasting where its spells are its best attacks, a shield guardian's guarding.
- **Target:** a paladin and Protection guard their friends; the mindless and a berserk golem go for the nearest; Rampage, Blood Frenzy and Colossus Slayer for the hurt.
- **Resources:** what recharges, and a legendary creature's, is for this fight (spent freely); so are a short rest's: Pact Magic, Action Surge, ki or focus. A full caster's spell slots last the day (conserved).
- **Magic and specialties:** by its main class's spellcasting (full or pact: strong; half, third or an artificer's: some); a creature's Spellcasting where its spells are its best attacks.
- **Consumables:** an artificer, a thief's Fast Hands or Use Magic Device, and a creature with a flask or bomb to throw use them freely; a merchant sparingly.
- **Talking:** never for the mindless, one with no language (or that understands but can't speak) or one serving a master; a devil and a bard talk first; Persuasion, Deception and Intimidation make it likelier (expertise counts double).
- **Healing others:** a Life Domain cleric at all costs; a cleric, Lay on Hands and a celestial readily; an evil creature sparingly; any other healer as it comes.
- **Potions:** Regeneration needs none; Relentless Endurance, Relentless Rage or Undead Fortitude wait; a d6 Hit Die drinks at half its hit points, a d12 at a quarter.
- **A friend down:** a paladin, a cleric, a healer, Spare the Dying, the Healer feat, a good creature or a celestial, and a hero with Medicine go to them; the mindless, constructs and evil creatures fight on; Redirect Attack looks after itself.
- **Back up from 0 HP:** Regeneration, Undead Fortitude, Relentless Endurance, Relentless Rage and Rejuvenation rejoin at once (so do the mindless and constructs); Second Wind or its own healing heal itself first; a beast runs.
- **Running:** never for one serving a master, the mindless, constructs, oozes, Dark Devotion, Berserk, a reckless berserker or Bloodied Fury; Pack Tactics when the pack is losing; Nimble Escape when hurt; one immune to being frightened only when losing; a beast when hurt.
- **Dodge** (the shield answer: a 5e shield is in its AC): anyone can Dodge, but not the mindless, one with an animal's Intelligence (3 or less) or the reckless; a monk's Patient Defense makes it a bonus action (always).
- **Others nearby:** one serving a master, the mindless, constructs and beasts stay; Pack Tactics, Aggressive, Rampage and Blood Frenzy hunt; Leadership and Aura of Authority call for help.
- **Offer and expect:** nothing without a mind, words or a will of its own. A devil offers to spare those who pay; a true dragon wants tribute; a creature with thieves' cant wants a toll; a merchant or noble offers a tenth of its money; a good creature offers and expects no harm; a neutral evil one (a humanoid, fey or giant) wants paying; a chaotic evil one offers nothing. A demand is ten gold for each level or challenge rating.

## Do it For Real Now

In a live battle, each turn's changes go onto the tokens as the turn is played:
- HP and temporary HP;
- death saves;
- unconscious, prone and other conditions, as dnd5e's own (Grappled for the core's grabbed, Sleeping for asleep, Hiding for hidden; exhaustion as its level), put on and taken off, and read back from the sheet each turn (the GM's too, from the Battle Vantage); those dnd5e has no condition for (off guard, dazed) FastFighting keeps itself;
- death (and defeated in the Combat Tracker);
- spell and pact slots spent, potions drunk and limited uses spent;
- a spell's effects (Bless, Bane, Hold Person): the spell's own effect, on for the rounds it has, and off when it ends.

It also:
- hides fleeing NPCs (PCs who retreat stay on the map);
- marks the surrendered;
- switches the disposition of creatures who change sides (won over: their new side; talked out of the fight: Neutral; a neutral that turned on the party: Hostile);
- hands coins or items over when someone is talked into giving them up, strikes a deal, or has them stolen.

For bargaining in a standoff, a character can ask for something of a kind: dnd5e's item types, the materials its item properties name (adamantine, silvered) and its rarities, in its own words.

Rewind Turn takes one turn back; Rewind This Encounter, all of it.

D&D 5e has no loot actors, so the "loot pile" setting leaves gear on the corpse.

## Development

```
npm install
npm test
```

The tests import FastFighting Core from a checkout beside this one (`../FastFighting`); set `FASTFIGHTING_CORE` to point elsewhere.

Every word this module shows is in `languages/en.json`: the code holds keys, never the English. Translating it takes only a copy of that file (see **Translating** in the core README). `npm run test:reworded` runs the tests again with every word in the language files reworded, so they never depend on the wording.

`hardcoded-toEN.json` lists words that stay in English for now, whatever the reader's language: keys of `languages/en.json` (or a group, `"FFDND5E.Skill"`) whose translation would contradict a game system that isn't translated yet. It has the date it was last updated (`lastUpdated`) and the list (`keys`). It's plain JSON, edited like the language files.

## License

MIT
