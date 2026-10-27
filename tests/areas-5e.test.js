/**
 * Areas in their own shape and size (areaOf): dnd5e's template types, by key, as the core's areas (a cone or a line
 * from the user, a cube against it, a burst round its point, an emanation round the user), in feet; on the actions
 * the adapter makes; and in the engine, who each catches.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { beginRun, prepareBattle, inArea } from "../../FastFighting/scripts/engine/simulator.js";
import { Dnd5eAdapter, areaOf } from "../scripts/adapter.js";
import { dnd5eRules } from "../scripts/rules.js";

/** Foundry's Roll.replaceFormulaData, as far as these tests need it. */
const replaceFormulaData = (formula, data) => String(formula).replace(/@([a-z.0-9_-]+)/gi, (m, term) => String(term.split(".").reduce((o, k) => o?.[k], data) ?? 0));
const listOf = list => Object.assign(list, { get: id => list.find(i => i.id === id), getName: name => list.find(i => i.name === name) });

/** An actor as dnd5e prepares one, with only what these tests look at. */
const actorOf = items => ({
  id: "actor", uuid: "Actor.actor", type: "npc", name: "actor", img: "", flags: {}, statuses: new Set(), appliedEffects: [], classes: {},
  items: listOf(items), getRollData: () => ({}), toObject() { return { name: this.name }; },
  system: {
    abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(k => [k, { value: 10, mod: 0, save: 0 }])),
    attributes: { hp: { value: 20, max: 20, temp: 0 }, ac: { value: 12 }, movement: { walk: 30, units: "ft" }, senses: {}, death: {}, spell: { dc: 14 } },
    details: { cr: 5, level: 5, type: { value: "humanoid" } },
    skills: { ath: { total: 2, passive: 12 }, acr: { total: 0, passive: 10 }, ste: { total: 1 }, prc: { total: 1, passive: 11 }, ins: { total: 1, passive: 11 } },
    traits: { size: "med", languages: { value: new Set() }, di: {}, dr: {}, dv: {}, ci: {} },
    resources: {}, currency: {}, spells: { spell1: { value: 2, max: 2 }, spell3: { value: 2, max: 2 }, spell7: { value: 1, max: 1 } }
  }
});
/** A save for damage, as dnd5e 6 prepares one: `type` "damage" deals it with no save (an auto). */
const activityOf = ({ type = "save", ability = "dex", damage = "8d6", kind = "fire", range = {}, template = null } = {}) => ({
  id: "use", type, activation: { type: "action" }, save: { ability: new Set([ability]), dc: { value: 15 } },
  damage: { onSave: "half", parts: [{}] }, effects: [], range, ...(template ? { target: { template } } : {}),
  getDamageConfig: () => ({ rolls: [{ parts: [damage], options: { types: [kind] } }] })
});
/** A spell, its range and area its own (its activities take them). */
const spellOf = (identifier, level, range, template, activity = activityOf()) => ({
  id: identifier, type: "spell", name: identifier, identifier, flags: {}, effects: [],
  system: {
    identifier, level, activities: [activity], activation: { type: "action" }, range, target: { template },
    properties: new Set(["vocal", "somatic"]), duration: { units: "inst" }, description: { value: "" }
  }
});
/** A creature's feature: its activity's range and area, as a feature's are. */
const featOf = (identifier, range, template) => ({
  id: identifier, type: "feat", name: identifier, identifier, flags: {}, effects: [],
  system: { identifier, activities: [activityOf({ range, template })], description: { value: "" }, uses: {} }
});
const ft = (type, size, more = {}) => ({ type, size, units: "ft", ...more });
const self = { units: "self" };
const feetAway = value => ({ value, units: "ft" });
/** The first action the adapter makes of each item, by its id. */
async function actionsOf(items) {
  const spec = await new Dnd5eAdapter().toCombatantSpec({ id: "token", name: "actor", actor: actorOf(items) });
  return Object.fromEntries(items.map(i => [i.id, spec.actions.find(a => a.itemId === i.id)]));
}

beforeEach(() => { globalThis.Roll = { replaceFormulaData }; });
afterEach(() => { delete globalThis.Roll; });

describe("dnd5e's templates as the core's areas (areaOf)", () => {
  test("a cone or a line, from the user: a cone 53 degrees wide, a line 5 feet across unless it says", () => {
    expect(areaOf(ft("cone", 15), self)).toEqual({ shape: "cone", feet: 15, angle: 53.13 });
    // (2014's Lightning Bolt leaves its width blank; Gust of Wind's is 10 feet.)
    expect(areaOf(ft("line", 100, { width: "" }), self)).toEqual({ shape: "line", feet: 100, width: 5 });
    expect(areaOf(ft("line", 60, { width: 10 }), self)).toEqual({ shape: "line", feet: 60, width: 10 });
    // A creature's breath, its range saying nothing; Javelin of Lightning's line, out as far as it reaches.
    expect(areaOf(ft("cone", 30))).toMatchObject({ shape: "cone", feet: 30 });
    expect(areaOf(ft("line", 120, { width: 5 }), { units: "ft", distance: 120 })).toMatchObject({ shape: "line", feet: 120 });
    // (Put down far off, as Earthquake's fissures are: no shape the core has.)
    expect(areaOf(ft("line", 200, { width: 10 }), { units: "ft", distance: 500 })).toBeNull();
  });

  test("a cube or a square: against the user (Thunderwave); put down farther off (Web, Grease), a square round its point", () => {
    expect(areaOf(ft("cube", 15), self)).toEqual({ shape: "cube", feet: 15 });
    expect(areaOf(ft("cube", 20), { units: "ft", distance: 60 })).toEqual({ shape: "square", feet: 20 });
    expect(areaOf(ft("square", 10), { units: "ft", distance: 60 })).toEqual({ shape: "square", feet: 10 });
  });

  test("a sphere, a cylinder or a circle: a burst round its point; round the user at range self", () => {
    expect(areaOf(ft("sphere", 20), { units: "ft", distance: 150 })).toEqual({ shape: "burst", feet: 20, center: "free" });
    expect(areaOf(ft("cylinder", 5, { height: 40 }), { units: "ft", distance: 120 })).toEqual({ shape: "burst", feet: 5, center: "free" });
    expect(areaOf(ft("circle", 100), { units: "ft", distance: 500 })).toEqual({ shape: "burst", feet: 100, center: "free" });
    expect(areaOf(ft("sphere", 60), { units: "touch" })).toEqual({ shape: "burst", feet: 60, center: "free" });
    // (2014's Antimagic Field.)
    expect(areaOf(ft("sphere", 10), self)).toEqual({ shape: "emanation", feet: 10 });
  });

  test("dnd5e's emanation (radius): round the user, or a creature's aura with no range; put down farther off, a burst", () => {
    expect(areaOf(ft("radius", 15), self)).toEqual({ shape: "emanation", feet: 15 });
    expect(areaOf(ft("radius", 10))).toEqual({ shape: "emanation", feet: 10 });
    expect(areaOf(ft("radius", 5), { units: "ft", distance: 5 })).toEqual({ shape: "emanation", feet: 5 });
    // (Ice Knife; 2014's Spike Growth.)
    expect(areaOf(ft("radius", 5), { units: "ft", distance: 60 })).toEqual({ shape: "burst", feet: 5, center: "free" });
    expect(areaOf(ft("radius", 20), { units: "ft", distance: 150 })).toEqual({ shape: "burst", feet: 20, center: "free" });
    // (At a touch, or anywhere: round that point. Hallow; 2014's Storm of Vengeance.)
    expect(areaOf(ft("radius", 60), { units: "touch" })).toEqual({ shape: "burst", feet: 60, center: "free" });
    expect(areaOf(ft("radius", 360), { units: "spec" })).toEqual({ shape: "burst", feet: 360, center: "free" });
  });

  test("in feet, whatever its units; several at once, one as big as them all; a wall, a ring or nothing, none", () => {
    expect(areaOf({ type: "sphere", size: 6, units: "m" }, { units: "m", distance: 150 })).toEqual({ shape: "burst", feet: 20, center: "free" });
    expect(areaOf({ type: "line", size: 30, width: 1.5, units: "m" }, self)).toEqual({ shape: "line", feet: 100, width: 5 });
    // (Meteor Swarm's four spheres; Fire Storm's ten cubes.)
    expect(areaOf(ft("sphere", 40, { count: 4 }), { units: "mi", distance: 5280 })).toEqual({ shape: "burst", feet: 80, center: "free" });
    expect(areaOf(ft("cube", 10, { count: 10 }), { units: "ft", distance: 150 }).feet).toBeCloseTo(10 * Math.sqrt(10));
    expect(areaOf(ft("wall", 60, { width: 1 }), { units: "ft", distance: 120 })).toBeNull();
    expect(areaOf(ft("ring", 10), self)).toBeNull();
    expect(areaOf({})).toBeNull();
    expect(areaOf(ft("sphere", 0), self)).toBeNull();
  });
});

describe("on the actions the adapter makes", () => {
  const items = () => [
    spellOf("burning-hands", 1, self, ft("cone", 15)),
    spellOf("fireball", 3, feetAway(150), ft("sphere", 20)),
    spellOf("thunderwave", 1, self, ft("cube", 15)),
    spellOf("fire-storm", 7, feetAway(150), ft("cube", 10, { count: 10 })),
    spellOf("searing-sphere", 3, feetAway(120), ft("sphere", 10), activityOf({ type: "damage" })),
    featOf("cold-breath", {}, ft("cone", 60)),
    featOf("fire-aura", {}, ft("radius", 10))
  ];

  test("a spell's area its shape and size: Burning Hands' cone, as far as it reaches; Fireball round a point 150 feet off", async () => {
    const a = await actionsOf(items());
    expect(a["burning-hands"]).toMatchObject({ kind: "save", area: { targets: 2, shape: "cone", feet: 15, angle: 53.13 }, range: { increment: 15, max: 15 } });
    expect(a.fireball).toMatchObject({ kind: "save", area: { targets: 4, shape: "burst", feet: 20 }, range: { max: 150 } });
    expect(a.thunderwave).toMatchObject({ area: { targets: 3, shape: "cube", feet: 15 }, range: { max: 15 } });
    // (Several at once count as more, too.)
    expect(a["fire-storm"].area).toMatchObject({ targets: 4, shape: "square" });
    expect(a["searing-sphere"]).toMatchObject({ kind: "auto", area: { targets: 3, shape: "burst", feet: 10 }, range: { max: 120 } });
  });

  test("a creature's breath or aura, its range saying nothing: from itself, reaching as far as it spreads", async () => {
    const a = await actionsOf(items());
    expect(a["cold-breath"]).toMatchObject({ area: { shape: "cone", feet: 60 }, range: { increment: 60, max: 60 } });
    expect(a["fire-aura"]).toMatchObject({ area: { shape: "emanation", feet: 10 }, range: { max: 10 } });
  });
});

describe("in the engine", () => {
  const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
  const body = (id, side, pos) => ({
    id, name: id, side, kind: "npc", level: 3, size: 2, hp: { value: 60, max: 60, temp: 0 }, defenses: { ac: 15, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    initiative: { mod: 0 }, speeds: { walk: 30 }, iwr: {}, flags: { fearless: true }, diesAtZero: false, actions: [],
    traits: { tactical: { base: 70, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } }, ...pos
  });

  test("who each catches, aimed at a foe 10 feet off: a breath's cone and a cube ahead of the user, a burst round the foe, an aura round the user", async () => {
    const a = await actionsOf([featOf("fire-breath", {}, ft("cone", 30)), spellOf("fireball", 3, feetAway(150), ft("sphere", 20)),
      spellOf("thunderwave", 1, self, ft("cube", 15)), featOf("fire-aura", {}, ft("radius", 15))]);
    const battle = {
      combatants: [body("mage", "hostile", at(0)), body("near", "friendly", at(10)), body("beside", "friendly", at(15, 5)), body("slant", "friendly", at(20, 12)),
        body("ahead", "friendly", at(30)), body("behind", "friendly", at(-15)), body("far", "friendly", at(40))],
      sides: { friendly: { label: "Party", enemies: ["hostile"] }, hostile: { label: "Foes", enemies: ["friendly"] } }, options: { positioning: true, opening: "fight", maxRounds: 3 }
    };
    const run = beginRun(prepareBattle(battle, dnd5eRules), 1);
    const by = id => run.byId.get(id);
    const caught = action => ["beside", "slant", "ahead", "behind", "far"].filter(id => inArea(run, by("mage"), by("near"), by(id), action.area));
    // (31 degrees off is outside 5e's cone, 53 degrees wide; inside the core's own quarter turn.)
    expect(caught(a["fire-breath"])).toEqual(["beside", "ahead"]);
    expect(inArea(run, by("mage"), by("near"), by("slant"), { shape: "cone", feet: 30 })).toBe(true);
    // (Its point wherever its maker chooses, as the SRD has it, not only a corner of the foe's space: far too.)
    expect(caught(a.fireball)).toEqual(["beside", "slant", "ahead", "far"]);
    expect(caught(a.thunderwave)).toEqual(["beside"]);
    expect(caught(a["fire-aura"])).toEqual(["behind"]);
  });
});

describe("areas that spare whom their maker chooses (the core's selective, API 32)", () => {
  const choosing = activityOf({ template: ft("cube", 40) });
  choosing.target = { ...choosing.target, affects: { choice: true } };

  test("dnd5e's own choice of targets, words that say so, an evoker's Sculpt Spells; else friends are caught too", async () => {
    const slow = spellOf("slow", 3, feetAway(120), ft("cube", 40), choosing);
    const weird = spellOf("weird", 9, feetAway(120), ft("sphere", 30));
    weird.system.description.value = "<p>Each creature of your choice in a 30-foot-radius Sphere centered on a point within range makes a Wisdom saving throw.</p>";
    const a = await actionsOf([slow, weird, spellOf("fireball", 3, feetAway(150), ft("sphere", 20))]);
    expect(a.slow.area.selective).toBe(true);
    expect(a.weird.area.selective).toBe(true);
    expect(a.fireball.area.selective).toBeUndefined();
    const fireball = spellOf("fireball", 3, feetAway(150), ft("sphere", 20));
    fireball.system.school = "evo";
    const sculpt = { id: "sculpt", type: "feat", name: "Sculpt Spells", identifier: "sculpt-spells", flags: {}, effects: [], system: { identifier: "sculpt-spells", activities: [], description: { value: "" }, uses: {} } };
    const evoker = await actionsOf([fireball, sculpt]);
    expect(evoker.fireball.area.selective).toBe(true);
  });
});
