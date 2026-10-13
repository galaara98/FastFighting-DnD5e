/**
 * "Let this character decide", as D&D 5e reads it (auto.js dnd5eTactics): each answer from the system's own data, with
 * the system's name for what decided it, and nothing where the data says nothing. Characters and creatures as the test
 * world and the SRD (2014 and 2024) have them, by their identifiers.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { dnd5eTactics, spokenLanguages, speaksAtAll } from "../scripts/auto.js";
import { Dnd5eAdapter } from "../scripts/adapter.js";
import { listJoin } from "../scripts/core.js";
import { text } from "./foundry-i18n.js";
import { TACTIC_CHOICES } from "../../fast-fighting/scripts/engine/tactics.js";
import { validMotive, withHints } from "../../fast-fighting/scripts/foundry/auto-config.js";

/** The system's names for things, as CONFIG.DND5E has them in English. */
const DND5E = {
  alignments: { lg: "Lawful Good", ng: "Neutral Good", cg: "Chaotic Good", ln: "Lawful Neutral", tn: "True Neutral", cn: "Chaotic Neutral", le: "Lawful Evil", ne: "Neutral Evil", ce: "Chaotic Evil" },
  creatureTypes: Object.fromEntries(["beast", "celestial", "construct", "dragon", "fiend", "giant", "humanoid", "undead"].map(k => [k, { label: k[0].toUpperCase() + k.slice(1) }])),
  abilities: { int: { label: "Intelligence" } },
  skills: { per: { label: "Persuasion" }, dec: { label: "Deception" }, itm: { label: "Intimidation" }, med: { label: "Medicine" } },
  conditionTypes: { frightened: { label: "Frightened" } },
  languages: {
    standard: { selectable: false, children: { common: "Common", draconic: "Draconic", goblin: "Goblin", sign: "Common Sign Language" } },
    exotic: { selectable: false, children: { cant: "Thieves' Cant", infernal: "Infernal", primordial: { label: "Primordial", children: { aquan: "Aquan" } } } }
  }
};
beforeAll(() => { globalThis.CONFIG = { DND5E }; });
afterAll(() => { delete globalThis.CONFIG; });

const COINS = [1000, 100, 10, 1];
const feat = (id, name) => ({ id, name, en: name.toLowerCase() });
const cls = (id, name, levels, { hd = "d8", progression = "none", subclass = null } = {}) => ({ id, name, levels, hd, progression, subclass });
const pc = extra => ({ pc: true, level: 1, creature: "humanoid", speaks: true, coins: COINS, skills: {}, features: [], ...extra });
const npc = extra => ({ pc: false, level: 1, int: 10, speaks: true, coins: COINS, skills: {}, features: [], ...extra });
/** The answers, as {key: value} and {key: why}. */
const values = out => Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.value]));
const whys = out => Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.why]));
const money = (amount, coin = 100) => ({ kind: "money", amount, coin });
const NOTHING = { kind: "" };

// The test world's heroes (the SRD 5.2 premade heroes at 1st level) and creatures.
const AKRA = pc({
  classes: [cls("cleric", "Cleric", 1, { progression: "full", subclass: { id: "life-domain", name: "Life Domain", progression: "none" } })],
  alignment: "lg", skills: { med: 1 }, background: { id: "priest", name: "Priest" }, money: 1500,
  features: [feat("spellcasting", "Spellcasting"), feat("disciple-of-life", "Disciple of Life"), feat("breath-weapon-white", "Breath Weapon - White")],
  heals: ["Healing Word", "Cure Wounds"], spells: [{ id: "healing-word", name: "Healing Word" }, { id: "sacred-flame", name: "Sacred Flame" }]
});
const RANDAL = pc({
  classes: [cls("fighter", "Fighter", 1, { hd: "d10" })], alignment: "ng", skills: { per: 1, itm: 1 }, background: { id: "watchman", name: "Watchman" }, money: 1000,
  features: [feat("second-wind", "Second Wind"), feat("defense", "Defense"), feat("fighting-style", "Fighting Style")], selfHeals: ["Second Wind"]
});
const RISWYNN = pc({
  classes: [cls("rogue", "Rogue", 1)], alignment: "tn", skills: { per: 1, dec: 1 }, languages: ["common", "dwarvish", "cant"], money: 500,
  features: [feat("sneak-attack", "Sneak Attack"), feat("expertise", "Expertise"), feat("thieves-cant", "Thieves' Cant")]
});
const ZANNA = pc({
  classes: [cls("wizard", "Wizard", 1, { hd: "d6", progression: "full" })], alignment: "cg", skills: { med: 1 },
  features: [feat("spellcasting", "Spellcasting"), feat("arcane-recovery", "Arcane Recovery"), feat("gnome-cunning", "Gnome Cunning")]
});
const GOBLIN = npc({ level: 0.25, creature: "humanoid", subtype: "Goblinoid", alignment: "ne", languages: ["common", "goblin"], features: [feat("nimble-escape", "Nimble Escape")] });
const GOBLIN_BOSS = npc({ level: 1, creature: "fey", subtype: "Goblinoid", alignment: "cn", features: [feat("nimble-escape", "Nimble Escape"), feat("redirect-attack", "Redirect Attack")] });
const WOLF = npc({ level: 0.25, creature: "beast", int: 3, speaks: false, features: [feat("pack-tactics", "Pack Tactics"), feat("keen-hearing-and-smell", "Keen Hearing and Smell")] });
const BEAR = npc({ creature: "beast", int: 2, speaks: false, features: [feat("keen-smell", "Keen Smell")] });
const ZOMBIE = npc({ level: 0.25, creature: "undead", int: 3, mindless: true, speaks: false, alignment: "ne", features: [feat("undead-fortitude", "Undead Fortitude")] });
const GUARDIAN = npc({ level: 7, creature: "construct", int: 7, speaks: false, ci: ["charmed", "frightened"], features: [feat("bound", "Bound"), feat("protection", "Protection"), feat("regeneration", "Regeneration")] });
const DEVIL = npc({ level: 3, creature: "fiend", subtype: "Devil", alignment: "le", int: 9, languages: ["infernal"], ci: ["frightened", "poisoned"], features: [feat("magic-resistance", "Magic Resistance")] });
const DRAGON = npc({ level: 8, creature: "dragon", subtype: "Chromatic", alignment: "le", int: 16, skills: { dec: 1 }, recharge: ["Poison Breath"], features: [feat("poison-breath", "Poison Breath"), feat("amphibious", "Amphibious")] });
const KOBOLD = npc({ level: 0.125, creature: "dragon", int: 8, features: [feat("pack-tactics", "Pack Tactics")] });
const BANDIT_CAPTAIN = npc({ level: 2, creature: "humanoid", alignment: "tn", int: 14, skills: { dec: 1 }, languages: ["common", "cant"], features: [feat("parry", "Parry"), feat("multiattack", "Multiattack")] });
const PRIEST = npc({ level: 2, creature: "humanoid", subtype: "Cleric", heals: ["Healing Word"], features: [feat("spellcasting", "Spellcasting"), feat("divine-aid", "Divine Aid")] });
const DEVA = npc({ level: 10, creature: "celestial", alignment: "lg", int: 17, heals: ["Cure Wounds"], features: [feat("exalted-restoration", "Exalted Restoration")] });
const TROLL = npc({ level: 5, creature: "giant", alignment: "ce", int: 7, potions: 2, features: [feat("regeneration", "Regeneration"), feat("charge", "Charge")] });
const MAGE = npc({ level: 6, creature: "humanoid", int: 17, features: [feat("spellcasting", "Spellcasting"), feat("protective-magic", "Protective Magic")] });
const LICH = npc({ level: 21, creature: "undead", alignment: "ne", int: 20, legendary: true, ci: ["frightened"], features: [feat("rejuvenation", "Rejuvenation"), feat("legendary-resistance", "Legendary Resistance")] });
const GNOLL = npc({ level: 0.5, creature: "fiend", alignment: "ce", int: 6, features: [feat("rampage", "Rampage")] });
const KNIGHT = npc({ level: 3, creature: "humanoid", alignment: "lg", features: [feat("brave", "Brave"), feat("parry", "Parry"), feat("leadership", "Leadership")] });
const CULTIST = npc({ level: 0.125, creature: "humanoid", skills: { dec: 1 }, features: [feat("dark-devotion", "Dark Devotion")] });
const GUARD = npc({ level: 0.125, creature: "humanoid" });

/** An attack it makes with its action, as the adapter reads it from its CombatantSpec. */
const atk = (id, name, extra = {}) => ({ id, name, item: id, multiattack: false, weapon: "", twoHanded: false, consumable: false, ...extra });
const OGRE = npc({ level: 2, creature: "giant", int: 5, attacks: [atk("ogre.multiattack", "Multiattack", { multiattack: true, item: "" }), atk("greatclub", "Greatclub", { weapon: "melee", twoHanded: true })] });
const WARLOCK = pc({
  classes: [cls("warlock", "Warlock", 2, { progression: "pact" })], features: [feat("pact-magic", "Pact Magic"), feat("agonizing-blast", "Agonizing Blast")],
  attacks: [atk("eldritch-blast", "Eldritch Blast"), atk("dagger", "Dagger", { weapon: "melee" })]
});
const ARCHER = pc({
  classes: [cls("ranger", "Ranger", 2, { hd: "d10", progression: "half" })], features: [feat("archery", "Archery")],
  attacks: [atk("longbow", "Longbow", { weapon: "ranged" }), atk("shortsword", "Shortsword", { weapon: "melee" }), atk("dagger-thrown", "Dagger", { item: "dagger" })]
});
const SAPPER = npc({ level: 1, creature: "humanoid", attacks: [atk("alchemists-fire", "Alchemist's Fire", { consumable: true }), atk("club", "Club", { weapon: "melee" })] });

const EVERYONE = [AKRA, RANDAL, RISWYNN, ZANNA, GOBLIN, GOBLIN_BOSS, WOLF, BEAR, ZOMBIE, GUARDIAN, DEVIL, DRAGON, KOBOLD, BANDIT_CAPTAIN, PRIEST, DEVA, TROLL, MAGE, LICH, GNOLL, KNIGHT, CULTIST, GUARD, OGRE, WARLOCK, ARCHER, SAPPER];

describe("the test world's heroes", () => {
  test("Akra, a Life Domain cleric: a caster who rations her slots and heals at all costs", () => {
    const out = dnd5eTactics(AKRA);
    expect(values(out)).toEqual({
      style: "caster", resourceUse: "conserve", specialty: "strong", healAggro: "allCosts", allyDying: "rescue", selfRevived: "healSelf", shield: "spare"
    });
    expect(whys(out)).toMatchObject({ style: "Cleric", healAggro: "Life Domain", allyDying: "Cleric", selfRevived: listJoin(["Healing Word", "Cure Wounds"]), shield: text("FFDND5E.Dodge") });
  });

  test("Randal, a fighter: the front line, a word when it might work, his Second Wind when he's back up", () => {
    const out = dnd5eTactics(RANDAL);
    expect(values(out)).toEqual({ style: "frontline", talk: "opportune", selfRevived: "healSelf", shield: "spare" });
    expect(out.talk.why).toBe(listJoin(["Persuasion", "Intimidation"]));
    expect(out.selfRevived.why).toBe("Second Wind");
  });

  test("Riswynn, a rogue, and Zanna, a wizard (her Medicine takes her to a friend who falls)", () => {
    expect(values(dnd5eTactics(RISWYNN))).toEqual({ style: "skirmisher", talk: "opportune", shield: "spare" });
    const zanna = dnd5eTactics(ZANNA);
    expect(values(zanna)).toEqual({ style: "caster", resourceUse: "conserve", specialty: "strong", allyDying: "rescue", shield: "spare" });
    expect(zanna.allyDying.why).toBe("Medicine");
  });

  test("a hero's thieves' cant asks no toll: that's for creatures", () => {
    expect(dnd5eTactics(RISWYNN).expect).toBeUndefined();
    expect(dnd5eTactics(BANDIT_CAPTAIN).expect).toEqual({ value: money(20), why: "Thieves' Cant" });
  });
});

describe("classes, subclasses and features", () => {
  test("a paladin guards its friends, heals with Lay on Hands, and gets back up", () => {
    const out = dnd5eTactics(pc({
      level: 5, classes: [cls("paladin", "Paladin", 5, { hd: "d10", progression: "half" })], skills: { itm: 1 }, potions: 1, heals: ["Lay on Hands"],
      features: [feat("lay-on-hands", "Lay on Hands"), feat("relentless-endurance", "Relentless Endurance")]
    }));
    expect(values(out)).toMatchObject({
      style: "protector", target: "protect", specialty: "some", healAggro: "aggressive", allyDying: "rescue", selfRevived: "rejoin", potionThreshold: "25", talk: "opportune"
    });
    expect(whys(out)).toMatchObject({ target: "Paladin", healAggro: "Lay on Hands", selfRevived: "Relentless Endurance", potionThreshold: "Relentless Endurance" });
    expect(out.resourceUse).toBeUndefined();
  });

  test("a barbarian never stops to Dodge; a monk does it as a bonus action, and spends its focus", () => {
    const barbarian = dnd5eTactics(pc({ classes: [cls("barbarian", "Barbarian", 3, { hd: "d12" })], potions: 2, features: [feat("rage", "Rage"), feat("reckless-attack", "Reckless Attack")] }));
    expect(values(barbarian)).toMatchObject({ style: "frontline", shield: "never", potionThreshold: "25" });
    expect(barbarian.shield.why).toBe("Reckless Attack");
    expect(barbarian.potionThreshold.why).toBe(text("FFDND5E.Reason.HitDie", { name: "Barbarian", die: "d12" }));
    const monk = dnd5eTactics(pc({ classes: [cls("monk", "Monk", 2)], features: [feat("monks-focus", "Monk's Focus"), feat("martial-arts", "Martial Arts")] }));
    expect(monk.shield).toEqual({ value: "always", why: "Monk's Focus" });
    expect(monk.resourceUse).toEqual({ value: "nova", why: "Monk's Focus" });
    // (2014's Patient Defense, by its own identifier.)
    expect(dnd5eTactics(pc({ classes: [cls("monk", "Monk", 2)], features: [feat("patient-defense", "Patient Defense")] })).shield.value).toBe("always");
  });

  test("a warlock spends its pact slots every fight; a pact blade fights up close", () => {
    const out = dnd5eTactics(pc({ classes: [cls("warlock", "Warlock", 3, { progression: "pact" })], features: [feat("pact-magic", "Pact Magic"), feat("pact-of-the-blade", "Pact of the Blade")] }));
    expect(out.resourceUse).toEqual({ value: "nova", why: "Pact Magic" });
    expect(out.specialty).toEqual({ value: "strong", why: "Warlock" });
    expect(out.style).toEqual({ value: "frontline", why: "Pact of the Blade" });
  });

  test("its main class is the one with the most levels (a fighter with a little wizard, an Eldritch Knight)", () => {
    const out = dnd5eTactics(pc({
      level: 7, classes: [cls("wizard", "Wizard", 2, { hd: "d6", progression: "full" }), cls("fighter", "Fighter", 5, { hd: "d10", subclass: { id: "eldritch-knight", name: "Eldritch Knight", progression: "third" } })],
      features: [feat("action-surge", "Action Surge"), feat("second-wind", "Second Wind")]
    }));
    expect(values(out)).toMatchObject({ style: "frontline", resourceUse: "nova", specialty: "some" });
    expect(whys(out)).toMatchObject({ style: "Fighter", resourceUse: "Action Surge", specialty: "Eldritch Knight" });
  });

  test("a fighting style says how it fights: Archery shoots, Dueling closes in, Protection guards", () => {
    const ranger = style => dnd5eTactics(pc({ classes: [cls("ranger", "Ranger", 2, { hd: "d10", progression: "half" })], features: [style] })).style;
    expect(ranger(feat("archery", "Archery"))).toEqual({ value: "ranged", why: "Archery" });
    expect(ranger(feat("dueling", "Dueling"))).toEqual({ value: "frontline", why: "Dueling" });
    const guard = dnd5eTactics(pc({ classes: [cls("fighter", "Fighter", 1, { hd: "d10" })], features: [feat("protection", "Protection")] }));
    expect(values(guard)).toMatchObject({ style: "protector", target: "protect" });
  });

  test("a bard, or a silver tongue, talks first; an artificer and a thief's Fast Hands use what they carry", () => {
    expect(dnd5eTactics(pc({ classes: [cls("bard", "Bard", 1, { progression: "full" })] })).talk).toEqual({ value: "first", why: "Bard" });
    // (Expertise counts double: Deception with expertise and Persuasion.)
    expect(dnd5eTactics(pc({ classes: [cls("rogue", "Rogue", 1)], skills: { dec: 2, per: 1 } })).talk.value).toBe("first");
    expect(dnd5eTactics(pc({ classes: [cls("artificer", "Artificer", 1, { progression: "artificer" })] })).consumables).toEqual({ value: "freely", why: "Artificer" });
    expect(dnd5eTactics(pc({ classes: [cls("rogue", "Rogue", 3, { subclass: { id: "thief", name: "Thief" } })], features: [feat("fast-hands", "Fast Hands")] })).consumables).toEqual({ value: "freely", why: "Fast Hands" });
  });

  test("a frail caster drinks its potions early; a hero with none has nothing to say about them", () => {
    const sorcerer = extra => dnd5eTactics(pc({ classes: [cls("sorcerer", "Sorcerer", 3, { hd: "d6", progression: "full" })], ...extra }));
    expect(sorcerer({ potions: 1 }).potionThreshold).toEqual({ value: "50", why: text("FFDND5E.Reason.HitDie", { name: "Sorcerer", die: "d6" }) });
    expect(sorcerer({}).potionThreshold).toBeUndefined();
  });

  test("a merchant buys its way out with a tenth of its money, if that's a coin or more", () => {
    const merchant = gold => dnd5eTactics(pc({ background: { id: "merchant", name: "Merchant" }, money: gold * 100 }));
    expect(merchant(500).offer).toEqual({ value: money(50), why: "Merchant" });
    expect(merchant(5).offer).toBeUndefined();
  });

  test("its signature attack: Eldritch Blast with Agonizing Blast; the one weapon its fighting style is made for", () => {
    expect(dnd5eTactics(WARLOCK).preferredAction).toEqual({ value: "eldritch-blast", why: "Agonizing Blast" });
    // (Eldritch Blast without the invocation is just one more cantrip.)
    expect(dnd5eTactics({ ...WARLOCK, features: [feat("pact-magic", "Pact Magic")] }).preferredAction).toBeUndefined();
    // Archery: its bow, not a dagger thrown.
    expect(dnd5eTactics(ARCHER).preferredAction).toEqual({ value: "longbow", why: "Archery" });
    const fighter = (style, attacks) => dnd5eTactics(pc({ classes: [cls("fighter", "Fighter", 5, { hd: "d10" })], features: [style], attacks })).preferredAction;
    const greatsword = atk("greatsword.extra", "Greatsword ×2", { item: "greatsword", weapon: "melee", twoHanded: true });
    const longsword = atk("longsword.extra", "Longsword ×2", { item: "longsword", weapon: "melee" });
    expect(fighter(feat("great-weapon-fighting", "Great Weapon Fighting"), [greatsword, longsword])).toEqual({ value: "greatsword.extra", why: "Great Weapon Fighting" });
    expect(fighter(feat("dueling", "Dueling"), [greatsword, longsword])).toEqual({ value: "longsword.extra", why: "Dueling" });
    // (Two weapons it could duel with: no telling which.)
    expect(fighter(feat("dueling", "Dueling"), [longsword, atk("mace", "Mace", { weapon: "melee" })])).toBeUndefined();
  });

  test("gear: a thief's Use Magic Device, a creature's flask to throw, a merchant's eye for what it costs", () => {
    expect(dnd5eTactics(pc({ classes: [cls("rogue", "Rogue", 13)], features: [feat("use-magic-device", "Use Magic Device")] })).consumables).toEqual({ value: "freely", why: "Use Magic Device" });
    expect(dnd5eTactics(SAPPER).consumables).toEqual({ value: "freely", why: "Alchemist's Fire" });
    // (A hero's flask says nothing of how readily it's thrown.)
    expect(dnd5eTactics({ ...SAPPER, pc: true }).consumables).toBeUndefined();
    expect(dnd5eTactics(pc({ background: { id: "merchant", name: "Merchant" } })).consumables).toEqual({ value: "sparing", why: "Merchant" });
  });

  test("a feature without an identifier is known by its English name, and shown by its own", () => {
    const pack = { id: "", name: "Tácticas de manada", en: "pack tactics" };
    expect(dnd5eTactics(npc({ creature: "beast", int: 3, speaks: false, features: [pack] })).beyond).toEqual({ value: "hunt", why: "Tácticas de manada" });
  });
});

describe("creatures", () => {
  test("a goblin slips away when hurt, leaves its friends to it, and wants paying", () => {
    const out = dnd5eTactics(GOBLIN);
    expect(values(out)).toEqual({ style: "skirmisher", retreat: "hurt", allyDying: "fight", shield: "spare", expect: money(10) });
    expect(whys(out)).toMatchObject({ style: "Nimble Escape", retreat: "Nimble Escape", allyDying: "Neutral Evil", expect: "Neutral Evil" });
    // A goblin boss puts a friend between itself and harm.
    expect(dnd5eTactics(GOBLIN_BOSS).allyDying).toEqual({ value: "protectSelf", why: "Redirect Attack" });
  });

  test("a wolf: no words, a pack that hunts and runs when it's losing; a bear stays and flees when hurt", () => {
    const wolf = dnd5eTactics(WOLF);
    expect(values(wolf)).toEqual({
      talk: "never", offer: NOTHING, expect: NOTHING, retreat: "losing", beyond: "hunt", shield: "never", selfRevived: "retreat"
    });
    expect(whys(wolf)).toMatchObject({
      talk: text("FFDND5E.Reason.NoLanguage"), offer: text("FFDND5E.Reason.NoLanguage"), retreat: "Pack Tactics", beyond: "Pack Tactics",
      shield: text("FFDND5E.Reason.Ability", { name: "Intelligence", n: 3 }), selfRevived: text("FFDND5E.Reason.BeastFlees")
    });
    const bear = dnd5eTactics(BEAR);
    expect(values(bear)).toMatchObject({ retreat: "hurt", beyond: "stay" });
    expect(bear.beyond.why).toBe("Beast");
  });

  test("a zombie barely thinks: the nearest, never running, back up from its Undead Fortitude", () => {
    const out = dnd5eTactics(ZOMBIE);
    const blank = text("FFDND5E.Reason.BarelyThinks");
    expect(out).toMatchObject({
      target: { value: "nearest", why: blank }, talk: { value: "never", why: blank }, retreat: { value: "never", why: blank },
      allyDying: { value: "fight", why: blank }, shield: { value: "never", why: blank }, beyond: { value: "stay", why: blank },
      offer: { value: NOTHING, why: blank }, expect: { value: NOTHING, why: blank }, selfRevived: { value: "rejoin", why: "Undead Fortitude" }
    });
  });

  test("a shield guardian guards its master's wearer, and a construct stays and never runs", () => {
    const out = dnd5eTactics(GUARDIAN);
    expect(values(out)).toMatchObject({ style: "protector", target: "protect", retreat: "never", allyDying: "fight", beyond: "stay", selfRevived: "rejoin" });
    expect(whys(out)).toMatchObject({ style: "Protection", retreat: "Construct", selfRevived: "Regeneration" });
  });

  test("a devil bargains: it talks first, spares those who pay, and fear doesn't move it", () => {
    const out = dnd5eTactics(DEVIL);
    expect(out).toMatchObject({
      talk: { value: "first", why: "Devil" }, offer: { value: { kind: "noHarm" }, why: "Devil" }, expect: { value: money(30), why: "Devil" },
      retreat: { value: "losing", why: text("FFDND5E.Reason.Immune", { condition: "frightened" }) }, allyDying: { value: "fight", why: "Lawful Evil" }
    });
  });

  test("a creature's Multiattack is what it does with its action, when it makes it one way", () => {
    expect(dnd5eTactics(OGRE).preferredAction).toEqual({ value: "ogre.multiattack", why: "Multiattack" });
    // (Scimitar or Pistol in any combination: no telling which.)
    const choices = [atk("captain.multiattack", "Multiattack (Scimitar)", { multiattack: true }), atk("captain.multiattack.1", "Multiattack (Pistol)", { multiattack: true })];
    expect(dnd5eTactics({ ...BANDIT_CAPTAIN, attacks: choices }).preferredAction).toBeUndefined();
  });

  test("a dragon breathes as soon as it can and wants tribute; a kobold, a dragon too, wants none", () => {
    const out = dnd5eTactics(DRAGON);
    expect(out).toMatchObject({ resourceUse: { value: "nova", why: "Poison Breath" }, expect: { value: money(80), why: "Dragon" }, talk: { value: "opportune", why: "Deception" } });
    expect(dnd5eTactics(KOBOLD).expect).toBeUndefined();
  });

  test("healers: a priest as it comes, an evil one for itself, a celestial readily", () => {
    expect(dnd5eTactics(PRIEST)).toMatchObject({ healAggro: { value: "balanced", why: "Healing Word" }, allyDying: { value: "rescue", why: "Healing Word" } });
    const cultPriest = dnd5eTactics({ ...PRIEST, alignment: "ne" });
    expect(values(cultPriest)).toMatchObject({ healAggro: "conservative", allyDying: "fight" });
    const deva = dnd5eTactics(DEVA);
    expect(values(deva)).toMatchObject({ healAggro: "aggressive", allyDying: "rescue", offer: { kind: "noHarm" }, expect: { kind: "noHarm" } });
    expect(whys(deva)).toMatchObject({ healAggro: "Celestial", offer: "Lawful Good" });
  });

  test("a troll's Regeneration: no potion needed, and straight back into the fight", () => {
    expect(dnd5eTactics(TROLL)).toMatchObject({ potionThreshold: { value: "never", why: "Regeneration" }, selfRevived: { value: "rejoin", why: "Regeneration" }, offer: { value: NOTHING, why: "Chaotic Evil" } });
  });

  test("a creature's Spellcasting makes it a caster where its spells are its best attacks", () => {
    expect(dnd5eTactics({ ...MAGE, coreStyle: "caster" })).toMatchObject({ style: { value: "caster", why: "Spellcasting" }, specialty: { value: "strong", why: "Spellcasting" } });
    const brute = dnd5eTactics({ ...MAGE, coreStyle: "frontline" });
    expect([brute.style, brute.specialty]).toEqual([undefined, undefined]);
  });

  test("a lich's legendary actions are for this fight; its Rejuvenation brings it back", () => {
    expect(dnd5eTactics(LICH)).toMatchObject({ resourceUse: { value: "nova", why: text("FFDND5E.LegendaryActions") }, selfRevived: { value: "rejoin", why: "Rejuvenation" } });
    // (An undead lich isn't a sellsword: its alignment asks no money.)
    expect(dnd5eTactics(LICH).expect).toBeUndefined();
  });

  test("a gnoll's Rampage finishes off the hurt and hunts; a knight's Leadership calls for help; a cultist never runs", () => {
    expect(values(dnd5eTactics(GNOLL))).toMatchObject({ target: "weakest", beyond: "hunt" });
    expect(dnd5eTactics(KNIGHT).beyond).toEqual({ value: "seekHelp", why: "Leadership" });
    expect(dnd5eTactics(CULTIST).retreat).toEqual({ value: "never", why: "Dark Devotion" });
  });

  test("a summoned creature serves: it never runs, stays, and bargains for nothing", () => {
    const out = dnd5eTactics(npc({ creature: "celestial", alignment: "lg", summoned: true }));
    const master = text("FFDND5E.Reason.Master");
    expect(out).toMatchObject({ retreat: { value: "never", why: master }, beyond: { value: "stay", why: master }, talk: { value: "never", why: master }, offer: { value: NOTHING, why: master } });
  });
});

describe("what it leaves to the core", () => {
  test("a guard with nothing of its own says only that it can Dodge", () => {
    expect(Object.keys(dnd5eTactics(GUARD))).toEqual(["shield"]);
  });

  test("a fighter's sheet says nothing of whom it targets, its consumables, healing, running or bargaining", () => {
    const out = dnd5eTactics(RANDAL);
    for ( const k of ["preferredAction", "target", "resourceUse", "specialty", "consumables", "healAggro", "potionThreshold", "allyDying", "retreat", "beyond", "offer", "expect"] ) {
      expect([k, out[k]]).toEqual([k, undefined]);
    }
  });

  test("nothing at all, from nothing", () => {
    expect(dnd5eTactics()).toEqual({ shield: { value: "spare", why: text("FFDND5E.Dodge") } });
    expect(dnd5eTactics({ mindless: true }).shield.value).toBe("never");
  });
});

describe("every answer is one of its question's choices, with a reason", () => {
  test("for everyone here, and the core keeps each of them", () => {
    for ( const who of EVERYONE ) {
      const out = dnd5eTactics(who);
      for ( const [k, { value, why }] of Object.entries(out) ) {
        expect([k, typeof why === "string" && why.length > 0]).toEqual([k, true]);
        if ( k === "offer" || k === "expect" ) expect([k, value, validMotive(k, value)]).toEqual([k, value, true]);
        else if ( k === "preferredAction" ) expect((who.attacks ?? []).map(a => a.id)).toContain(value);
        else expect([k, TACTIC_CHOICES[k]]).toEqual([k, expect.arrayContaining([value])]);
      }
      // (The core takes each answer, with its reason: its signature attack among its own actions.)
      const { lets, why } = withHints({}, out, { actions: (who.attacks ?? []).map(a => ({ id: a.id })) });
      expect(Object.keys(lets).sort()).toEqual(Object.keys(out).sort());
      expect(Object.keys(why).sort()).toEqual(Object.keys(out).sort());
    }
  });
});

describe("the adapter reads the sheet", () => {
  /** An actor as Foundry's dnd5e prepares one: items with their activities (range and target as prepared). */
  const item = (type, identifier, name, system = {}) => ({ id: identifier, type, name, identifier, flags: {}, effects: [], system: { identifier, activities: [], ...system } });
  const heal = (activation, affects, units) => ({ type: "heal", activation: { type: activation }, target: { affects: { type: affects } }, range: { units }, healing: { types: new Set(["healing"]) } });
  const actorOf = (type, system, items, classes = {}) => Object.assign({ type, system, flags: {}, classes }, { items: Object.assign(items, { get: id => items.find(i => i.id === id) }) });
  const valuables = gold => ({ money: gold * 100, denominations: COINS.map(value => ({ label: String(value), value })) });

  test("Akra, as the test world has her", () => {
    const life = item("subclass", "life-domain", "Life Domain", { classIdentifier: "cleric", spellcasting: { progression: "none" } });
    const cleric = Object.assign(item("class", "cleric", "Cleric", { levels: 1, hd: { denomination: "d8" }, spellcasting: { progression: "full" } }), { subclass: life });
    const items = [
      cleric, life, item("background", "priest", "Priest"),
      item("feat", "disciple-of-life", "Disciple of Life"),
      item("spell", "healing-word", "Healing Word", { level: 1, method: "spell", prepared: 1, range: { units: "ft" }, activities: [heal("bonus", "creature", "ft")] }),
      item("spell", "cure-wounds", "Cure Wounds", { level: 1, method: "spell", prepared: 0, range: { units: "touch" }, activities: [heal("action", "creature", "touch")] }),
      item("consumable", "potion-of-healing", "Potion of Healing", { type: { value: "potion" }, quantity: 2, activities: [heal("bonus", "self", "self")] })
    ];
    const akra = actorOf("character", {
      details: { level: 1, alignment: "Lawful Good" }, abilities: { int: { value: 8 } },
      skills: { med: { proficient: 1 }, per: { proficient: 0 } }, traits: { languages: { value: new Set(["common", "draconic"]) }, ci: { value: new Set() } }
    }, items, { cleric });
    const out = new Dnd5eAdapter().tacticHints(akra, { valuables: valuables(15) }, { style: "caster" });
    expect(values(out)).toMatchObject({ style: "caster", resourceUse: "conserve", specialty: "strong", healAggro: "allCosts", allyDying: "rescue", selfRevived: "healSelf" });
    // (Only the spell she has ready heals others.)
    expect(out.selfRevived.why).toBe("Healing Word");
  });

  test("a priest whose sheet says \"Common plus one other language\" has words (how it uses them is the core's to say); a zombie that can't speak has none", () => {
    const priest = actorOf("npc", {
      details: { cr: 2, type: { value: "humanoid", subtype: "Cleric" }, alignment: "Neutral" }, abilities: { int: { value: 13 } },
      skills: {}, traits: { languages: { value: new Set(), custom: "Common plus one other language" }, ci: { value: new Set() } }, resources: { legact: { max: 0 } }
    }, [item("spell", "healing-word", "Healing Word", { level: 1, method: "spell", activities: [heal("bonus", "creature", "ft")] })]);
    const out = new Dnd5eAdapter().tacticHints(priest, { valuables: valuables(0) }, {});
    expect([out.talk, out.offer, out.expect]).toEqual([undefined, undefined, undefined]);
    expect(out.healAggro).toEqual({ value: "balanced", why: "Healing Word" });
    const zombie = actorOf("npc", {
      details: { cr: 0.25, type: { value: "undead" }, alignment: "Neutral Evil" }, abilities: { int: { value: 3 } }, skills: {},
      traits: { languages: { value: new Set(), custom: "Understands Common plus one other language but can’t speak" }, ci: { value: new Set(["poisoned"]) } }
    }, [item("feat", "undead-fortitude", "Undead Fortitude")]);
    expect(values(new Dnd5eAdapter().tacticHints(zombie, { valuables: valuables(0) }, {}))).toMatchObject({ talk: "never", retreat: "never", selfRevived: "rejoin" });
  });

  /** Its weapon attacks as its CombatantSpec has them (the plain one, and the Attack action with Extra Attack). */
  const strikes = (actorId, weapon, melee) => {
    const plain = { id: `${actorId}.${weapon}.attack`, name: weapon, kind: "strike", weapon: true, melee, itemId: weapon };
    return [plain, { ...plain, id: `${plain.id}.extra`, name: `${weapon} ×2`, sequence: [plain, plain] }];
  };
  const weapon = (id, type, properties = []) => item("weapon", id, id, { type: { value: type }, properties: new Set(properties) });

  test("a fighter with Great Weapon Fighting: its greatsword, with Extra Attack, rather than its longbow", () => {
    const fighter = Object.assign(actorOf("character", {
      details: { level: 5 }, abilities: { int: { value: 10 } }, skills: {}, traits: { languages: { value: new Set(["common"]) }, ci: { value: new Set() } }
    }, [item("feat", "great-weapon-fighting", "Great Weapon Fighting"), weapon("greatsword", "martialM", ["two", "hvy"]), weapon("longbow", "martialR", ["two", "hvy", "amm"])]), { id: "hero" });
    const actions = [...strikes("hero", "greatsword", true), ...strikes("hero", "longbow", false)];
    const out = new Dnd5eAdapter().tacticHints(fighter, { valuables: valuables(0), actions }, {});
    expect(out.preferredAction).toEqual({ value: "hero.greatsword.attack.extra", why: "Great Weapon Fighting" });
  });

  test("a creature's Multiattack, from its spec; every answer with a reason the core keeps", () => {
    const ogre = Object.assign(actorOf("npc", {
      details: { cr: 2, type: { value: "giant" }, alignment: "Chaotic Evil" }, abilities: { int: { value: 5 } }, skills: {},
      traits: { languages: { value: new Set(["common", "giant"]) }, ci: { value: new Set() } }, resources: { legact: { max: 0 } }
    }, [item("feat", "multiattack", "Multiattack"), weapon("greatclub", "martialM", ["two"])]), { id: "ogre" });
    const club = strikes("ogre", "greatclub", true)[0];
    const spec = { valuables: valuables(0), actions: [club, { ...club, id: "ogre.multiattack", name: "Multiattack", sequence: [club, club] }] };
    const out = new Dnd5eAdapter().tacticHints(ogre, spec, {});
    expect(out.preferredAction).toEqual({ value: "ogre.multiattack", why: "Multiattack" });
    for ( const [k, { why }] of Object.entries(out) ) expect([k, typeof why === "string" && why.length > 0]).toEqual([k, true]);
    const kept = withHints({}, out, spec);
    expect(Object.keys(kept.why).sort()).toEqual(Object.keys(out).sort());
  });
});

describe("the languages it speaks", () => {
  const names = { common: "Common", draconic: "Draconic", infernal: "Infernal", cant: "Thieves' Cant" };

  test("its sheet's, and those its custom languages name (the 2024 creatures write theirs that way)", () => {
    expect(spokenLanguages({ value: new Set(["common", "cant"]), custom: "" }, names)).toEqual(["common", "cant"]);
    expect(spokenLanguages({ value: [], custom: "Common plus one other language" }, names)).toEqual(["common"]);
    expect(spokenLanguages({ value: ["common"], custom: "can’t speak in wolf form" }, names)).toEqual(["common"]);
    expect(speaksAtAll({ value: [], custom: "any two languages" }, names)).toBe(true);
  });

  test("none for one that understands but can't speak; telepathy is enough to speak", () => {
    for ( const custom of ["Understands Common plus one other language but can’t speak", "understands Infernal but can't speak", "understands Common but doesn't speak it"] ) {
      expect(spokenLanguages({ value: [], custom }, names)).toEqual([]);
      expect(speaksAtAll({ value: [], custom }, names)).toBe(false);
    }
    expect(spokenLanguages({ value: ["common", "draconic"], custom: "can't speak" }, names)).toEqual([]);
    expect(speaksAtAll({ value: [], custom: "", communication: { telepathy: { value: 60, units: "ft" } } }, names)).toBe(true);
    expect(speaksAtAll({ value: [], custom: "" }, names)).toBe(false);
  });
});
