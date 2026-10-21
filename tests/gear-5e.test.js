/**
 * What a 5e character's gear means for the core: the arrows and bolts its bows and crossbows shoot (the core's ammo, a
 * pool by kind), a Loading weapon's one shot an action (none of Extra Attack's, unless a Crossbow Expert), and a potion
 * it may give a friend (the core's administer).
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Dnd5eAdapter } from "../scripts/adapter.js";

const listOf = list => Object.assign(list, { get: id => list.find(i => i.id === id), getName: name => list.find(i => i.name === name) });
function actorOf({ type = "character", items = [], level = 5 } = {}) {
  return {
    id: "actor", uuid: "Actor.actor", type, name: "Archer", img: "", flags: {}, statuses: new Set(), appliedEffects: [], classes: {},
    items: listOf(items), getRollData: () => ({}), toObject() { return { name: this.name }; },
    system: {
      abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(k => [k, { value: 10, mod: 0, save: 0 }])),
      attributes: { hp: { value: 40, max: 40, temp: 0 }, ac: { value: 15 }, movement: { walk: 30, units: "ft" }, senses: {}, death: {} },
      details: { cr: 1, level, type: { value: "humanoid" } },
      skills: {}, traits: { size: "med", languages: { value: new Set() }, di: {}, dr: {}, dv: {}, ci: {} }, resources: {}, currency: {}, spells: {}
    }
  };
}
const attackAct = (damage, type) => ({
  id: "attack", type: "attack", activation: { type: "action" }, attack: { type: { value: "ranged" } }, labels: { modifier: "+7" },
  damage: { parts: [{}] }, effects: [], range: { value: 80, long: 320, units: "ft" }, target: {},
  getDamageConfig: () => ({ rolls: [{ parts: [damage], options: { types: [type] } }] })
});
const weapon = (id, name, { properties, ammunition, kind = "martialR" }) => ({
  id, type: "weapon", name, identifier: id, flags: {}, effects: [],
  system: { identifier: id, activities: [attackAct("1d8 + 3", "piercing")], type: { value: kind, baseItem: id }, properties: new Set(properties), ammunition: { type: ammunition }, equipped: true, range: { value: 80, long: 320, units: "ft" } }
});
const ammo = (id, name, subtype, quantity) => ({ id, type: "consumable", name, identifier: id, flags: {}, effects: [], system: { identifier: id, activities: [], type: { value: "ammo", subtype }, quantity } });
const feat = (identifier, name) => ({ id: identifier, type: "feat", name, identifier, flags: {}, effects: listOf([]), system: { identifier, activities: [], description: { value: "" } } });
const longbow = () => weapon("longbow", "Longbow", { properties: ["amm", "hvy", "two"], ammunition: "arrow" });
const crossbow = () => weapon("light-crossbow", "Light Crossbow", { properties: ["amm", "lod", "two"], ammunition: "crossbowBolt", kind: "simpleR" });
const specOf = actor => new Dnd5eAdapter().toCombatantSpec({ id: "token", name: actor.name, actor });

beforeEach(() => { globalThis.Roll = { replaceFormulaData: f => String(f) }; });
afterEach(() => { delete globalThis.Roll; });

describe("ammunition", () => {
  test("a bow shoots from its kind of ammunition, every stack of it counted; a crossbow from bolts", async () => {
    const spec = await specOf(actorOf({ items: [longbow(), crossbow(), ammo("arrows", "Arrows", "arrow", 20), ammo("more", "Arrows", "arrow", 7), ammo("bolts", "Crossbow Bolts", "crossbowBolt", 12)] }));
    const bow = spec.actions.find(a => a.itemId === "longbow" && !a.sequence);
    expect(bow.ammo).toBe("ammo:arrow");
    expect(spec.actions.find(a => a.itemId === "light-crossbow").ammo).toBe("ammo:crossbowBolt");
    expect(spec.resources).toMatchObject({ "ammo:arrow": 27, "ammo:crossbowBolt": 12 });
    expect(spec.resourceNames).toMatchObject({ "ammo:arrow": "Arrows", "ammo:crossbowBolt": "Crossbow Bolts" });
    expect(spec.actions.some(a => "ammoPool" in a || (a.sequence ?? []).some(s => "ammoPool" in s))).toBe(false);
  });

  test("none counted for a creature's bow, nor a character's with none on its sheet", async () => {
    expect((await specOf(actorOf({ type: "npc", items: [longbow(), ammo("arrows", "Arrows", "arrow", 20)] }))).actions.find(a => a.itemId === "longbow").ammo).toBeUndefined();
    const bare = await specOf(actorOf({ items: [longbow()] }));
    expect(bare.actions.find(a => a.itemId === "longbow").ammo).toBeUndefined();
    expect(Object.keys(bare.resources).some(k => k.startsWith("ammo:"))).toBe(false);
  });
});

describe("Loading", () => {
  test("Extra Attack's two shots with a bow, but not with a Loading crossbow; a Crossbow Expert's, both", async () => {
    const items = () => [feat("extra-attack", "Extra Attack"), longbow(), crossbow(), ammo("arrows", "Arrows", "arrow", 20), ammo("bolts", "Bolts", "crossbowBolt", 20)];
    const plain = await specOf(actorOf({ items: items() }));
    const extra = id => plain.actions.find(a => a.itemId === id && a.sequence);
    expect(extra("longbow").sequence).toHaveLength(2);
    expect(extra("light-crossbow")).toBeUndefined();
    const expert = await specOf(actorOf({ items: [...items(), feat("crossbow-expert", "Crossbow Expert")] }));
    expect(expert.actions.find(a => a.itemId === "light-crossbow" && a.sequence)?.sequence).toHaveLength(2);
  });
});

describe("potions", () => {
  test("a potion of healing is drunk, or given to a friend within reach; a feature's heal on itself isn't given", async () => {
    const heal = { id: "heal", type: "heal", activation: { type: "bonus" }, effects: [], range: { units: "self" }, target: {}, healing: {},
      getDamageConfig: () => ({ rolls: [{ parts: ["2d4 + 2"], options: { types: ["healing"] } }] }) };
    const potion = { id: "potion", type: "consumable", name: "Potion of Healing", identifier: "potion-of-healing", flags: {}, effects: listOf([]), system: { identifier: "potion-of-healing", activities: [heal], type: { value: "potion" }, quantity: 2, uses: { max: 1, spent: 0 }, description: { value: "" } } };
    const drink = (await specOf(actorOf({ items: [potion] }))).actions.find(a => a.itemId === "potion");
    expect(drink).toMatchObject({ kind: "heal", selfOnly: true, administer: true });
    const wind = { id: "second-wind", type: "feat", name: "Second Wind", identifier: "second-wind", flags: {}, effects: listOf([]), system: { identifier: "second-wind", activities: [{ ...heal, id: "wind" }], uses: { max: 1, spent: 0 }, description: { value: "" } } };
    expect((await specOf(actorOf({ items: [wind] }))).actions.find(a => a.itemId === "second-wind")?.administer).toBeUndefined();
  });
});
