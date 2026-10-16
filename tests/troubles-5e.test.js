/**
 * What lasts on a creature in 5e, as the core's own conditions and afflictions play it (its engine/conditions.js
 * PROFILES and behavior/afflictions.js): 2024's Contagion as a tallied affliction (three successes or three failures).
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, prepareBattle, endOfTurn } from "../../FastFighting/scripts/engine/simulator.js";
import { Dnd5eAdapter, tallyFrom, tallied, plainText } from "../scripts/adapter.js";
import { dnd5eRules } from "../scripts/rules.js";
import { parseFormula } from "../scripts/core.js";

/** Foundry's Roll.replaceFormulaData, as far as these tests need it. */
const replaceFormulaData = (formula, data) => String(formula).replace(/@([a-z.0-9_-]+)/gi, (m, term) => String(term.split(".").reduce((o, k) => o?.[k], data) ?? 0));
const listOf = list => Object.assign(list, { get: id => list.find(i => i.id === id), getName: name => list.find(i => i.name === name) });

/** An actor as dnd5e prepares one, with only what these tests look at. */
function actorOf({ type = "npc", creature = "humanoid", cr = 5, size = "med", items = [], spells = {} } = {}) {
  return {
    id: "actor", uuid: "Actor.actor", type, name: "actor", img: "", flags: {}, statuses: new Set(), appliedEffects: [], classes: {},
    items: listOf(items), getRollData: () => ({}), toObject() { return { name: this.name }; },
    system: {
      abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(k => [k, { value: 10, mod: 0, save: 0 }])),
      attributes: { hp: { value: 60, max: 60, temp: 0 }, ac: { value: 12 }, movement: { walk: 30, units: "ft" }, senses: {}, death: {}, spell: { dc: 15 } },
      details: { cr, level: cr, type: { value: creature } },
      skills: { ath: { total: 2, passive: 12 }, acr: { total: 0, passive: 10 }, ste: { total: 1 }, prc: { total: 1, passive: 11 }, ins: { total: 1, passive: 11 } },
      traits: { size, languages: { value: new Set() }, di: {}, dr: {}, dv: {}, ci: {} },
      resources: {}, currency: {}, spells
    }
  };
}
const specOf = actor => new Dnd5eAdapter().toCombatantSpec({ id: "token", name: actor.name, actor });
/** An effect as dnd5e keeps one on an item. */
const effectOf = (id, name, statuses = []) => ({ id, _id: id, name, statuses: new Set(statuses), changes: [], duration: {} });
/** An item with these activities and effects, its words its description. */
const itemOf = (type, identifier, name, { activities = [], effects = [], words = "", system = {} } = {}) => ({
  id: identifier, type, name, identifier, uuid: `Item.${identifier}`, flags: {}, effects: listOf(effects),
  system: { identifier, activities, description: { value: words }, uses: {}, range: {}, duration: {}, properties: new Set(), ...system }
});
const rollsOf = (formula, type) => () => ({ rolls: formula ? [{ parts: [formula], options: { types: [type] } }] : [] });

beforeEach(() => { globalThis.Roll = { replaceFormulaData }; });
afterEach(() => { delete globalThis.Roll; });

/* In the engine ------------------------------------------------------------ */

const at = x => ({ position: { x, y: 0, size: 5 } });
const fist = id => ({ id: `${id}.fist`, name: "Fist", kind: "strike", bonus: 2, melee: true, reach: 5, damage: [parseFormula("1d4", "bludgeoning")], hands: 0 });
const fighter = (id, side, x, over = {}) => ({
  id, name: id, side, kind: "npc", level: 5, size: 2, hp: { value: 80, max: 80, temp: 0 }, defenses: { ac: 15, str: 2, dex: 2, con: 2, int: 0, wis: 0, cha: 0 },
  initiative: { mod: 2 }, speeds: { walk: 30 }, iwr: { immune: [] }, flags: { fearless: true }, diesAtZero: false,
  actions: [fist(id)],
  traits: { tactical: { base: 70, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } },
  escapeWork: { mod: 2, ath: 2, acr: 0, str: 1, dex: 0 }, escapeDC: 13, ...at(x), ...over
});
const saves = n => ({ ac: 15, str: n, dex: n, con: n, int: n, wis: n, cha: n });

function fight(list, seed = 3) {
  const battle = { combatants: list, sides: { friendly: { label: "Party", enemies: ["hostile"] }, hostile: { label: "Foes", enemies: ["friendly"] } }, options: { positioning: true, opening: "fight", maxRounds: 6 } };
  const run = beginRun(prepareBattle(battle, dnd5eRules), seed, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}

/* Contagion ----------------------------------------------------------------- */

/* The SRD 5.2's words (CC-BY 4.0), as dnd5e's compendium keeps them. */
const CONTAGION_2024 = "<p>Your touch inflicts a magical contagion. The target must succeed on a Constitution saving throw or take 11d8 Necrotic damage and have the &amp;Reference[Poisoned apply=false] condition. Also, choose one ability when you cast the spell. While Poisoned, the target has Disadvantage on saving throws made with the chosen ability.</p><p>The target must repeat the saving throw at the end of each of its turns until it gets three successes or failures. If the target succeeds on three of these saves, the spell ends on the target. If the target fails three of the saves, the spell lasts for 7 days on it.</p>";

/** 2024's Contagion as dnd5e has it: a Constitution save against the spell DC, 11d8 necrotic, an Infected effect for each ability (Poisoned). */
function contagion() {
  const infected = ["str", "dex", "con", "int", "wis", "cha"].map(k => effectOf(`infected-${k}`, `Infected (${k})`, ["poisoned"]));
  const save = { id: "cast", type: "save", activation: { type: "action" }, save: { ability: new Set(["con"]), dc: { value: 15 } }, damage: { onSave: "half", parts: [{}] },
    effects: infected.map(e => ({ _id: e.id })), range: {}, target: {}, getDamageConfig: rollsOf("11d8", "necrotic") };
  return itemOf("spell", "contagion", "Contagion", { activities: [save], effects: infected, words: CONTAGION_2024,
    system: { level: 5, activation: { type: "action" }, range: { units: "touch" }, duration: { value: 7, units: "day" }, properties: new Set(["vocal", "somatic"]) } });
}

describe("Contagion (the SRD 5.2's): a tallied affliction", () => {
  test("its words: three successes or three failures", () => {
    expect(tallyFrom(plainText(CONTAGION_2024))).toEqual({ cure: 3, keep: 3 });
    expect(tallyFrom(plainText("<p>At the end of each of its turns, the target can make another Wisdom saving throw. On a success, the spell ends on the target.</p>"))).toBeNull();
  });

  test("the spell: its damage, and on a failed save the core's affliction, Poisoned, its Constitution saves at Disadvantage while it lasts", async () => {
    const [cast] = (await specOf(actorOf({ items: [contagion()], spells: { spell5: { value: 1, max: 1 } } }))).actions.filter(a => a.itemId === "contagion");
    expect(cast).toMatchObject({ kind: "save", save: { type: "con", dc: 15, basic: true } });
    expect(cast.damage).toEqual([expect.objectContaining({ dice: [{ n: 11, faces: 8 }], type: "necrotic" })]);
    expect(cast.effects).toHaveLength(1);
    const [rider] = cast.effects;
    expect(rider).toMatchObject({ kind: "affliction", name: "Contagion", save: { type: "con", dc: 15 }, tally: { cure: 3, keep: 3 }, simple: { key: "poisoned" }, traits: ["poisoned"], weakSave: "con" });
    expect(rider.stages).toEqual([{ conditions: { poisoned: 1 }, damage: [], duration: 1 }]);
    // (No single save that shakes it off: the tally does.)
    expect(rider.repeatSave).toBeUndefined();
  });

  test("tallied() lays nothing without a tally or a condition", () => {
    expect(tallied({ id: "x", name: "x", conditions: { poisoned: 1 }, save: { type: "con", dc: 12 }, tally: null })).toBeNull();
    expect(tallied({ id: "x", name: "x", conditions: {}, save: { type: "con", dc: 12 }, tally: { cure: 3, keep: 3 } })).toBeNull();
  });

  const castAt = async target => {
    const [cast] = (await specOf(actorOf({ items: [contagion()], spells: { spell5: { value: 1, max: 1 } } }))).actions.filter(a => a.itemId === "contagion");
    const run = fight([fighter("cleric", "hostile", 0, { actions: [{ ...cast, reach: 5 }], resources: { "slots:5": 1 } }), target]);
    takeTurn(run, run.byId.get("cleric"));
    return run;
  };

  test("in the engine: a failed save takes hold (no second roll decides it), three failed saves after settle it for the fight", async () => {
    const run = await castAt(fighter("hero", "friendly", 5, { defenses: saves(-30) }));
    const hero = run.byId.get("hero");
    expect(run.log.find(e => e.type === "save" && e.actorId === "cleric")?.degree).toBeLessThan(2);
    expect(hero.afflictions).toHaveLength(1);
    expect(hero.conds.poisoned).toBe(1);
    // (Its Constitution saves at Disadvantage while it lasts; its others not.)
    expect(dnd5eRules.modifiers.save({ unit: hero, type: "con" }).advantage).toBe(-1);
    expect(dnd5eRules.modifiers.save({ unit: hero, type: "wis" }).advantage).toBe(0);
    for ( let i = 0; i < 3; i++ ) endOfTurn(run, hero);
    expect(run.log.filter(e => e.type === "afflictionSave" && e.tally).map(e => e.tally)).toEqual([{ cured: 0, kept: 1 }, { cured: 0, kept: 2 }]);
    expect(run.log.find(e => e.type === "afflictionSettles")).toMatchObject({ name: "Contagion" });
    endOfTurn(run, hero);
    expect(hero.conds.poisoned).toBe(1);
  });

  test("three saves made end it, and Poisoned with it", async () => {
    const run = await castAt(fighter("hero", "friendly", 5, { defenses: saves(-30) }));
    const hero = run.byId.get("hero");
    hero.spec.defenses = saves(50);
    for ( let i = 0; i < 3; i++ ) endOfTurn(run, hero);
    expect(run.log.find(e => e.type === "afflictionEnd")).toMatchObject({ name: "Contagion" });
    expect(hero.afflictions).toHaveLength(0);
    expect(hero.conds.poisoned ?? 0).toBe(0);
  });

  test("one immune to being Poisoned takes the damage, not the affliction", async () => {
    const run = await castAt(fighter("hero", "friendly", 5, { defenses: saves(-30), iwr: { immune: ["poisoned"] } }));
    const hero = run.byId.get("hero");
    expect(hero.hp).toBeLessThan(80);
    expect(hero.afflictions).toHaveLength(0);
  });
});
