/**
 * Smaller things a 5e sheet tells the core: a creature blind beyond its blindsight, a swarm sharing others' spaces,
 * one that talks with anyone (every language, telepathy).
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Dnd5eAdapter } from "../scripts/adapter.js";
import { talksWithAnyone } from "../scripts/auto.js";
import { dnd5eRules } from "../scripts/rules.js";
import { STATUS } from "../scripts/core.js";

const listOf = list => Object.assign(list, { get: id => list.find(i => i.id === id), getName: name => list.find(i => i.name === name) });
function actorOf({ senses = {}, type = {}, languages = { value: new Set() } } = {}) {
  return {
    id: "actor", uuid: "Actor.actor", documentName: "Actor", type: "npc", name: "Ooze", img: "", flags: {}, statuses: new Set(), appliedEffects: [], classes: {},
    items: listOf([]), getRollData: () => ({}), toObject() { return { name: this.name }; },
    system: {
      abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(k => [k, { value: 10, mod: 0, save: { value: 0 } }])),
      attributes: { hp: { value: 22, max: 22, temp: 0 }, ac: { value: 8 }, movement: { walk: 10, units: "ft" }, senses, death: {} },
      details: { cr: 1, level: 1, type: { value: "ooze", ...type } },
      skills: {}, traits: { size: "med", languages, di: {}, dr: {}, dv: {}, ci: {} }, resources: {}, currency: {}, spells: {}
    }
  };
}
const specOf = actor => new Dnd5eAdapter().toCombatantSpec({ id: "token", name: actor.name, actor });

beforeEach(() => { globalThis.Roll = { replaceFormulaData: f => String(f) }; });
afterEach(() => { delete globalThis.Roll; });

describe("senses", () => {
  test("a 2014 gray ooze, blind beyond its blindsight: no sight at all; 2024's says nothing of it", async () => {
    expect((await specOf(actorOf({ senses: { darkvision: 0, blindsight: 60, units: "ft", special: "Blind beyond this radius" } }))).senses).toEqual({ feel: 60, sight: 0 });
    expect((await specOf(actorOf({ senses: { units: null, special: "", ranges: { blindsight: 60 } } }))).senses).toEqual({ feel: 60 });
    // (Words of blindness with no blindsight to see by: the sheet's, not this.)
    expect((await specOf(actorOf({ senses: { special: "blind beyond this radius" } }))).senses).toEqual({});
  });
});

describe("swarms", () => {
  test("a swarm by dnd5e's swarm size; it ends its move in another's space, another in its, and passes through anyone", async () => {
    expect((await specOf(actorOf({ type: { value: "beast", swarm: "tiny" } }))).swarm).toBe(true);
    expect((await specOf(actorOf())).swarm).toBeUndefined();
    const unit = (spec, side = "hostile") => ({ spec: { size: 2, ...spec }, side, status: STATUS.STANDING, conds: {} });
    const rats = unit({ swarm: true });
    const knight = unit({}, "friendly");
    expect(dnd5eRules.endIn({}, rats, knight)).toBe(true);
    expect(dnd5eRules.endIn({}, knight, rats)).toBe(true);
    expect(dnd5eRules.endIn({}, knight, unit({}))).toBe(false);
    expect(dnd5eRules.passThrough({}, rats, knight)).toBe("difficult");
    expect(dnd5eRules.passThrough({}, knight, rats)).toBe("difficult");
    expect(dnd5eRules.passThrough({}, knight, unit({}))).toBe("around");
  });
});

describe("talking with anyone", () => {
  test("every language (2014's \"ALL\"; 2024's every standard and exotic one), or telepathy", async () => {
    expect(talksWithAnyone({ value: new Set(["ALL"]) })).toBe(true);
    expect(talksWithAnyone({ value: ["standard", "exotic"] })).toBe(true);
    expect(talksWithAnyone({ value: new Set(["common"]), communication: { telepathy: { value: 120, units: "ft" } } })).toBe(true);
    expect(talksWithAnyone({ value: new Set(["common", "celestial"]) })).toBe(false);
    expect(talksWithAnyone({ value: ["standard"] })).toBe(false);
    expect((await specOf(actorOf({ languages: { value: new Set(["ALL"]), custom: "" } }))).social.anyLanguage).toBe(true);
    expect((await specOf(actorOf())).social.anyLanguage).toBeUndefined();
  });
});
