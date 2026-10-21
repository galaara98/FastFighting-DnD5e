/**
 * Reactions read from a feature's words (reactions-read.js), by reading/en.json: the SRD's (5.1 and 5.2) as dnd5e's
 * compendiums have them, and paraphrases of the kinds of reaction other books give (a foe's attack on a friend, a
 * spell cast beside it, a foe entering its reach).
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { momentOf, reactionsFromWords, responseOf, triggerParts } from "../scripts/reactions-read.js";
import { Dnd5eAdapter, filledLookups } from "../scripts/adapter.js";

const read = (text, extra = {}) => reactionsFromWords({ id: "r", label: "R", text, prof: 4, mods: { dex: 3, str: 2 }, ...extra });

describe("the SRD's", () => {
  test("a monster's Parry (2014): the moment its activity's condition, the AC its words", () => {
    expect(read("The monster adds 4 to its AC against one melee attack that would hit it. To do so, the monster must see the attacker and be wielding a melee weapon.", {
      condition: "When the monster would be hit by a melee attack while it is wielding a melee weapon."
    })).toEqual([{ id: "r", label: "R", on: "hit", melee: true, ac: 4 }]);
  });

  test("2024's Trigger and Response, the AC the activity's roll formula where the words leave it to a lookup", () => {
    const text = "Trigger: The monster is hit by a melee attack roll while holding a weapon. Response: The monster adds to its AC against that attack, possibly causing it to miss.";
    expect(read(text, { formula: 2 })).toEqual([{ id: "r", label: "R", on: "hit", melee: true, ac: 2 }]);
    expect(read(text)).toEqual([]);
    // (A miss after it, a strike back: only sometimes, left out.)
    expect(read("Trigger: The monster is hit by a melee attack roll while holding a weapon. Response: The monster adds 3 to its AC against that attack, possibly causing it to miss. On a miss, the monster makes one Rapier attack against the triggering creature if within range.")).toEqual([
      { id: "r", label: "R", on: "hit", melee: true, ac: 3 }
    ]);
  });

  test("Retaliation: hurt by a creature within 5 feet, a melee weapon attack back", () => {
    expect(read("Starting at 14th level, when you take damage from a creature that is within 5 feet of you, you can use your reaction to make a melee weapon attack against that creature.")).toEqual([
      { id: "r", label: "R", on: "damaged", range: 5, strike: true }
    ]);
  });

  test("Uncanny Dodge: the blow halved; Giant Killer: attacked by one within 5 feet, an attack back", () => {
    expect(read("When an attacker that you can see hits you with an attack, you can use your reaction to halve the attack's damage against you.")).toEqual([{ id: "r", label: "R", on: "hit", halve: true }]);
    expect(read("When a Large or larger creature within 5 feet of you hits or misses you with an attack, you can use your reaction to attack that creature immediately after its attack, provided that you can see the creature.")).toEqual([
      { id: "r", label: "R", on: "attacked", range: 5, strike: true }
    ]);
  });

  test("Storm's Thunder (2024): hurt by a creature within 60 feet, thunder back at it; a blow halved, 2024's way", () => {
    expect(read("When you take damage from a creature within 60 feet of you, you can take a Reaction to deal 1d8 Thunder damage to that creature.")).toEqual([
      { id: "r", label: "R", on: "damaged", range: 60, harm: { damage: [{ dice: [{ n: 1, faces: 8 }], flat: 0, type: "thunder", persistent: false, category: null }] } }
    ]);
    expect(read("Trigger: The monster is hit by an attack roll. Response: The monster halves the damage it takes from that attack.")).toEqual([{ id: "r", label: "R", on: "hit", halve: true }]);
  });

  test("none: what the engine can't play, or can't be sure of", () => {
    for ( const [text, condition] of [
      ["When a hostile creature misses you with a melee attack, you can use your reaction to force that creature to repeat the same attack against another creature (other than itself) of your choice."],
      ["When a creature that you can see within 60 feet of you makes an attack roll, an ability check, or a damage roll, you can use your reaction to expend one of your uses of Bardic Inspiration, rolling a Bardic Inspiration die and subtracting the number rolled from the creature's roll."],
      ["Beginning at 4th level, you can use your reaction when you fall to reduce any falling damage you take by an amount equal to five times your monk level."],
      ["Trigger: The monster is hit by an attack roll. Response: The monster adds 2 to its AC against the attack, possibly causing the attack to miss, and the monster teleports up to 30 feet to an unoccupied space it can see."],
      ["Trigger: The monster takes damage while underwater. Response: The monster releases ink that fills a 5-foot Cube centered on itself, and the monster moves up to its Swim Speed."],
      ["The monster adds 2 to its AC.", ""]
    ] ) expect(read(text, { condition })).toEqual([]);
  });
});

describe("other books' kinds, paraphrased", () => {
  test("a foe beside it attacking someone else: an attack back at that foe (the foe within 5 feet, not the friend)", () => {
    expect(read("When an enemy within 5 feet of you makes an attack roll against a creature other than you, you can use your reaction to make one melee weapon attack against the attacking creature.")).toEqual([
      { id: "r", label: "R", on: "allyTargeted", byRange: 5, strike: true }
    ]);
  });

  test("a friend within 5 feet hit: dice plus its proficiency bonus off the blow; a Dexterity modifier read as its own", () => {
    expect(read("When a creature you can see hits a target, other than you, within 5 feet of you with an attack, you can use your reaction to reduce the damage the target takes by 1d10 + your proficiency bonus.")).toEqual([
      { id: "r", label: "R", on: "allyHit", range: 5, reduce: { dice: [{ n: 1, faces: 10 }], flat: 4, type: "untyped", persistent: false, category: null } }
    ]);
    const [own] = read("When an attack hits you, you can use your reaction to reduce the damage you take by 1d8 + your Dexterity modifier.");
    expect(own).toMatchObject({ on: "hit", reduce: { dice: [{ n: 1, faces: 8 }], flat: 3 } });
  });

  test("a spell cast beside it, a foe coming into its reach: an attack; casting a spell back isn't played", () => {
    expect(read("When a creature within 5 feet of you casts a spell, you can use your reaction to make a melee weapon attack against that creature.")).toEqual([{ id: "r", label: "R", on: "foeCasts", range: 5, strike: true }]);
    expect(read("While you wield a long weapon, other creatures provoke an opportunity attack from you when they enter your reach.")).toEqual([{ id: "r", label: "R", on: "foeApproaches", strike: true }]);
    expect(read("When a hostile creature's movement provokes an opportunity attack from you, you can use your reaction to cast a spell at the creature, rather than making an opportunity attack.")).toEqual([]);
  });

  test("2024's way of putting them: another creature hit, its proficiency bonus to AC, a creature entering its reach, any attack roll near it", () => {
    expect(read("When an enemy hits another creature within 5 feet of you with an attack roll, you can take a Reaction to reduce the damage dealt to the target by 1d8 plus your Proficiency Bonus.")).toMatchObject([
      { on: "allyHit", range: 5, reduce: { dice: [{ n: 1, faces: 8 }], flat: 4 } }
    ]);
    expect(read("If you're holding a light blade and an enemy hits you with a melee attack, you can take a Reaction to add your Proficiency Bonus to your Armor Class against that attack.")).toEqual([
      { id: "r", label: "R", on: "hit", melee: true, ac: 4 }
    ]);
    expect(read("While wielding a long weapon, you can take a Reaction to make one melee attack against a creature that enters the reach you have with it.")).toEqual([
      { id: "r", label: "R", on: "foeApproaches", strike: true }
    ]);
    expect(read("When a creature you can see within 30 feet of you makes an attack roll, you can take a Reaction to impose Disadvantage on the attack roll.")).toEqual([
      { id: "r", label: "R", on: ["attacked", "allyTargeted"], range: 30, ac: 5 }
    ]);
  });

  test("two reactions in one feature, numbered past the first", () => {
    const both = read("When an enemy within 5 feet of you makes an attack roll against a creature other than you, you can use your reaction to make one melee weapon attack against the attacking creature. Other creatures provoke an opportunity attack from you when they enter your reach.");
    expect(both.map(r => [r.id, r.on])).toEqual([["r", "allyTargeted"], ["r.1", "foeApproaches"]]);
  });
});

describe("the pieces", () => {
  test("its parts, its moment, its response", () => {
    expect(triggerParts("Trigger: An attack roll hits the monster. Response: The monster uses Teleport.")).toEqual([{ trigger: "An attack roll hits the monster.", response: "The monster uses Teleport." }]);
    expect(momentOf("When a creature within 5 feet of you casts a spell")).toEqual({ on: "foeCasts", range: 5 });
    expect(momentOf("hit by a ranged attack roll")).toEqual({ on: "hit", ranged: true });
    expect(responseOf("to impose disadvantage on the attack roll.")).toEqual({ ac: 5 });
  });

  test("dnd5e's lookups filled from the activity they name, the item's name from the item, the creature's left to plainText", () => {
    const act = { activation: { condition: "hit by a melee attack roll while holding a weapon" }, roll: { formula: "2" } };
    const item = { name: "Parry", system: { activities: { get: id => (id === "aLG3" ? act : null) } } };
    expect(filledLookups("Trigger: The [[lookup @name lowercase]]{monster} is [[lookup @activation.condition activity=aLG3]]. Response: adds [[lookup @roll.formula activity=aLG3]] to its AC. Its [[lookup @item.name]].", item))
      .toBe("Trigger: The [[lookup @name lowercase]]{monster} is hit by a melee attack roll while holding a weapon. Response: adds 2 to its AC. Its Parry.");
  });
});

describe("read from a sheet (the adapter)", () => {
  const listOf = list => Object.assign(list, { get: id => list.find(i => i.id === id), getName: name => list.find(i => i.name === name) });
  const actorOf = items => ({
    id: "actor", uuid: "Actor.actor", documentName: "Actor", type: "npc", name: "Captain", img: "", flags: {}, statuses: new Set(), appliedEffects: [], classes: {},
    items: listOf(items), getRollData: () => ({}), toObject() { return { name: this.name }; },
    system: {
      abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(k => [k, { value: 10, mod: 0, save: { value: 0 } }])),
      attributes: { hp: { value: 52, max: 52, temp: 0 }, ac: { value: 15 }, movement: { walk: 30, units: "ft" }, senses: {}, death: {}, prof: 2 },
      details: { cr: 2, level: 1, type: { value: "humanoid" } },
      skills: {}, traits: { size: "med", languages: { value: new Set() }, di: {}, dr: {}, dv: {}, ci: {} }, resources: {}, currency: {}, spells: {}
    }
  });
  beforeEach(() => { globalThis.Roll = { replaceFormulaData: f => String(f) }; });
  afterEach(() => { delete globalThis.Roll; });

  test("a 2024 bandit captain's Parry, its AC its activity's roll formula; a creature's Parry without superiority dice no longer skipped", async () => {
    const act = { id: "aLG3", type: "utility", activation: { type: "reaction", condition: "hit by a melee attack roll while holding a weapon" }, roll: { formula: "2" }, effects: [], range: {}, target: {} };
    const parry = { id: "parry", type: "feat", name: "Parry", identifier: "parry", flags: {}, effects: listOf([]),
      system: { identifier: "parry", activities: Object.assign([act], { get: id => (id === "aLG3" ? act : null) }), description: {
        value: "<p>Trigger: The [[lookup @name lowercase]]{monster} is [[lookup @activation.condition activity=aLG3]]. Response: The [[lookup @name lowercase]]{monster} adds [[lookup @roll.formula activity=aLG3]] to its AC against that attack, possibly causing it to miss.</p>" } } };
    const spec = await new Dnd5eAdapter().toCombatantSpec({ id: "token", name: "Captain", actor: actorOf([parry]) });
    expect(spec.reactions).toEqual([{ id: "actor.parry", label: "Parry", on: "hit", melee: true, ac: 2 }]);
  });

  test("its roll's formula with the creature's numbers (a book's \"@prof\" to its AC)", async () => {
    const act = { id: "p", type: "utility", activation: { type: "reaction", condition: "hit by a melee attack roll while holding a weapon" }, roll: { formula: "@prof" }, effects: [], range: {}, target: {} };
    const parry = { id: "parry", type: "feat", name: "Parry", identifier: "parry", flags: {}, effects: listOf([]),
      system: { identifier: "parry", activities: Object.assign([act], { get: id => (id === "p" ? act : null) }), description: {
        value: "<p>Trigger: The [[lookup @name lowercase]] is [[lookup @activation.condition activity=p]]. Response: The [[lookup @name lowercase]] adds [[lookup @prof]] to its AC against that attack.</p>" } } };
    const actor = actorOf([parry]);
    actor.getRollData = () => ({ prof: 3 });
    globalThis.Roll = { replaceFormulaData: (f, data) => String(f).replace(/@prof/g, String(data.prof)) };
    const spec = await new Dnd5eAdapter().toCombatantSpec({ id: "token", name: "Captain", actor });
    expect(spec.reactions).toEqual([{ id: "actor.parry", label: "Parry", on: "hit", melee: true, ac: 3 }]);
  });
});
