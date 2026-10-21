/**
 * Immunities, resistances and vulnerabilities as dnd5e applies them: what gets through a trait (its bypasses: magical,
 * adamantine, silvered), a damage modification, and adamantine armor's turning a critical hit into a normal one.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { dnd5eRules } from "../scripts/rules.js";
import { Dnd5eAdapter, struckWith } from "../scripts/adapter.js";
import { iwrContext } from "../../FastFighting/scripts/engine/behavior/evaluate.js";

// (A gargoyle's, 2014: resistance to bludgeoning, piercing and slashing from nonmagical attacks that aren't adamantine.)
const gargoyle = { immune: ["poison"], weak: {}, resist: { bludgeoning: 1, piercing: 1, slashing: 1 }, bypass: { immune: [], resist: ["ada", "mgc"], weak: [], reduce: [] } };
// (An ice devil's: ... that aren't silvered; and resistance to cold, whatever deals it.)
const iceDevil = { immune: ["fire", "poison"], weak: {}, resist: { bludgeoning: 1, piercing: 1, slashing: 1, cold: 1 }, bypass: { resist: ["mgc", "sil"] } };
const sword = materials => ({ kind: "strike", materials });

describe("rules.applyIwr", () => {
  test("a plain sword is resisted; a magic one, an adamantine one gets through", () => {
    expect(dnd5eRules.applyIwr(gargoyle, { slashing: 11 }, null, iwrContext(sword([])))).toBe(5);
    expect(dnd5eRules.applyIwr(gargoyle, { slashing: 11 }, null, iwrContext(sword(["mgc"])))).toBe(11);
    expect(dnd5eRules.applyIwr(gargoyle, { slashing: 11 }, null, iwrContext(sword(["ada"])))).toBe(11);
    // (Silvered is nothing to a gargoyle.)
    expect(dnd5eRules.applyIwr(gargoyle, { slashing: 11 }, null, iwrContext(sword(["sil"])))).toBe(5);
  });

  test("a spell's piercing is magical; a bypass is only for physical damage (the ice devil still resists a magic sword's cold)", () => {
    const iceKnife = { kind: "save", rank: 1, damage: [] };
    expect(dnd5eRules.applyIwr(gargoyle, { piercing: 10 }, null, iwrContext(iceKnife))).toBe(10);
    expect(dnd5eRules.applyIwr(iceDevil, { slashing: 9, cold: 9 }, null, iwrContext(sword(["mgc"])))).toBe(9 + 4);
    expect(dnd5eRules.applyIwr(iceDevil, { piercing: 9 }, null, iwrContext(sword(["sil"])))).toBe(9);
    expect(dnd5eRules.applyIwr(iceDevil, { fire: 20, piercing: 9 }, null, iwrContext(sword([])))).toBe(4);
  });

  test("with nothing said of what deals it (a fire's, a fall's): every trait counts", () => {
    expect(dnd5eRules.applyIwr(gargoyle, { bludgeoning: 7, poison: 5 })).toBe(3);
  });

  test("a damage modification first (Heavy Armor Master's 3 off nonmagical blows), then resistance; never below nothing", () => {
    const armored = { immune: [], weak: {}, resist: {}, reduce: { bludgeoning: -3, piercing: -3, slashing: -3 }, bypass: { reduce: ["mgc"] } };
    expect(dnd5eRules.applyIwr(armored, { slashing: 8 }, null, iwrContext(sword([])))).toBe(5);
    expect(dnd5eRules.applyIwr(armored, { slashing: 2 }, null, iwrContext(sword([])))).toBe(0);
    expect(dnd5eRules.applyIwr(armored, { slashing: 8 }, null, iwrContext(sword(["mgc"])))).toBe(8);
    expect(dnd5eRules.applyIwr({ ...armored, resist: { slashing: 1 } }, { slashing: 9 }, null, iwrContext(sword([])))).toBe(3);
  });
});

describe("read from a sheet", () => {
  const listOf = list => Object.assign(list, { get: id => list.find(i => i.id === id), getName: name => list.find(i => i.name === name) });
  const actorOf = ({ type = "npc", items = [], traits = {} } = {}) => ({
    id: "actor", uuid: "Actor.actor", documentName: "Actor", type, name: "Gargoyle", img: "", flags: {}, statuses: new Set(), appliedEffects: [], classes: {},
    items: listOf(items), getRollData: () => ({ prof: 3 }), toObject() { return { name: this.name }; },
    system: {
      abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(k => [k, { value: 10, mod: 0, save: { value: 0 } }])),
      attributes: { hp: { value: 52, max: 52, temp: 0 }, ac: { value: 15 }, movement: { walk: 30, units: "ft" }, senses: {}, death: {} },
      details: { cr: 2, level: 1, type: { value: "elemental" } },
      skills: {}, traits: { size: "med", languages: { value: new Set() }, di: {}, dr: {}, dv: {}, ci: {}, ...traits }, resources: {}, currency: {}, spells: {}
    }
  });
  const armor = (properties, equipped = true) => ({ id: "armor", type: "equipment", name: "Adamantine Breastplate", flags: {}, effects: listOf([]),
    system: { identifier: "adamantine-breastplate", type: { value: "medium" }, equipped, properties: new Set(properties), activities: [] } });
  const specOf = actor => new Dnd5eAdapter().toCombatantSpec({ id: "token", name: actor.name, actor });

  beforeEach(() => { globalThis.Roll = { replaceFormulaData: (f, data) => String(f).replace(/@prof/g, String(data.prof)) }; });
  afterEach(() => { delete globalThis.Roll; });

  test("its traits' bypasses, and a damage modification with the actor's numbers", async () => {
    const spec = await specOf(actorOf({ traits: {
      di: { value: new Set(["poison"]), bypasses: new Set() }, dr: { value: new Set(["bludgeoning", "piercing", "slashing"]), bypasses: new Set(["ada", "mgc"]) },
      dm: { amount: { fire: "-@prof" }, bypasses: new Set() }
    } }));
    expect(spec.iwr).toMatchObject({ immune: ["poison"], resist: { bludgeoning: 1, piercing: 1, slashing: 1 }, reduce: { fire: -3 }, bypass: { resist: ["ada", "mgc"], immune: [] } });
  });

  test("adamantine armor it wears turns critical hits into normal ones (a character's, only when equipped)", async () => {
    expect((await specOf(actorOf({ items: [armor(["ada", "mgc"])] }))).critImmune).toBe(true);
    expect(dnd5eRules.critImmune({ spec: { critImmune: true } })).toBe(true);
    expect(dnd5eRules.critImmune({ spec: {} })).toBe(false);
    expect((await specOf(actorOf({ type: "character", items: [armor(["ada"], false)] }))).critImmune).toBeUndefined();
    expect((await specOf(actorOf({ items: [armor(["mgc"])] }))).critImmune).toBeUndefined();
  });

  test("what an item's blow is: its own magical, adamantine and silvered properties, and magical with a bonus", () => {
    const weapon = (properties, magicalBonus = null) => ({ system: { properties: new Set(properties), magicalBonus } });
    expect(struckWith(weapon(["fin", "sil"]))).toEqual(["sil"]);
    expect(struckWith(weapon(["mgc", "ada", "hvy"]))).toEqual(["ada", "mgc"]);
    expect(struckWith(weapon([], 1))).toEqual(["mgc"]);
    expect(struckWith(weapon(["fin"]))).toEqual([]);
  });
});
