/**
 * What lasts on a creature in 5e, as the core's own conditions and afflictions play it (its engine/conditions.js
 * PROFILES and behavior/afflictions.js): 2024's Contagion as a tallied affliction (three successes or three failures);
 * Burning (the SRD 5.2's hazard: 1d4 fire a turn, put out with an action) and the acid a spell leaves for the end of
 * its target's next turn, as the core's burning and corroding.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, prepareBattle, endOfTurn } from "../../FastFighting/scripts/engine/simulator.js";
import { remediesOf } from "../../FastFighting/scripts/engine/behavior/holds.js";
import { Dnd5eAdapter, tallyFrom, tallied, plainText, setsAlight } from "../scripts/adapter.js";
import { dnd5eRules } from "../scripts/rules.js";
import { parseFormula, applyOutcome } from "../scripts/core.js";

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

/* Burning ------------------------------------------------------------------- */

/* The SRD's words (5.1 and 5.2, CC-BY 4.0), as dnd5e's compendiums keep them. */
const ALCHEMISTS_FIRE_2024 = "<p>Target one creature or object you can see within 20 feet of yourself. The target must succeed on a Dexterity saving throw (DC 8 plus your Dexterity modifier and Proficiency Bonus) or take [[/damage 1d4 type=fire]] damage and start &amp;Reference[burning].</p>";
const MAGMIN_TOUCH_2024 = "<p>[[/attack extended]]. [[/damage average extended]]. If the target is a creature or a flammable object that isn't being worn or carried, it starts burning.</p>";
const ELEMENTAL_TOUCH_2014 = "<p>[[/attack extended]]. [[/damage extended]]. If the target is a creature or a flammable object, it ignites. Until a creature takes an action to douse the fire, the target takes [[/damage activity=burn average]] damage at the start of each of its turns.</p>";
const NOT_ALIGHT = [
  "<p>Flammable objects in the Cone that aren't being worn or carried start burning.</p>",
  "<p>If the target is a flammable object that isn't being worn or carried, it starts burning.</p>",
  "<p>A flammable object hit by this spell starts burning if it isn't being worn or carried.</p>",
  "<p>It ignites flammable objects in the area that aren't being worn or carried.</p>",
  "<p>While there, the flame emits no heat and ignites nothing, and it sheds Bright Light in a 20-foot radius.</p>"
];

describe("Burning (the SRD 5.2's hazard), as the core's burning", () => {
  test("its words set a creature alight; a fire that only catches objects, or ignites nothing, doesn't", () => {
    for ( const words of [ALCHEMISTS_FIRE_2024, MAGMIN_TOUCH_2024, ELEMENTAL_TOUCH_2014] ) expect([words, setsAlight(plainText(words))]).toEqual([words, true]);
    for ( const words of NOT_ALIGHT ) expect([words, setsAlight(plainText(words))]).toEqual([words, false]);
  });

  test("set alight: by dnd5e's Burning status (2014's alchemist's fire), by its words (2024's, whose effect has none), on a hit or a failed save", async () => {
    const oldFire = itemOf("consumable", "alchemists-fire", "Alchemist's Fire", {
      activities: [{ id: "throw", type: "attack", activation: { type: "action" }, attack: { type: { value: "ranged" } }, labels: { modifier: "+4" }, range: { value: 20, units: "ft" }, target: {},
        effects: [{ _id: "covered" }], getDamageConfig: rollsOf("1d4", "fire") }],
      effects: [effectOf("covered", "Covered in Alchemist's Fire", ["burning"])], words: "<p>This sticky, adhesive fluid ignites when exposed to air.</p>", system: { quantity: 1, uses: { max: 1, spent: 0 } }
    });
    const newFire = itemOf("consumable", "alchemists-fire", "Alchemist's Fire", {
      activities: [{ id: "throw", type: "save", activation: { type: "action" }, save: { ability: new Set(["dex"]), dc: { value: 12 } }, damage: { onSave: "none", parts: [{}] }, range: { value: 20, units: "ft" }, target: {},
        effects: [{ _id: "burn" }], getDamageConfig: rollsOf("1d4", "fire") }],
      effects: [effectOf("burn", "Burning.")], words: ALCHEMISTS_FIRE_2024, system: { quantity: 1, uses: { max: 1, spent: 0 } }
    });
    const [thrown] = (await specOf(actorOf({ items: [oldFire] }))).actions.filter(a => a.itemId === "alchemists-fire");
    expect(thrown.kind).toBe("strike");
    expect(thrown.effects).toEqual([expect.objectContaining({ kind: "condition", conditions: { burning: 1 } })]);
    const [splashed] = (await specOf(actorOf({ items: [newFire] }))).actions.filter(a => a.itemId === "alchemists-fire");
    expect(splashed).toMatchObject({ kind: "save", save: { type: "dex", basic: false } });
    expect(splashed.effects).toEqual([expect.objectContaining({ kind: "condition", conditions: { burning: 1 } })]);
  });

  test("a fire elemental's touch (2014): set alight, and its own words for what the fire does each turn (1d10, the creature's spec.burns)", async () => {
    const touch = itemOf("weapon", "touch", "Touch", {
      activities: [
        { id: "hit", type: "attack", activation: { type: "action" }, attack: { type: { value: "melee" } }, labels: { modifier: "+6" }, range: {}, target: {}, effects: [{ _id: "ignited" }], getDamageConfig: rollsOf("2d6 + 3", "fire") },
        { id: "burn", type: "damage", activation: { type: "special" }, range: {}, target: {}, effects: [], getDamageConfig: rollsOf("1d10", "fire") }
      ],
      effects: [effectOf("ignited", "Ignited")], words: ELEMENTAL_TOUCH_2014, system: { type: { value: "natural" }, equipped: true }
    });
    const spec = await specOf(actorOf({ creature: "elemental", items: [touch] }));
    const actions = spec.actions.filter(a => a.itemId === "touch");
    expect(actions).toHaveLength(1);
    expect(actions[0].effects).toEqual([expect.objectContaining({ kind: "condition", conditions: { burning: 1 } })]);
    expect(spec.burns).toEqual([expect.objectContaining({ dice: [{ n: 1, faces: 10 }], type: "fire" })]);
    expect(dnd5eRules.conditionHarm("burning", 1, { effects: [] }, { id: "elemental", spec })).toBe(spec.burns);
  });

  test("its harm: 1d4 fire a turn, whatever its value (the SRD 5.2's), unless the fire's source says more", () => {
    expect(dnd5eRules.conditionHarm("burning", 3, { effects: [] }, null)).toEqual([expect.objectContaining({ dice: [{ n: 1, faces: 4 }], flat: 0, type: "fire" })]);
    expect(dnd5eRules.conditionHarm("bleeding", 2, { effects: [] }, null)).toBeUndefined();
  });

  test("in the engine: 1d4 fire at the end of its turn; it puts the fire out with an action, and is Prone (2024), the core's own way not tried", () => {
    const run = fight([fighter("hero", "friendly", 0), fighter("orc", "hostile", 5)]);
    const hero = run.byId.get("hero");
    applyOutcome(hero, { conditions: { burning: 1 }, rounds: 10, label: "burning" }, "orc", { id: "orc.fire" });
    endOfTurn(run, hero);
    const burnt = run.log.find(e => e.type === "persistent" && e.actorId === "hero");
    expect(burnt).toMatchObject({ condition: "burning", damageType: "fire" });
    expect(burnt.amount).toBeGreaterThanOrEqual(1);
    expect(burnt.amount).toBeLessThanOrEqual(4);
    const [first] = remediesOf(run, hero);
    expect(first).toMatchObject({ key: "dnd5e:burning", condition: "burning", type: "fire", annoyance: 60, cost: { action: 1 } });
    expect(first.try(run, hero)).toEqual({ success: true });
    expect(hero.conds.burning ?? 0).toBe(0);
    expect(hero.prone).toBe(true);
    expect(remediesOf(run, hero)).toEqual([]);
  });

  test("under the 2014 rules: an action and a DC 10 Dexterity check put it out (the SRD 5.1's alchemist's fire), no Prone", () => {
    const run = fight([fighter("hero", "friendly", 0, { rulesVersion: "legacy", escapeWork: { mod: 2, ath: 2, acr: 0, str: 1, dex: 30 } }), fighter("orc", "hostile", 5)]);
    const hero = run.byId.get("hero");
    applyOutcome(hero, { conditions: { burning: 1 }, rounds: 10, label: "burning" }, "orc", { id: "orc.fire" });
    expect(remediesOf(run, hero)[0].try(run, hero)).toEqual({ success: true });
    expect([hero.conds.burning ?? 0, hero.prone]).toEqual([0, false]);
    const clumsy = fight([fighter("hero", "friendly", 0, { rulesVersion: "legacy", escapeWork: { mod: 2, ath: 2, acr: 0, str: 1, dex: -30 } }), fighter("orc", "hostile", 5)]);
    const other = clumsy.byId.get("hero");
    applyOutcome(other, { conditions: { burning: 1 }, rounds: 10, label: "burning" }, "orc", { id: "orc.fire" });
    expect(remediesOf(clumsy, other)[0].try(clumsy, other)).toEqual({ success: false });
    expect(other.conds.burning).toBe(1);
  });
});

/* Acid left for later ------------------------------------------------------ */

const ACID_ARROW_2014 = "<p>Make a ranged spell Attack against the target. On a hit, the target takes 4d4 acid damage immediately and 2d4 acid damage at the end of its next turn. On a miss, the arrow splashes the target with acid for half as much of the initial damage and no damage at the end of its next turn.</p>";
const VITRIOLIC_SPHERE_2024 = "<p>Each creature in that area makes a Dexterity saving throw. On a failed save, a creature takes 10d4 Acid damage and another [[/damage 5d4 type=acid]] damage at the end of its next turn. On a successful save, a creature takes half the initial damage only.</p>";

/** Acid Arrow as dnd5e's 2014 data has it: the attack, and the damage it leaves (an action of its own there, untyped). */
const acidArrow = () => itemOf("spell", "acid-arrow", "Acid Arrow", {
  activities: [
    { id: "cast", type: "attack", activation: { type: "action" }, attack: { type: { value: "ranged" } }, labels: { modifier: "+6" }, range: { value: 90, units: "ft" }, target: {}, effects: [], getDamageConfig: rollsOf("4d4", "acid") },
    { id: "later", type: "damage", activation: { type: "action" }, range: {}, target: {}, effects: [], getDamageConfig: () => ({ rolls: [{ parts: ["2d4"], options: { types: [] } }] }) }
  ],
  words: ACID_ARROW_2014, system: { level: 2, activation: { type: "action" }, range: { value: 90, units: "ft" }, properties: new Set(["vocal", "somatic", "material"]) }
});
const vitriolicSphere = () => itemOf("spell", "vitriolic-sphere", "Vitriolic Sphere", {
  activities: [
    { id: "cast", type: "save", activation: { type: "action" }, save: { ability: new Set(["dex"]), dc: { value: 15 } }, damage: { onSave: "half", parts: [{}] }, range: { value: 150, units: "ft" }, target: {}, effects: [], getDamageConfig: rollsOf("10d4", "acid") },
    { id: "later", type: "damage", activation: { type: "" }, range: {}, target: {}, effects: [], getDamageConfig: rollsOf("5d4", "acid") }
  ],
  words: VITRIOLIC_SPHERE_2024, system: { level: 4, activation: { type: "action" }, range: { value: 150, units: "ft" }, target: { template: { type: "sphere", size: 20, units: "ft" } } }
});

describe("acid a spell leaves for the end of its target's next turn, as the core's corroding", () => {
  test("Acid Arrow (2014's data): the hit leaves 2d4 acid for later, not an action of its own", async () => {
    const spec = await specOf(actorOf({ items: [acidArrow()], spells: { spell2: { value: 2, max: 2 } } }));
    const actions = spec.actions.filter(a => a.itemId === "acid-arrow");
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "spell-attack", effects: [{ kind: "condition", conditions: { corroding: 1 }, rounds: 1, label: "Acid Arrow", critOnly: false }] });
    expect(spec.lingering).toEqual({ "Acid Arrow": [expect.objectContaining({ dice: [{ n: 2, faces: 4 }], type: "acid" })] });
  });

  test("Vitriolic Sphere (2024): a failed save leaves 5d4 acid for later", async () => {
    const spec = await specOf(actorOf({ items: [vitriolicSphere()], spells: { spell4: { value: 1, max: 1 } } }));
    const [cast] = spec.actions.filter(a => a.itemId === "vitriolic-sphere");
    expect(cast).toMatchObject({ kind: "save", effects: [{ kind: "condition", conditions: { corroding: 1 }, rounds: 1 }] });
    expect(spec.lingering["Vitriolic Sphere"]).toEqual([expect.objectContaining({ dice: [{ n: 5, faces: 4 }], type: "acid" })]);
  });

  test("in the engine: on a hit, 2d4 acid at the end of the target's next turn, and then it's gone", async () => {
    const spec = await specOf(actorOf({ items: [acidArrow()], spells: { spell2: { value: 2, max: 2 } } }));
    const [arrow] = spec.actions.filter(a => a.itemId === "acid-arrow");
    const run = fight([fighter("mage", "hostile", 0, { actions: [{ ...arrow, bonus: 50 }], resources: { "slots:2": 2 }, lingering: spec.lingering }), fighter("hero", "friendly", 30)]);
    takeTurn(run, run.byId.get("mage"));
    const hero = run.byId.get("hero");
    expect(hero.conds.corroding).toBe(1);
    const hp = hero.hp;
    endOfTurn(run, hero);
    const left = run.log.find(e => e.type === "persistent" && e.actorId === "hero");
    expect(left).toMatchObject({ condition: "corroding", damageType: "acid" });
    expect(left.amount).toBeGreaterThanOrEqual(2);
    expect(left.amount).toBeLessThanOrEqual(8);
    expect(hero.hp).toBe(hp - left.amount);
    expect(hero.conds.corroding ?? 0).toBe(0);
  });

  test("corroding laid by anything else is the core's own (its harm by its value)", () => {
    expect(dnd5eRules.conditionHarm("corroding", 2, { effects: [{ sourceId: "gm", key: "gm:corroding", conditions: { corroding: 2 } }] }, { id: "gm", spec: {} })).toBeUndefined();
  });
});
