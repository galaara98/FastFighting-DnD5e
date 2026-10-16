/**
 * 5e's maneuvers, as the core plays them (its maneuvers.js and behavior/forced.js): Shove (pushed 5 feet or knocked
 * prone, the shover's choice) and Grapple (the engine's grab), each on a failed Strength or Dexterity save against
 * 8 + Strength + proficiency, with no degrees beyond failing and passing; a creature's own grapple on a save; and a
 * fall off a ledge, 1d6 bludgeoning for each 10 feet (at most 20d6), landing prone.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, prepareBattle } from "../../FastFighting/scripts/engine/simulator.js";
import { withManeuver } from "../../FastFighting/scripts/engine/maneuvers.js";
import { holdsOf } from "../../FastFighting/scripts/engine/behavior/holds.js";
import { canMove } from "../../FastFighting/scripts/engine/battle-state.js";
import { Dnd5eAdapter } from "../scripts/adapter.js";
import { dnd5eRules } from "../scripts/rules.js";
import { parseFormula } from "../scripts/core.js";

/** Foundry's Roll.replaceFormulaData, as far as these tests need it. */
const replaceFormulaData = (formula, data) => String(formula).replace(/@([a-z.0-9_-]+)/gi, (m, term) => String(term.split(".").reduce((o, k) => o?.[k], data) ?? 0));
const listOf = list => Object.assign(list, { get: id => list.find(i => i.id === id), getName: name => list.find(i => i.name === name) });

/** An actor as dnd5e prepares one, with only what these tests look at. */
function actorOf({ type = "npc", creature = "humanoid", str = 0, cr = 1, size = "med", items = [] } = {}) {
  return {
    id: "actor", uuid: "Actor.actor", type, name: "actor", img: "", flags: {}, statuses: new Set(), appliedEffects: [], classes: {},
    items: listOf(items), getRollData: () => ({}), toObject() { return { name: this.name }; },
    system: {
      abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(k => [k, { value: 10, mod: k === "str" ? str : 0, save: 0 }])),
      attributes: { hp: { value: 20, max: 20, temp: 0 }, ac: { value: 12 }, movement: { walk: 30, units: "ft" }, senses: {}, death: {}, spell: { dc: 14 } },
      details: { cr, level: cr, type: { value: creature } },
      skills: { ath: { total: 2, passive: 12 }, acr: { total: 0, passive: 10 }, ste: { total: 1 }, prc: { total: 1, passive: 11 }, ins: { total: 1, passive: 11 } },
      traits: { size, languages: { value: new Set() }, di: {}, dr: {}, dv: {}, ci: {} },
      resources: {}, currency: {}, spells: {}
    }
  };
}
const specOf = actor => new Dnd5eAdapter().toCombatantSpec({ id: "token", name: actor.name, actor });
const optionsOf = async (over = {}) => {
  const actions = (await specOf(actorOf({ str: 3, ...over }))).actions;
  return Object.fromEntries(["shove", "shove-prone", "grapple"].map(k => [k, actions.find(a => a.id === `actor.${k}`)]));
};

beforeEach(() => { globalThis.Roll = { replaceFormulaData }; });
afterEach(() => { delete globalThis.Roll; });

describe("Shove and Grapple, as the adapter makes them", () => {
  test("the core's shove, trip and grapple, on a failed Strength or Dexterity save against 8 + Strength + proficiency", async () => {
    const o = await optionsOf();
    expect(Object.values(o).map(a => a.maneuver)).toEqual(["shove", "trip", "grapple"]);
    for ( const a of Object.values(o) ) {
      expect(a).toMatchObject({ kind: "control", melee: true, reach: 5, save: { type: ["str", "dex"], dc: 8 + 3 + 2, basic: false } });
      // (Only one at most a size larger: a Medium creature shoves a Large one, not a Huge one.)
      expect(a.maxSize).toBe(3);
    }
    const [failed, passed] = [o.shove.onSave[1], o.shove.onSave[2]];
    expect([failed, passed]).toEqual([{ move: { kind: "push", feet: 5 } }, null]);
    expect(o["shove-prone"].onSave[1]).toMatchObject({ conditions: { prone: 1 } });
    expect(o.grapple.onSave[1]).toMatchObject({ grab: true });
    expect(o.grapple.onSave[1].conditions).toBeUndefined();
  });

  test("5e's own outcomes, not the core's degrees: no farther shove, no harder grab, nothing lands on the shover", async () => {
    for ( const a of Object.values(await optionsOf()) ) {
      expect(withManeuver(a)).toBe(a);
      expect(a.onSave[0]).toBe(a.onSave[1]);
      expect([a.onSave[2], a.onSave[3]]).toEqual([null, null]);
      expect(a.onSave.some(x => x?.self)).toBe(false);
    }
  });

  test("a grapple takes a free hand, a shove none; a beast does neither", async () => {
    const o = await optionsOf();
    expect([o.shove.hands, o["shove-prone"].hands, o.grapple.hands]).toEqual([0, 0, 1]);
    const beast = (await specOf(actorOf({ creature: "beast" }))).actions;
    expect(beast.filter(a => a.maneuver)).toEqual([]);
  });

  test("too big, or immune to what it does: a Grappled-proof creature can still be shoved; a Prone-proof one can't be knocked down", async () => {
    const o = await optionsOf();
    const target = (immune = [], size = 2) => ({ spec: { size, iwr: { immune } } });
    expect(Object.values(o).map(a => dnd5eRules.isImmune(target(["grappled"]), a))).toEqual([false, false, true]);
    expect(Object.values(o).map(a => dnd5eRules.isImmune(target(["prone"]), a))).toEqual([false, true, false]);
    expect(Object.values(o).map(a => dnd5eRules.isImmune(target([], 4), a))).toEqual([true, true, true]);
  });
});

describe("a creature's own grapple on a save (the 2024 creatures' coils and grips)", () => {
  /** A feature with one save activity, its effect Grappled; with damage, or without. */
  const constrict = damage => {
    const save = { id: "save", type: "save", activation: { type: "action" }, save: { ability: new Set(["str"]), dc: { value: 14 } }, damage: { parts: [] }, effects: [{ _id: "grip" }], range: { value: 10, units: "ft" }, target: {},
      getDamageConfig: () => ({ rolls: damage ? [{ parts: [damage], options: { types: ["bludgeoning"] } }] : [] }) };
    const grip = { id: "grip", name: "Grip", statuses: new Set(["grappled"]), changes: [], duration: {} };
    return { id: "coils", type: "feat", name: "Coils", identifier: "coils", flags: {}, effects: listOf([grip]),
      system: { identifier: "coils", activities: [save], description: { value: "<p>It wraps around its prey.</p>" }, uses: {} } };
  };

  test("with damage: the damage, and the grab on a failure", async () => {
    const a = (await specOf(actorOf({ creature: "beast", items: [constrict("2d8 + 4")] }))).actions.find(x => x.itemId === "coils");
    expect(a.kind).toBe("save");
    expect(a.effects).toContainEqual({ kind: "grabbed" });
  });

  test("without: the core's grapple, the grab on a failure", async () => {
    const a = (await specOf(actorOf({ creature: "beast", items: [constrict(null)] }))).actions.find(x => x.itemId === "coils");
    expect(a).toMatchObject({ kind: "control", maneuver: "grapple", save: { type: "str", dc: 14 } });
    expect(a.onSave[1]).toMatchObject({ grab: true });
    expect(a.onSave[2]).toBeNull();
  });
});

describe("a fall", () => {
  test("1d6 bludgeoning for each 10 feet, at most 20d6; less than 10 feet, nothing; it lands prone", () => {
    expect(dnd5eRules.fallDamage(20)).toEqual([expect.objectContaining({ dice: [{ n: 2, faces: 6 }], flat: 0, type: "bludgeoning" })]);
    expect(dnd5eRules.fallDamage(35)[0].dice).toEqual([{ n: 3, faces: 6 }]);
    expect(dnd5eRules.fallDamage(500)[0].dice).toEqual([{ n: 20, faces: 6 }]);
    expect(dnd5eRules.fallDamage(5)).toEqual([]);
    expect(dnd5eRules.fallProne).toBe(true);
  });
});

/* In the engine ---------------------------------------------------------- */

const at = x => ({ position: { x, y: 0, size: 5 } });
const fist = id => ({ id: `${id}.fist`, name: "Fist", kind: "strike", bonus: 2, melee: true, reach: 5, damage: [parseFormula("1d4", "bludgeoning")], hands: 0 });
const fighter = (id, side, x, over = {}) => ({
  id, name: id, side, kind: "npc", level: 3, size: 2, hp: { value: 60, max: 60, temp: 0 }, defenses: { ac: 15, str: 2, dex: 2, con: 2, int: 0, wis: 0, cha: 0 },
  initiative: { mod: 2 }, speeds: { walk: 30 }, iwr: {}, flags: { fearless: true }, diesAtZero: false,
  actions: [fist(id)],
  traits: { tactical: { base: 70, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } },
  escapeWork: { mod: 2, ath: 2, acr: 0, str: 1, dex: 0 }, escapeDC: 13, ...at(x), ...over
});
/** One that never makes a Strength or Dexterity save against a shove. */
const clumsy = { defenses: { ac: 15, str: -30, dex: -30, con: 2, int: 0, wis: 0, cha: 0 } };
/** The ground drops away 20 feet from x = 10 on. */
const ledge = Array.from({ length: 6 }, (_, k) => [2 + k, 0, { g: -20 }]);

function fight(list, ground = null, seed = 3) {
  const battle = { combatants: list, sides: { friendly: { label: "Party", enemies: ["hostile"] }, hostile: { label: "Foes", enemies: ["friendly"] } }, options: { positioning: true, opening: "fight", maxRounds: 6 } };
  if ( ground ) battle.ground = { size: 5, cells: ground };
  const run = beginRun(prepareBattle(battle, dnd5eRules), seed, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}

describe("in the engine", () => {
  test("shoved by a drop: pushed off it, a fall of 20 feet (2d6 bludgeoning), and it lands prone", async () => {
    const { shove } = await optionsOf();
    const run = fight([fighter("hero", "friendly", 0, { actions: [fist("hero"), shove] }), fighter("orc", "hostile", 5, clumsy)], ledge);
    const orc = run.byId.get("orc");
    takeTurn(run, run.byId.get("hero"));
    expect(run.log.find(e => e.type === "control" && e.actorId === "hero")).toMatchObject({ maneuver: "shove", roll: "save", took: true });
    expect(run.log.find(e => e.type === "forced" && e.targetId === "orc")).toMatchObject({ how: "push", feet: 5, fall: 20 });
    const fell = run.log.find(e => e.type === "fall" && e.actorId === "orc");
    expect(fell.feet).toBe(20);
    expect(fell.amount).toBeGreaterThanOrEqual(2);
    expect(fell.amount).toBeLessThanOrEqual(12);
    expect(orc.hp).toBe(60 - fell.amount);
    expect(orc.prone).toBe(true);
  });

  test("shoved the other way: knocked prone where it stands", async () => {
    const run = fight([fighter("hero", "friendly", 0, { actions: [(await optionsOf())["shove-prone"]] }), fighter("orc", "hostile", 5, clumsy)]);
    const orc = run.byId.get("orc");
    takeTurn(run, run.byId.get("hero"));
    expect(run.log.find(e => e.type === "control" && e.actorId === "hero")).toMatchObject({ maneuver: "trip", took: true });
    expect(orc.prone).toBe(true);
    expect(orc.pos).toMatchObject({ x: 5, y: 0 });
  });

  test("grappled: held by the grappler, it can't move, and breaking free is against the grappler's escape DC", async () => {
    const run = fight([fighter("hero", "friendly", 0, { actions: [(await optionsOf()).grapple], escapeDC: 15 }), fighter("orc", "hostile", 5, clumsy)]);
    const orc = run.byId.get("orc");
    takeTurn(run, run.byId.get("hero"));
    expect(run.log.find(e => e.type === "control" && e.actorId === "hero")).toMatchObject({ maneuver: "grapple", took: true });
    expect(orc.grabbedBy).toBe("hero");
    expect(canMove(run, orc)).toBe(false);
    expect(holdsOf(run, orc)).toEqual([expect.objectContaining({ key: "grabbed", byId: "hero", dc: 15 })]);
  });

  test("both ways to shove on offer: by a drop it pushes; on flat ground, a friend beside the foe, it knocks the foe down", async () => {
    const o = await optionsOf();
    const chose = run => run.log.find(e => e.type === "control" && e.actorId === "hero")?.maneuver;
    const friend = fighter("friend", "friendly", 5, { position: { x: 5, y: 5, size: 5 }, actions: [{ ...fist("friend"), bonus: 6, damage: [parseFormula("2d6+4", "slashing")] }] });
    for ( const seed of [1, 2, 3, 4, 5] ) {
      const byTheDrop = fight([fighter("hero", "friendly", 0, { actions: [fist("hero"), o.shove, o["shove-prone"]] }), fighter("orc", "hostile", 5, clumsy)], ledge, seed);
      takeTurn(byTheDrop, byTheDrop.byId.get("hero"));
      expect([seed, chose(byTheDrop)]).toEqual([seed, "shove"]);
      const flat = fight([fighter("hero", "friendly", 0, { actions: [o.shove, o["shove-prone"]] }), fighter("orc", "hostile", 5, clumsy), friend], null, seed);
      takeTurn(flat, flat.byId.get("hero"));
      expect([seed, chose(flat)]).toEqual([seed, "trip"]);
    }
  });
});
