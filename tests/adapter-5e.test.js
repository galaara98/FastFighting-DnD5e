/**
 * The adapter reading a sheet as Foundry's dnd5e prepares one: who could steal, Relentless Endurance, and dnd5e's own
 * difficult terrain.
 */
import { describe, expect, test } from "vitest";
import { Dnd5eAdapter } from "../scripts/adapter.js";

const listOf = list => Object.assign(list, { get: id => list.find(i => i.id === id), getName: name => list.find(i => i.name === name) });
const item = (type, identifier, name, system = {}) => ({ id: identifier, type, name, identifier, flags: {}, effects: [], system: { identifier, activities: [], ...system } });
/** An actor as Foundry's dnd5e prepares one, with only what these tests look at. */
function actorOf({ id = "actor", type = "npc", creature = "humanoid", int = 10, hp = 20, items = [], details = {}, owners = [], rollData = null } = {}) {
  return {
    id, uuid: `Actor.${id}`, type, name: id, img: "", flags: {}, statuses: new Set(), appliedEffects: [], classes: {},
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

describe("Relentless Endurance", () => {
  const relentless = spent => item("feat", "relentless-endurance", "Relentless Endurance", { uses: { max: 1, spent } });

  test("by its identifier: it holds on at 1 hit point with no save to make, while it has its use (a pool, for Make it So to spend)", async () => {
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

