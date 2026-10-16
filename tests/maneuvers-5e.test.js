/**
 * 5e's maneuvers, as the core plays them (its maneuvers.js and behavior/forced.js): Shove (pushed 5 feet or knocked
 * prone, the shover's choice) and Grapple (the engine's grab), each on a failed Strength or Dexterity save against
 * 8 + Strength + proficiency, with no degrees beyond failing and passing; a creature's own grapple on a save; a fall off
 * a ledge, 1d6 bludgeoning for each 10 feet (at most 20d6), landing prone; and the spells and features that push
 * (FORCED_MOVES: Thunderwave and Gust of Wind on a failed save, Thunderous Smite's save on a hit, Repelling Blast on a
 * hit with the cantrip it works through, a few SRD creatures').
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, prepareBattle } from "../../FastFighting/scripts/engine/simulator.js";
import { withManeuver } from "../../FastFighting/scripts/engine/maneuvers.js";
import { holdsOf } from "../../FastFighting/scripts/engine/behavior/holds.js";
import { canMove } from "../../FastFighting/scripts/engine/battle-state.js";
import { Dnd5eAdapter, FORCED_MOVES, forcedMoveOf, masteryOf, PUSH_MASTERY } from "../scripts/adapter.js";
import { dnd5eRules } from "../scripts/rules.js";
import { parseFormula } from "../scripts/core.js";

/** Foundry's Roll.replaceFormulaData, as far as these tests need it. */
const replaceFormulaData = (formula, data) => String(formula).replace(/@([a-z.0-9_-]+)/gi, (m, term) => String(term.split(".").reduce((o, k) => o?.[k], data) ?? 0));
const listOf = list => Object.assign(list, { get: id => list.find(i => i.id === id), getName: name => list.find(i => i.name === name) });

/** An actor as dnd5e prepares one, with only what these tests look at. */
function actorOf({ type = "npc", creature = "humanoid", str = 0, cr = 1, size = "med", items = [], spells = {}, flags = {} } = {}) {
  return {
    id: "actor", uuid: "Actor.actor", type, name: "actor", img: "", flags, statuses: new Set(), appliedEffects: [], classes: {},
    items: listOf(items), getRollData: () => ({}), toObject() { return { name: this.name }; },
    system: {
      abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(k => [k, { value: 10, mod: k === "str" ? str : 0, save: 0 }])),
      attributes: { hp: { value: 20, max: 20, temp: 0 }, ac: { value: 12 }, movement: { walk: 30, units: "ft" }, senses: {}, death: {}, spell: { dc: 14 } },
      details: { cr, level: cr, type: { value: creature } },
      skills: { ath: { total: 2, passive: 12 }, acr: { total: 0, passive: 10 }, ste: { total: 1 }, prc: { total: 1, passive: 11 }, ins: { total: 1, passive: 11 } },
      traits: { size, languages: { value: new Set() }, di: {}, dr: {}, dv: {}, ci: {} },
      resources: {}, currency: {}, spells
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
    expect(dnd5eRules.fallProne(null, 4)).toBe(true);
    expect(dnd5eRules.fallProne(null, 0)).toBe(false);
  });
});

describe("getting past another creature", () => {
  test("an ally, one down or Incapacitated, a Tiny one or one two sizes off: through it, as Difficult Terrain; any other foe: round it", () => {
    const c = (side, size = 2, extra = {}) => ({ side, status: "standing", conds: {}, spec: { size }, ...extra });
    const me = c("friendly");
    expect(dnd5eRules.passThrough(null, me, c("friendly"))).toBe("difficult");
    expect(dnd5eRules.passThrough(null, me, c("hostile"))).toBe("around");
    expect(dnd5eRules.passThrough(null, me, c("hostile", 2, { status: "down" }))).toBe("difficult");
    expect(dnd5eRules.passThrough(null, me, c("hostile", 2, { conds: { incapacitated: 1 } }))).toBe("difficult");
    expect(dnd5eRules.passThrough(null, me, c("hostile", 0))).toBe("difficult");
    expect(dnd5eRules.passThrough(null, me, c("hostile", 4))).toBe("difficult");
    expect(dnd5eRules.passThrough(null, me, c("hostile", 3))).toBe("around");
  });

  test("a halfling's Nimbleness: through any creature larger than it, as Difficult Terrain; not one its own size or smaller", () => {
    const c = (side, size = 2, spec = {}) => ({ side, status: "standing", conds: {}, spec: { size, ...spec } });
    const halfling = c("friendly", 1, { throughLarger: true });
    expect(dnd5eRules.passThrough(null, halfling, c("hostile", 2))).toBe("difficult");
    expect(dnd5eRules.passThrough(null, c("friendly", 1), c("hostile", 2))).toBe("around");
    expect(dnd5eRules.passThrough(null, halfling, c("hostile", 1))).toBe("around");
    expect(dnd5eRules.passThrough(null, c("friendly", 2, { throughLarger: true }), c("hostile", 3))).toBe("difficult");
  });

  test("Nimbleness is read from the trait's identifier (2014 and 2024 alike), or the flag its effect sets", async () => {
    const trait = { id: "nimble", type: "feat", name: "Halfling Nimbleness", identifier: "halfling-nimbleness", flags: {}, effects: [], system: { identifier: "halfling-nimbleness", activities: [], description: { value: "" }, uses: {} } };
    expect((await specOf(actorOf({ size: "sm", items: [trait] }))).throughLarger).toBe(true);
    expect((await specOf(actorOf({ size: "sm", flags: { dnd5e: { halflingNimbleness: true } } }))).throughLarger).toBe(true);
    expect((await specOf(actorOf({ size: "sm" }))).throughLarger).toBeUndefined();
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

describe("cover from the walls, 5e's", () => {
  test("half cover (some of it hidden) +2 to AC and Dexterity saves, three-quarters (most) +5; the core's own none", () => {
    expect(dnd5eRules.handlesCover).toBe(true);
    expect(["none", "some", "most"].map(cover => dnd5eRules.modifiers.defense({ cover }))).toEqual([0, 2, 5]);
    const u = { conds: {}, spec: {} };
    expect(dnd5eRules.modifiers.save({ unit: u, type: "dex", cover: "most" }).bonus).toBe(5 + dnd5eRules.modifiers.save({ unit: u, type: "dex" }).bonus);
    expect(dnd5eRules.modifiers.save({ unit: u, type: "wis", cover: "most" }).bonus).toBe(dnd5eRules.modifiers.save({ unit: u, type: "wis" }).bonus);
  });
});

/* Pushes ------------------------------------------------------------------ */

/** A save activity as dnd5e 6 prepares one: its ability and DC, and its damage (a formula, or none); its area its item's. */
const saveAct = ({ id = "cast", name = "", ability = "con", dc = 13, damage = null, type = "thunder", activation = "action" } = {}) => ({
  id, name, type: "save", activation: { type: activation }, save: { ability: new Set([ability]), dc: { value: dc } },
  damage: { onSave: damage ? "half" : "none", parts: damage ? [{}] : [] }, effects: [], range: {},
  getDamageConfig: () => ({ rolls: damage ? [{ parts: [damage], options: { types: [type] } }] : [] })
});
/** An attack activity: a ranged one unless it says otherwise. */
const attackAct = ({ id = "attack", damage = "1d10", type = "force", melee = false } = {}) => ({
  id, type: "attack", activation: { type: "action" }, attack: { type: { value: melee ? "melee" : "ranged" } }, labels: { modifier: "+5" },
  damage: { parts: [{}] }, effects: [], range: {}, target: {},
  getDamageConfig: () => ({ rolls: [{ parts: [damage], options: { types: [type] } }] })
});
const utilityAct = (id, activation) => ({ id, type: "utility", activation: { type: activation }, effects: [], range: {}, target: {} });
/** A spell with these activities: from yourself, in a 15-foot cube, unless it says otherwise. */
const spellOf = (identifier, level, activities, system = {}, extra = {}) => ({
  id: identifier, type: "spell", name: identifier, identifier, flags: {}, effects: [], ...extra,
  system: {
    identifier, level, activities, activation: { type: "action" }, range: { units: "self" }, target: { template: { type: "cube", size: 15, units: "ft" } },
    properties: new Set(["vocal", "somatic"]), duration: { units: "inst" }, description: { value: "" }, ...system
  }
});
const featOf = (identifier, activities = [], description = "") => ({
  id: identifier, type: "feat", name: identifier, identifier, flags: {}, effects: [], system: { identifier, activities, description: { value: `<p>${description}</p>` }, uses: {} }
});
/** The actions an actor with these items makes of one of them. */
const actionsFrom = async (items, itemId, over = {}) => (await specOf(actorOf({ items, ...over }))).actions.filter(a => a.itemId === itemId);
const slots = { spells: { spell1: { value: 2, max: 2 } } };
const pushOf = feet => ({ kind: "move", move: { kind: "push", feet }, critOnly: false });
/** One that never makes a save. */
const frail = { defenses: { ac: 15, str: -30, dex: -30, con: -30, int: 0, wis: 0, cha: 0 } };
/** Thunderous Smite as the Player's Handbook's data has it (no words of its own here): its damage, and a Strength save. */
const smiteOf = () => spellOf("thunderous-smite", 1, [
  { id: "hit", type: "damage", activation: { type: "bonus" }, damage: { parts: [{ denomination: 6, scaling: { mode: "whole", number: 1 } }] },
    getDamageConfig: () => ({ rolls: [{ parts: ["2d6"], options: { types: ["thunder"] } }] }) },
  saveAct({ id: "push", ability: "str", activation: "" })
], { activation: { type: "bonus" } });

describe("what pushes, by identifier (FORCED_MOVES)", () => {
  test("each identifier: how far, and when", () => {
    expect(Object.keys(FORCED_MOVES)).toEqual(["thunderwave", "gust-of-wind", "thunderous-smite", "repelling-blast", "whirlwind", "repulsion-breath", "cold-gale", "hammer-throw", "forceful-hand", "deadly-leap"]);
    expect(FORCED_MOVES).toEqual({
      thunderwave: { feet: 10 }, "gust-of-wind": { feet: 15 }, "thunderous-smite": { feet: 10, prone: true }, "repelling-blast": { feet: 10, lends: "eldritch-blast" },
      whirlwind: { feet: 20, prone: true, save: "str" }, "repulsion-breath": { feet: 30, byWords: true }, "cold-gale": { feet: 30 },
      "hammer-throw": { feet: 15, hit: true }, "forceful-hand": { feet: 5, perMod: 5 }, "deadly-leap": { feet: 5, success: true }
    });
    expect(Object.values(FORCED_MOVES).every(Object.isFrozen)).toBe(true);
    // As far as its words say (an older bronze dragon's breath, 2024's and 2014's wording), else the table's; a summoned
    // hand's, 5 feet more for each point of its caster's modifier.
    const breath = FORCED_MOVES["repulsion-breath"];
    expect(forcedMoveOf(breath, { text: "Failure: The target is pushed up to 60 feet straight away from the dragon." })).toEqual({ kind: "push", feet: 60 });
    expect(forcedMoveOf(breath, { text: "On a failed save, the creature is pushed 40 feet away from the dragon." }).feet).toBe(40);
    expect(forcedMoveOf(breath).feet).toBe(30);
    expect(forcedMoveOf(FORCED_MOVES["forceful-hand"], { mod: 3 }).feet).toBe(20);
    expect(forcedMoveOf(FORCED_MOVES.thunderwave, { text: "pushed up to 60 feet", mod: 3 }).feet).toBe(10);
  });

  test("Thunderwave: its damage, and on a failed Constitution save pushed 10 feet; Shatter pushes nobody", async () => {
    const [wave] = await actionsFrom([spellOf("thunderwave", 1, [saveAct({ damage: "2d8" })])], "thunderwave", slots);
    expect(wave).toMatchObject({ kind: "save", save: { type: "con", dc: 13, basic: true }, range: { increment: 15, max: 15 }, area: { targets: 3 }, effects: [pushOf(10)] });
    const [shatter] = await actionsFrom([spellOf("shatter", 2, [saveAct({ damage: "3d8" })])], "shatter");
    expect(shatter.kind).toBe("save");
    expect(shatter.effects).toBeUndefined();
  });

  test("Gust of Wind: a failed Strength save, pushed 15 feet; 2014's, whose save comes after the casting, played as the casting", async () => {
    const line = { target: { template: { type: "line", size: 60, width: 10, units: "ft" } }, properties: new Set(["vocal", "somatic", "material", "concentration"]) };
    const [gust] = await actionsFrom([spellOf("gust-of-wind", 2, [saveAct({ ability: "str" })], line)], "gust-of-wind");
    const failed = { move: { kind: "push", feet: 15 } };
    expect(gust).toMatchObject({ kind: "control", concentration: true, save: { type: "str", dc: 13, basic: false }, onSave: [failed, failed, null, null] });
    const legacy = Object.assign([saveAct({ name: "Wind Blast Save", ability: "str", activation: "special" }), utilityAct("turn", "bonus"), utilityAct("use", "action")], { size: 3 });
    const old = await actionsFrom([spellOf("gust-of-wind", 2, legacy, line)], "gust-of-wind");
    expect(old).toHaveLength(1);
    expect(old[0]).toMatchObject({ name: "gust-of-wind", kind: "control", range: { increment: 60, max: 60 }, area: { targets: 3 }, onSave: [failed, failed, null, null] });
    expect(old[0].economy).toBeUndefined();
  });

  test("Thunderous Smite: its save on a hit, failed, pushes 10 feet and knocks prone", async () => {
    const spec = await specOf(actorOf({ items: [smiteOf()], ...slots }));
    expect(spec.riders).toHaveLength(1);
    const failed = { conditions: { prone: 1 }, move: { kind: "push", feet: 10 } };
    expect(spec.riders[0]).toMatchObject({ save: { type: "str", dc: 13 }, onSave: [failed, failed, null, null], resource: "slots:1", cost: { bonus: 1, slot: 1 } });
  });

  test("Repelling Blast: Eldritch Blast pushes 10 feet on a hit (2014, or laid on nothing); 2024's, the cantrip it's laid on", async () => {
    const blast = spellOf("eldritch-blast", 0, [attackAct()], { range: { value: 120, units: "ft" }, target: {} });
    const bolt = (effects = []) => spellOf("fire-bolt", 0, [attackAct({ type: "fire" })], { range: { value: 120, units: "ft" }, target: {} }, { effects });
    const invocation = featOf("repelling-blast", [{ id: "make", type: "enchant", activation: { type: "" }, effects: [] }]);
    const effectsOf = async (items, id) => (await actionsFrom(items, id))[0].effects;
    expect(await effectsOf([blast, bolt()], "eldritch-blast")).toBeUndefined();
    expect(await effectsOf([blast, bolt(), invocation], "eldritch-blast")).toEqual([pushOf(10)]);
    expect(await effectsOf([blast, bolt(), invocation], "fire-bolt")).toBeUndefined();
    const laid = bolt([{ name: "Repelling Blast", origin: "Actor.actor.Item.repelling-blast.Activity.make", changes: [] }]);
    expect(await effectsOf([blast, laid, invocation], "fire-bolt")).toEqual([pushOf(10)]);
    expect(await effectsOf([blast, laid, invocation], "eldritch-blast")).toBeUndefined();
  });

  test("SRD creatures': a whirlwind (only its Strength save), a dragon's breath as far as it says, a thrown hammer, a summoned hand", async () => {
    const whirl = Object.assign([saveAct({ id: "collide", ability: "dex", damage: "3d8", type: "bludgeoning" }), saveAct({ id: "whirl", ability: "str", damage: "3d8", type: "bludgeoning" })], { size: 2 });
    const [collide, flung] = await actionsFrom([featOf("whirlwind", whirl)], "whirlwind");
    expect(collide.effects).toBeUndefined();
    expect(flung.effects).toEqual([pushOf(20), expect.objectContaining({ kind: "condition", conditions: { prone: 1 } })]);
    const [breath] = await actionsFrom([featOf("repulsion-breath", [saveAct({ ability: "str" })], "Failure: The target is pushed up to 60 feet straight away from the dragon.")], "repulsion-breath");
    expect(breath.onSave[1]).toEqual({ move: { kind: "push", feet: 60 } });
    const [hammer] = await actionsFrom([featOf("hammer-throw", [attackAct({ damage: "1d8", type: "fire" })])], "hammer-throw");
    expect(hammer).toMatchObject({ kind: "strike", effects: [pushOf(15)] });
    const [hand] = await actionsFrom([featOf("forceful-hand", [saveAct({ ability: "str", activation: "bonus" })])], "forceful-hand", { flags: { dnd5e: { summon: { mod: 3 } } } });
    expect(hand).toMatchObject({ kind: "control", economy: "bonus", onSave: [{ move: { kind: "push", feet: 20 } }, { move: { kind: "push", feet: 20 } }, null, null] });
  });
});

describe("pushed, in the engine", () => {
  const caster = async () => fighter("hero", "friendly", 0, { actions: await actionsFrom([spellOf("thunderwave", 1, [saveAct({ damage: "2d8" })])], "thunderwave", slots), resources: { "slots:1": 2 } });

  test("Thunderwave, a failed save: its damage, and pushed 10 feet away", async () => {
    const run = fight([await caster(), fighter("orc", "hostile", 5, frail)]);
    const orc = run.byId.get("orc");
    takeTurn(run, run.byId.get("hero"));
    const save = run.log.find(e => e.type === "save" && e.actorId === "hero");
    expect(save).toMatchObject({ saveType: "con", targetId: "orc" });
    expect(save.degree).toBeLessThan(2);
    expect(run.log.find(e => e.type === "forced" && e.targetId === "orc")).toMatchObject({ how: "push", feet: 10, fall: 0 });
    expect(orc.pos).toMatchObject({ x: 15, y: 0 });
    expect(orc.hp).toBe(60 - save.damage);
  });

  test("Thunderwave, a save made: half its damage, and it stays where it is", async () => {
    const run = fight([await caster(), fighter("orc", "hostile", 5, { defenses: { ac: 15, str: 2, dex: 2, con: 50, int: 0, wis: 0, cha: 0 } })]);
    takeTurn(run, run.byId.get("hero"));
    expect(run.log.find(e => e.type === "save" && e.actorId === "hero")?.degree).toBeGreaterThanOrEqual(2);
    expect(run.log.some(e => e.type === "forced")).toBe(false);
    expect(run.byId.get("orc").pos).toMatchObject({ x: 5, y: 0 });
  });

  test("Thunderwave by a drop: pushed over the edge, a fall of 20 feet, and it lands prone", async () => {
    const run = fight([await caster(), fighter("orc", "hostile", 5, frail)], ledge);
    const orc = run.byId.get("orc");
    takeTurn(run, run.byId.get("hero"));
    expect(run.log.find(e => e.type === "forced" && e.targetId === "orc")).toMatchObject({ how: "push", fall: 20 });
    const fell = run.log.find(e => e.type === "fall" && e.actorId === "orc");
    expect(fell.feet).toBe(20);
    expect(fell.amount).toBeGreaterThanOrEqual(2);
    expect(orc.prone).toBe(true);
  });

  test("Thunderous Smite on a hit: the failed save pushes it 10 feet and knocks it prone", async () => {
    const { riders } = await specOf(actorOf({ items: [smiteOf()], ...slots }));
    const hero = fighter("hero", "friendly", 0, { actions: [{ ...fist("hero"), bonus: 50 }], riders, resources: { "slots:1": 2 }, tac: { resourceUse: "nova" } });
    const run = fight([hero, fighter("orc", "hostile", 5, frail)]);
    takeTurn(run, run.byId.get("hero"));
    expect(run.log.find(e => e.type === "rider" && e.targetId === "orc")).toMatchObject({ saveType: "str", landed: true });
    expect(run.log.find(e => e.type === "forced" && e.targetId === "orc")).toMatchObject({ how: "push", feet: 10 });
    expect(run.byId.get("orc").prone).toBe(true);
  });

  test("Repelling Blast: Eldritch Blast's hit pushes it 10 feet away", async () => {
    const blast = spellOf("eldritch-blast", 0, [attackAct()], { range: { value: 120, units: "ft" }, target: {} });
    const [beam] = await actionsFrom([blast, featOf("repelling-blast")], "eldritch-blast");
    const run = fight([fighter("hero", "friendly", 0, { actions: [{ ...beam, bonus: 50 }] }), fighter("orc", "hostile", 20)]);
    takeTurn(run, run.byId.get("hero"));
    expect(run.log.find(e => e.type === "forced" && e.targetId === "orc")).toMatchObject({ how: "push", feet: 10 });
    expect(run.byId.get("orc").pos).toMatchObject({ x: 30, y: 0 });
  });
});

/* Pushed on a success, and a weapon's Push mastery ------------------------- */

/* The SRD's words (5.1 and 5.2, CC-BY 4.0), as dnd5e's compendiums keep them. */
const LEAP_2014 = "<p>Each of those creatures must succeed on a [[/save activity=leap]] saving throw (target's choice) or be knocked &amp;reference[prone] and take [[/damage average activity=leap]]. On a successful save, the creature takes only half the damage, isn't knocked prone, and is pushed 5 feet out of the [[lookup @name lowercase]]{monster}'s space into an unoccupied space of the creature's choice.</p>";
const LEAP_2024 = "<p>Dexterity Saving Throw: DC 16, each creature in the bulette's destination space. Failure: [[/damage average]] damage, and the target has the &amp;Reference[Prone apply=false] condition. Success: Half damage, and the target is pushed 5 feet straight away from the bulette.</p>";

/** A bulette's Deadly Leap: 2014's (Strength or Dexterity, the target's choice; Prone from its words), or 2024's (Dexterity; Prone its effect). */
function leapOf(edition) {
  const prone = { _id: "prone", id: "prone", name: "Prone", statuses: new Set(["prone"]), changes: [], duration: {} };
  const rolls = edition === 2014
    ? [{ parts: ["3d6 + 4"], options: { types: ["bludgeoning"] } }, { parts: ["3d6 + 4"], options: { types: ["slashing"] } }]
    : [{ parts: ["3d12"], options: { types: ["bludgeoning"] } }];
  const leap = {
    id: "leap", type: "save", activation: { type: "action" }, save: { ability: new Set(edition === 2014 ? ["str", "dex"] : ["dex"]), dc: { value: 16 } },
    damage: { onSave: "half", parts: rolls.map(() => ({})) }, effects: edition === 2014 ? [] : [{ _id: "prone" }], range: edition === 2014 ? { value: 15, units: "ft" } : { units: "self" }, target: {},
    getDamageConfig: () => ({ rolls })
  };
  return { ...featOf("deadly-leap", [leap], ""), effects: listOf([prone]), system: { identifier: "deadly-leap", activities: [leap], description: { value: edition === 2014 ? LEAP_2014 : LEAP_2024 }, uses: {} } };
}
/** A warhammer, its mastery Push. */
const warhammerOf = (system = {}) => ({
  id: "warhammer", type: "weapon", name: "Warhammer", identifier: "warhammer", flags: {}, effects: [],
  system: { identifier: "warhammer", activities: [attackAct({ damage: "1d8 + 3", type: "bludgeoning", melee: true })], type: { value: "martialM", baseItem: "warhammer" }, properties: new Set(["ver"]), mastery: "push", equipped: true, range: {}, ...system }
});
/** A character with a warhammer, and mastery of warhammers or not. */
function hammerer(has) {
  const actor = actorOf({ type: "character", str: 3, items: [warhammerOf()] });
  actor.system.traits.weaponProf = { mastery: { value: new Set(has ? ["warhammer"] : []) } };
  return actor;
}

describe("pushed on a successful save (FORCED_MOVES' success)", () => {
  test("Deadly Leap, 2014: Strength or Dexterity (the target's choice), Prone and the damage on a failure, half and pushed 5 feet on a success", async () => {
    const [leap] = await actionsFrom([leapOf(2014)], "deadly-leap");
    expect(leap).toMatchObject({ kind: "control", save: { type: ["str", "dex"], dc: 16, basic: true }, range: { increment: 15 } });
    expect(leap.damage.map(p => p.type)).toEqual(["bludgeoning", "slashing"]);
    const [critFail, fail, pass, critPass] = leap.onSave;
    expect(fail).toMatchObject({ conditions: { prone: 1 } });
    expect(fail.move).toBeUndefined();
    expect(critFail).toBe(fail);
    expect(pass).toEqual({ move: { kind: "push", feet: 5 } });
    expect(critPass).toBe(pass);
  });

  test("Deadly Leap, 2024: a Dexterity save, its Prone effect on a failure, pushed 5 feet straight away on a success", async () => {
    const [leap] = await actionsFrom([leapOf(2024)], "deadly-leap");
    expect(leap).toMatchObject({ kind: "control", save: { type: "dex", dc: 16 } });
    expect(leap.onSave[1]).toMatchObject({ conditions: { prone: 1 } });
    expect(leap.onSave[2]).toEqual({ move: { kind: "push", feet: 5 } });
  });

  test("in the engine: a save made takes half and is pushed out of the way; a failed one is knocked prone where it stands", async () => {
    const [leap] = await actionsFrom([leapOf(2014)], "deadly-leap");
    const bulette = () => fighter("bulette", "hostile", 0, { actions: [leap] });
    const sturdy = { defenses: { ac: 15, str: 50, dex: 50, con: 2, int: 0, wis: 0, cha: 0 } };
    const made = fight([bulette(), fighter("hero", "friendly", 5, sturdy)]);
    takeTurn(made, made.byId.get("bulette"));
    const saved = made.log.find(e => e.type === "control" && e.actorId === "bulette");
    expect(saved).toMatchObject({ roll: "save", took: true });
    expect(saved.degree).toBeGreaterThanOrEqual(2);
    expect(made.log.find(e => e.type === "forced" && e.targetId === "hero")).toMatchObject({ how: "push", feet: 5 });
    expect(made.byId.get("hero")).toMatchObject({ pos: { x: 10, y: 0 }, prone: false });
    expect(saved.damage).toBeGreaterThan(0);
    expect(saved.damage).toBeLessThanOrEqual(22);
    const failed = fight([bulette(), fighter("hero", "friendly", 5, frail)]);
    takeTurn(failed, failed.byId.get("bulette"));
    expect(failed.log.some(e => e.type === "forced")).toBe(false);
    expect(failed.byId.get("hero")).toMatchObject({ pos: { x: 5, y: 0 }, prone: true });
    expect(failed.log.find(e => e.type === "control" && e.actorId === "bulette").damage).toBeGreaterThanOrEqual(14);
  });
});

describe("Weapon Mastery's Push (the SRD 5.2's)", () => {
  const wielder = has => ({ system: { traits: { weaponProf: { mastery: { value: new Set(has ? ["warhammer"] : []) } } } } });

  test("the mastery its wielder uses: dnd5e's own options, else the weapon's own where the wielder has mastery of its kind", () => {
    expect(masteryOf(wielder(true), warhammerOf())).toBe("push");
    expect(masteryOf(wielder(false), warhammerOf())).toBeNull();
    expect(masteryOf(wielder(false), warhammerOf({ masteryOptions: [{ value: "push" }, { value: "sap" }] }))).toBe("push");
    expect(masteryOf(wielder(true), warhammerOf({ masteryOptions: null }))).toBeNull();
    expect(masteryOf(wielder(true), warhammerOf({ mastery: "" }))).toBeNull();
    expect(PUSH_MASTERY).toEqual({ feet: 10, maxSize: 3 });
  });

  test("a hit with it pushes 10 feet (a creature Large or smaller); without the mastery, none", async () => {
    const [hammer] = (await specOf(hammerer(true))).actions.filter(a => a.itemId === "warhammer");
    expect(hammer.effects).toEqual([{ kind: "move", move: { kind: "push", feet: 10 }, critOnly: false, maxSize: 3 }]);
    const [plain] = (await specOf(hammerer(false))).actions.filter(a => a.itemId === "warhammer");
    expect(plain.effects).toBeUndefined();
  });

  test("in the engine: the hit pushes it 10 feet straight away", async () => {
    const [hammer] = (await specOf(hammerer(true))).actions.filter(a => a.itemId === "warhammer");
    const run = fight([fighter("hero", "friendly", 0, { actions: [{ ...hammer, bonus: 50 }] }), fighter("orc", "hostile", 5)]);
    takeTurn(run, run.byId.get("hero"));
    expect(run.log.find(e => e.type === "forced" && e.targetId === "orc")).toMatchObject({ how: "push", feet: 10 });
    expect(run.byId.get("orc").pos).toMatchObject({ x: 15, y: 0 });
  });

  test("an outcome's own size limit: a Huge creature is past what it can do", () => {
    const push = { kind: "control", onSave: [{ move: { kind: "push", feet: 10 }, maxSize: 3 }] };
    expect(dnd5eRules.isImmune({ spec: { size: 4, iwr: { immune: [] } } }, push)).toBe(true);
    expect(dnd5eRules.isImmune({ spec: { size: 3, iwr: { immune: [] } } }, push)).toBe(false);
  });
});
