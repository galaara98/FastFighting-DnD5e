/**
 * The adapter reading a sheet as Foundry's dnd5e prepares one: who could steal, Relentless Endurance, dnd5e's own
 * difficult terrain, a summoning's formulas worked out with its caster's numbers, and the lore pages a biography embeds
 * (only those its players could read themselves).
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Dnd5eAdapter, summonData, summonNumber, summonDice } from "../scripts/adapter.js";

/** Foundry's Roll.replaceFormulaData, as it fills a formula's @data in: a number or text as it is, an object by its own words. */
function replaceFormulaData(formula, data, { missing } = {}) {
  return String(formula).replace(/@([a-z.0-9_-]+)/gi, (match, term) => {
    const value = term.split(".").reduce((o, k) => o?.[k], data);
    if ( value === null || value === undefined ) return missing !== undefined ? String(missing) : match;
    if ( typeof value === "string" ) return value.trim();
    if ( typeof value === "number" || typeof value === "boolean" ) return String(Number(value));
    if ( typeof value.toString === "function" && value.toString !== Object.prototype.toString ) return value.toString();
    return `ᚖ${JSON.stringify(value)}ᚖ`;
  });
}

/** dnd5e's @scaling: its value by itself (1 at an item's own level), and how many levels up. */
const scaling = increase => ({ increase, get value() { return increase + 1; }, toString() { return this.value; } });

const listOf = list => Object.assign(list, { get: id => list.find(i => i.id === id), getName: name => list.find(i => i.name === name) });
const item = (type, identifier, name, system = {}) => ({ id: identifier, type, name, identifier, flags: {}, effects: [], system: { identifier, activities: [], ...system } });
/** An actor as Foundry's dnd5e prepares one, with only what these tests look at. */
function actorOf({ id = "actor", type = "npc", creature = "humanoid", int = 10, hp = 20, items = [], details = {}, owners = [], rollData = null } = {}) {
  return {
    id, uuid: `Actor.${id}`, documentName: "Actor", type, name: id, img: "", flags: {}, statuses: new Set(), appliedEffects: [], classes: {},
    items: listOf(items),
    testUserPermission: (user, level) => level === "OWNER" && owners.includes(user.id),
    getRollData: () => rollData ?? {},
    toObject() { return { name: this.name }; },
    system: {
      abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(k => [k, { value: k === "int" ? int : 10, mod: 0, save: 0 }])),
      attributes: { hp: { value: hp, max: hp, temp: 0 }, ac: { value: 12 }, movement: { walk: 30, units: "ft" }, senses: {}, death: {}, spellcasting: "wis" },
      details: { cr: 1, level: 1, type: { value: creature }, ...details },
      skills: Object.fromEntries(["slt", "ste", "prc", "ins", "per", "itm", "dec", "med", "ath"].map(k => [k, { total: 1, passive: 11 }])),
      traits: { size: "med", languages: { value: new Set() }, di: {}, dr: {}, dv: {}, ci: {} },
      resources: {}, currency: {}, spells: {}
    }
  };
}
const specOf = actor => new Dnd5eAdapter().toCombatantSpec({ id: "token", name: actor.name, actor });

beforeEach(() => { globalThis.Roll = { replaceFormulaData }; });
afterEach(() => { delete globalThis.Roll; delete globalThis.fromUuidSync; delete globalThis.fromUuid; });

describe("who could steal", () => {
  test("a character, or a creature with the wits to: not a beast, nor the mindless, nor an animal's mind", async () => {
    const theft = async extra => (await specOf(actorOf(extra))).theft;
    expect(await theft({ type: "character" })).toMatchObject({ mod: 1 });
    expect(await theft({ creature: "humanoid", int: 10 })).toMatchObject({ mod: 1 });
    expect(await theft({ creature: "fey", int: 12 })).toMatchObject({ mod: 1 });
    expect(await theft({ creature: "beast", int: 2 })).toBeNull();
    expect(await theft({ creature: "beast", int: 6 })).toBeNull(); // (an ape)
    expect(await theft({ creature: "undead", int: 3 })).toBeNull(); // (a zombie)
    expect(await theft({ creature: "monstrosity", int: 3 })).toBeNull(); // (an owlbear)
    expect(await theft({ creature: "ooze", int: 1 })).toBeNull();
  });
});

describe("reactions at the master list's newer moments", () => {
  test("a Death Burst (by its identifier): as it dies, a save against what bursts from it, for everyone near; no reaction spent", async () => {
    const burst = { type: "save", save: { ability: new Set(["dex"]), dc: { value: 11 } }, damage: { onSave: "half", parts: [{}] }, target: { template: { size: 10 } },
      getDamageConfig: () => ({ rolls: [{ parts: ["2d6"], options: { types: ["fire"] } }] }) };
    const magmin = actorOf({ items: [item("feat", "death-burst", "Death Burst", { activities: [burst] })] });
    const [r] = (await specOf(magmin)).reactions;
    expect(r).toMatchObject({ on: "slain", free: true, label: "Death Burst", areaBurst: { save: { type: "dex", dc: 11, basic: true }, range: 10 } });
    expect(r.areaBurst.damage[0]).toMatchObject({ type: "fire", dice: [{ n: 2, faces: 6 }] });
    // (One that does no damage, a dust mephit's blinding, isn't played yet.)
    const dust = actorOf({ items: [item("feat", "death-burst", "Death Burst", { activities: [{ type: "save", save: { ability: new Set(["con"]), dc: { value: 10 } }, damage: { parts: [] } }] })] });
    expect((await specOf(dust)).reactions ?? []).toEqual([]);
  });

  test("the Protection fighting style covers a friend attacked within 5 feet, only with a shield in hand", async () => {
    const style = item("feat", "protection", "Protection");
    const shield = { ...item("equipment", "shield", "Shield", { type: { value: "shield" }, equipped: true }), id: "shield-item" };
    const [r] = (await specOf(actorOf({ type: "character", items: [style, shield] }))).reactions;
    expect(r).toMatchObject({ on: "allyTargeted", range: 5, ac: 5, label: "Protection" });
    expect((await specOf(actorOf({ type: "character", items: [style] }))).reactions ?? []).toEqual([]);
  });
});

describe("Relentless Endurance", () => {
  const relentless = spent => item("feat", "relentless-endurance", "Relentless Endurance", { uses: { max: 1, spent } });

  test("by its identifier: it holds on at 1 hit point with no save to make, while it has its use (a pool, spent on its sheet when it holds on)", async () => {
    const spec = await specOf(actorOf({ type: "character", items: [relentless(0)] }));
    const pool = "feature:relentless-endurance";
    expect(spec.holdOn).toEqual({ save: "con", base: -Infinity, except: [], notOnCrit: false, label: "Relentless Endurance", pool });
    expect(spec.resources[pool]).toBe(1);
    expect(spec.resourceNames[pool]).toBe("Relentless Endurance");
  });

  test("not once it's used, until a long rest", async () => {
    const spec = await specOf(actorOf({ type: "character", items: [relentless(1)] }));
    expect(spec.holdOn).toBeUndefined();
    expect(spec.resources["feature:relentless-endurance"]).toBeUndefined();
  });
});

describe("dnd5e's regions", () => {
  test("its difficult terrain (Spike Growth's, Plant Growth's) is difficult; the rest isn't its to say", () => {
    const adapter = new Dnd5eAdapter();
    expect(adapter.describeRegionBehavior({ type: "dnd5e.difficultTerrain", system: { magical: true, types: new Set(["plants"]) } })).toEqual({ difficult: true });
    expect(adapter.describeRegionBehavior({ type: "dnd5e.rotateArea", system: {} })).toBeNull();
    expect(adapter.describeRegionBehavior({ type: "teleportToken", system: {} })).toBeNull();
  });
});

describe("a summoning's formulas, with its caster's numbers", () => {
  // (As dnd5e's activity has them: the caster's roll data, the item's at the level it's cast at, its scaling, @mod.)
  const caster = {
    attributes: { spell: { mod: 3 }, hp: { max: 40, value: 31 }, prof: 3 }, abilities: { wis: { mod: 2 } }, classes: { ranger: { levels: 5 } },
    prof: { toString: () => "3" }, mod: 3
  };
  const cast = (level, up = 0) => ({ ...caster, item: { level: level + up }, scaling: scaling(up) });

  test("its count and bonuses: @scaling, @scaling.increase, the caster's spellcasting, abilities, class levels, hit points", () => {
    const data = cast(3);
    // (A count of "@scaling" was 0 before, and nothing was called: Horn of Valhalla, Pipes of the Sewers.)
    expect(summonNumber("@scaling", data)).toBe(1);
    expect(summonNumber("1 + @scaling.increase * 2", data)).toBe(1);
    expect(summonNumber("1 + @scaling.increase * 2", cast(3, 1))).toBe(3); // (Animate Dead one level up)
    expect(summonNumber("floor(@attributes.spell.mod / 2)", data, 0)).toBe(1);
    expect(summonNumber("@abilities.wis.mod", data, 0)).toBe(2);
    expect(summonNumber("@classes.ranger.levels", data, 0)).toBe(5);
    expect(summonNumber("@attributes.hp.max", data, 0)).toBe(40); // (Bigby's Hand: the caster's hit point maximum)
    expect(summonNumber("@prof", data, 0)).toBe(3);
    expect(summonNumber("10 * (@item.level - 3)", cast(3, 2), 0)).toBe(20);
  });

  test("the creature's own numbers, where a bonus counts them (@summon)", () => {
    const data = { ...cast(3), summon: { attributes: { hp: { value: 30 } } } };
    expect(summonNumber("- (@summon.attributes.hp.value / 2)", data, 0)).toBe(-15);
    expect(summonNumber("-@summon.attributes.hp.value + floor(@attributes.hp.value / 2)", data, 0)).toBe(-15);
  });

  test("a damage bonus as dice and a flat number; none when it comes to nothing", () => {
    expect(summonDice("@mod + (@scaling)d12", cast(6))).toMatchObject({ dice: [{ n: 1, faces: 12 }], flat: 3 });
    expect(summonDice("(@item.level - 5)d8", cast(5, 2))).toMatchObject({ dice: [{ n: 2, faces: 8 }], flat: 0 });
    expect(summonDice("(@item.level - 6)d12", cast(6))).toBeNull();
    expect(summonDice("@abilities.wis.mod", cast(1))).toMatchObject({ dice: [], flat: 2 });
    expect(summonDice("", cast(1))).toBeNull();
  });

  test("still arithmetic only: what the data fills in is never run as code", () => {
    const data = { ...cast(3), name: 'constructor.constructor("globalThis.pwnedBySummon = 1")()' };
    expect(summonNumber("@name", data, 1)).toBe(1);
    expect(summonDice("@name", data)).toBeNull();
    expect(globalThis.pwnedBySummon).toBeUndefined();
  });

  test("what dnd5e works them out with: the activity's own roll data; else the caster's, with the item's and its scaling", () => {
    const own = cast(3);
    expect(summonData({}, {}, { getRollData: () => own })).toBe(own);
    const item = { system: { level: 5 }, flags: { dnd5e: { scaling: 2 } } };
    const data = summonData({ getRollData: () => caster }, item, {});
    expect(summonNumber("@item.level", data, 0)).toBe(5);
    expect(summonNumber("@scaling", data, 0)).toBe(3);
    expect(summonNumber("@scaling.increase", data, 0)).toBe(2);
    expect(summonNumber("@attributes.spell.mod", data, 0)).toBe(3);
  });

  test("in a creature's spec: called as many as its count says, with the caster's hit points and damage added", async () => {
    // (A wolf with a bite: what's called.)
    const bite = {
      id: "bite", type: "attack", activation: { type: "action" }, attack: { type: { value: "melee" } }, labels: { modifier: "+4" },
      getDamageConfig: () => ({ rolls: [{ parts: ["1d6 + 2"], options: { types: ["piercing"] } }] }), getRollData: () => ({})
    };
    const wolf = actorOf({ id: "wolf", creature: "beast", int: 3, hp: 11, items: [item("weapon", "bite", "Bite", { activities: [bite], range: {} })] });
    globalThis.fromUuid = async uuid => (uuid === "Actor.wolf" ? wolf : null);
    const summon = {
      id: "call", type: "summon", activation: { type: "action" }, match: {},
      profiles: [{ count: "@scaling", uuid: "Actor.wolf", level: {} }],
      bonuses: { hp: "@attributes.hp.max", attackDamage: "@mod + (@scaling)d12" },
      getRollData: () => cast(3)
    };
    const spell = item("spell", "call-wolf", "Call Wolf", { level: 3, activities: [summon], duration: { units: "minute", value: 1 } });
    const spec = await specOf(actorOf({ items: [spell] }));
    const called = spec.actions.find(a => a.kind === "summon");
    expect(called.creatures).toHaveLength(1);
    expect(called.creatures[0].hp).toMatchObject({ value: 51, max: 51 });
    expect(called.creatures[0].actions.find(a => a.name === "Bite").damage[1]).toMatchObject({ dice: [{ n: 1, faces: 12 }], flat: 3, type: "piercing" });
  });

  test("a player's summoning calls only what they could summon themselves: a world creature of theirs, a compendium's they may open", async () => {
    const bite = {
      id: "bite", type: "attack", activation: { type: "action" }, attack: { type: { value: "melee" } }, labels: { modifier: "+4" },
      getDamageConfig: () => ({ rolls: [{ parts: ["1d6 + 2"], options: { types: ["piercing"] } }] }), getRollData: () => ({})
    };
    const beast = (id, owners, pack = null) => Object.assign(actorOf({ id, creature: "beast", hp: 11, owners, items: [item("weapon", "bite", "Bite", { activities: [bite], range: {} })] }), pack ? { pack } : {});
    const ACTORS = { "Actor.mine": beast("mine", ["player"]), "Actor.gms": beast("gms", []), "Compendium.open.wolf": beast("wolf", [], "open"), "Compendium.hidden.boss": beast("boss", [], "hidden") };
    globalThis.fromUuid = async uuid => ACTORS[uuid] ?? null;
    const was = { users: globalThis.game.users, packs: globalThis.game.packs };
    globalThis.game.users = [{ id: "gm", isGM: true }, { id: "player", isGM: false }];
    globalThis.game.packs = new Map([["open", { testUserPermission: () => true }], ["hidden", { testUserPermission: u => u.isGM }]]);
    try {
      const calls = async (uuid, owners) => {
        const summon = { id: "call", type: "summon", activation: { type: "action" }, match: {}, profiles: [{ count: "1", uuid, level: {} }], bonuses: {}, getRollData: () => ({}) };
        const spell = { ...item("spell", "call", "Call", { level: 3, activities: [summon], duration: { units: "minute", value: 1 } }), testUserPermission: (u, level) => level === "OWNER" && owners.includes(u.id) };
        const spec = await specOf(actorOf({ items: [spell], owners }));
        return spec.actions.some(a => a.kind === "summon");
      };
      expect(await calls("Actor.mine", ["player"])).toBe(true);
      expect(await calls("Compendium.open.wolf", ["player"])).toBe(true);
      expect(await calls("Actor.gms", ["player"])).toBe(false);
      expect(await calls("Compendium.hidden.boss", ["player"])).toBe(false);
      // (The GM's own creature's summoning calls any.)
      expect(await calls("Compendium.hidden.boss", [])).toBe(true);
      expect(await calls("Actor.gms", [])).toBe(true);
    } finally {
      Object.assign(globalThis.game, was);
    }
  });
});

describe("a lore page a biography embeds", () => {
  const PAGES = {
    "JournalEntry.lore.JournalEntryPage.open": { owners: ["player"], content: "Wolves hunt in packs." },
    "JournalEntry.lore.JournalEntryPage.secret": { owners: [], content: "The innkeeper is the werewolf." }
  };
  const users = [{ id: "gm", isGM: true }, { id: "player", isGM: false }, { id: "other", isGM: false }];
  const page = ({ owners, content }) => ({ text: { content }, testUserPermission: (user, level) => level === "OBSERVER" && (user.isGM || owners.includes(user.id)) });
  const html = "<p>Its lore. @Embed[JournalEntry.lore.JournalEntryPage.open inline] @Embed[JournalEntry.lore.JournalEntryPage.secret]</p>";
  beforeEach(() => {
    globalThis.game.users = users;
    globalThis.fromUuidSync = uuid => (PAGES[uuid] ? page(PAGES[uuid]) : null);
  });

  test("a creature of the GM's own (no player owns it) reads any page", () => {
    const bio = new Dnd5eAdapter().biography(actorOf({ details: { biography: { value: html } } }));
    expect(bio.about).toContain("Wolves hunt in packs.");
    expect(bio.about).toContain("The innkeeper is the werewolf.");
  });

  test("a player's character reads only the pages its players could read themselves", () => {
    const mine = new Dnd5eAdapter().biography(actorOf({ type: "character", owners: ["player"], details: { biography: { value: html } } }));
    expect(mine.story).toContain("Wolves hunt in packs.");
    expect(mine.story).not.toContain("werewolf");
    // (Another player's: neither page is theirs to read.)
    const theirs = new Dnd5eAdapter().biography(actorOf({ type: "character", owners: ["other"], details: { biography: { value: html } } }));
    expect(theirs.story).not.toContain("Wolves");
    expect(theirs.story).not.toContain("werewolf");
  });

  test("never a web address; only the start of a long page", () => {
    PAGES["JournalEntry.lore.JournalEntryPage.long"] = { owners: ["player"], content: "x".repeat(6000) };
    const bio = new Dnd5eAdapter().biography(actorOf({ details: { biography: { value: "@Embed[https://example.com/page] @Embed[JournalEntry.lore.JournalEntryPage.long]" } } }));
    expect(bio.about).not.toContain("example");
    expect(bio.about.length).toBe(5000);
  });
});

/* The SRD's words (5.1 and 5.2, CC-BY 4.0), as dnd5e's compendiums keep them. */
const REGENERATE_2014 = "<p>You touch a creature and stimulate its natural healing ability. The target regains 4d8 + 15 hit points. For the duration of the spell, the target regains 1 hit point at the start of each of its turns (10 hit points each minute).</p>";
const REGENERATE_2024 = "<p>A creature you touch regains 4d8 + 15 Hit Points. For the duration, the target regains [[/healing 1 type=healing]]{1 Hit Point} at the start of each of its turns, and any severed body parts regrow after 2 minutes.</p>";

describe("healing that goes on (Regenerate), and a monster's Regeneration", () => {
  /** Regenerate as dnd5e has it: a heal activity (4d8 + 15), its effect with no changes, an hour long. */
  const regenerate = words => {
    const effect = { id: "regen-fx", _id: "regen-fx", name: "Regenerating", statuses: new Set(), changes: [], duration: {} };
    const heal = { id: "cast", type: "heal", activation: { type: "action" }, range: { units: "touch" }, target: {}, effects: [{ _id: "regen-fx" }],
      getDamageConfig: () => ({ rolls: [{ parts: ["4d8 + 15"], options: { types: ["healing"] } }] }) };
    return { ...item("spell", "regenerate", "Regenerate", { level: 7, activities: [heal], activation: { type: "action" }, range: { units: "touch" }, duration: { value: 1, units: "hour" },
      properties: new Set(["vocal", "somatic", "material"]), method: "spell", prepared: true, description: { value: words } }), uuid: "Item.regenerate", effects: listOf([effect]) };
  };

  test("its words, 2014's and 2024's: a hit point at the start of each of its turns", async () => {
    const { lastingHealingFrom, plainText } = await import("../scripts/adapter.js");
    expect(lastingHealingFrom(plainText(REGENERATE_2014))).toBe(1);
    expect(lastingHealingFrom(plainText(REGENERATE_2024))).toBe(1);
    expect(lastingHealingFrom(plainText("<p>A creature you touch regains a number of Hit Points equal to 2d8 plus your spellcasting ability modifier.</p>"))).toBe(0);
  });

  test("Regenerate: the heal, and the core's fast healing lent for its hour (outcome.fastHealing), its own effect for a live battle", async () => {
    for ( const words of [REGENERATE_2014, REGENERATE_2024] ) {
      const actor = actorOf({ items: [regenerate(words)] });
      actor.system.spells = { spell7: { value: 1, max: 1 } };
      const cast = (await specOf(actor)).actions.find(a => a.itemId === "regenerate");
      expect(cast).toMatchObject({ kind: "heal", reach: 5, outcome: { fastHealing: 1, rounds: 600, label: "Regenerating" }, effectRef: { uuid: "Item.regenerate", ids: ["regen-fx"] } });
      expect(cast.heal).toEqual([expect.objectContaining({ dice: [{ n: 4, faces: 8 }], flat: 15, type: "healing" })]);
    }
    // (A heal that doesn't go on lends nothing.)
    const cure = regenerate("<p>A creature you touch regains 2d8 Hit Points.</p>");
    expect((await specOf(actorOf({ items: [cure] }))).actions.find(a => a.itemId === "regenerate").outcome).toBeUndefined();
  });

  test("already under a Regenerate when the fight starts: a hit point a turn, the spec's fast healing", async () => {
    const actor = actorOf();
    actor.appliedEffects = [{ origin: "Item.regenerate", changes: [], statuses: new Set() }, { origin: "Item.gone", changes: [], statuses: new Set() }];
    globalThis.fromUuid = async uuid => (uuid === "Item.regenerate" ? regenerate(REGENERATE_2024) : null);
    expect((await specOf(actor)).fastHealing).toBe(1);
    expect((await specOf(actorOf())).fastHealing).toBeUndefined();
  });

  test("a monster's Regeneration, 2024's wording: the amount its heal gives, and it can die at 0", async () => {
    const { regenerationFrom, plainText } = await import("../scripts/adapter.js");
    const words = "<p>The oni regains [[lookup @healing.formula activity=heal]] Hit Points at the start of each of its turns if it has at least 1 Hit Point.</p>";
    expect(regenerationFrom(plainText(words), 10)).toEqual({ amount: 10, stoppedBy: [], needsHp: true });
  });
});
