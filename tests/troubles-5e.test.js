/**
 * What lasts on a creature in 5e, as the core's own conditions and afflictions play it (its engine/conditions.js
 * PROFILES and behavior/afflictions.js): 2024's Contagion as a tallied affliction (three successes or three failures);
 * Burning (the SRD 5.2's hazard: 1d4 fire a turn, put out with an action) and the acid a spell leaves for the end of
 * its target's next turn, as the core's burning and corroding; and swallowed and engulfed (a purple worm's, a behir's,
 * a tarrasque's gullet; a gelatinous cube), as the SRD has them (inside.js).
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, prepareBattle, endOfTurn } from "../../FastFighting/scripts/engine/simulator.js";
import { remediesOf, holdsOf, tryHold, release } from "../../FastFighting/scripts/engine/behavior/holds.js";
import { Dnd5eAdapter, tallyFrom, tallied, plainText, setsAlight } from "../scripts/adapter.js";
import { dnd5eRules } from "../scripts/rules.js";
import { spitUp } from "../scripts/inside.js";
import { parseFormula, applyOutcome, cutOff, holderOf } from "../scripts/core.js";
import { levelOf } from "../../FastFighting/scripts/engine/behavior/desire.js";

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
    // (As the spell's save went, bySave: no roll of its own told as shrugging it off.)
    expect(run.log.filter(e => e.type === "afflictionSave")).toEqual([]);
    expect(run.log.some(e => e.type === "afflicted" && e.actorId === "hero")).toBe(true);
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

  test("in the engine: 1d4 fire at the start of its turn, none at its end; it puts the fire out with an action, and is Prone (2024), in place of the core's own way", () => {
    const run = fight([fighter("hero", "friendly", 0), fighter("orc", "hostile", 5)]);
    const hero = run.byId.get("hero");
    applyOutcome(hero, { conditions: { burning: 1 }, rounds: 10, label: "burning" }, "orc", { id: "orc.fire" });
    endOfTurn(run, hero);
    expect(run.log.some(e => e.type === "persistent" && e.actorId === "hero")).toBe(false);
    const remedies = remediesOf(run, hero);
    expect(remedies).toHaveLength(1);
    expect(remedies[0]).toMatchObject({ key: "dnd5e:burning", condition: "burning", type: "fire", annoyance: 60, cost: { action: 1 } });
    takeTurn(run, hero);
    const burnt = run.log.find(e => e.type === "persistent" && e.actorId === "hero");
    expect(burnt).toMatchObject({ condition: "burning", damageType: "fire" });
    expect(burnt.amount).toBeGreaterThanOrEqual(1);
    expect(burnt.amount).toBeLessThanOrEqual(4);
    expect(run.log.indexOf(burnt)).toBeLessThan(run.log.findIndex(e => e.actorId === "hero" && ["remedy", "attack", "move"].includes(e.type)));
    const fresh = fight([fighter("hero", "friendly", 0), fighter("orc", "hostile", 5)]);
    const other = fresh.byId.get("hero");
    applyOutcome(other, { conditions: { burning: 1 }, rounds: 10, label: "burning" }, "orc", { id: "orc.fire" });
    expect(remediesOf(fresh, other)[0].try(fresh, other)).toEqual({ success: true });
    expect(other.conds.burning ?? 0).toBe(0);
    expect(other.prone).toBe(true);
    expect(remediesOf(fresh, other)).toEqual([]);
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
    // (Nothing scrapes it off: no remedy of the core's for it here.)
    expect(remediesOf(run, hero)).toEqual([]);
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

/* Swallowed and engulfed ---------------------------------------------------- */

/* The SRD's words (5.1 and 5.2, CC-BY 4.0), as dnd5e's compendiums keep them. */
const WORM_BITE_2014 = "<p>[[/attack extended]]. [[/damage extended]]. If the target is a Large or smaller creature, it must succeed on a [[/save activity=swallow]] saving throw or be swallowed by the [[lookup @name lowercase]]{monster}. A swallowed creature is &amp;reference[blinded] and &amp;reference[restrained], it has &amp;reference[total cover] against attacks and other effects outside the [[lookup @name lowercase]]{monster}, and it takes [[/damage average activity=digest]] damage at the start of each of the [[lookup @name lowercase]]{monster}'s turns. If the [[lookup @name lowercase]]{monster} takes 30 damage or more on a single turn from a creature inside it, the [[lookup @name lowercase]]{monster} must succeed on a [[/save activity=spit]] saving throw at the end of that turn or regurgitate all swallowed creatures, which fall &amp;reference[prone] in a space within 10 feet of the [[lookup @name lowercase]]{monster}.</p>";
const BEHIR_SWALLOW_2014 = "<p>The [[lookup @name lowercase]]{monster} makes one [[/item .bite]]{Bite} attack against a Medium or smaller target it is &amp;reference[grappling]. If the attack hits, the target is also swallowed, and the grapple ends. While swallowed, the target is &amp;reference[blinded] and &amp;reference[restrained], it has &amp;reference[total cover] against attacks and other effects outside the [[lookup @name lowercase]]{monster}, and it takes [[/damage average activity=digest]] damage at the start of each of the [[lookup @name lowercase]]{monster}'s turns. If the [[lookup @name lowercase]]{monster} takes 30 damage or more on a single turn from the swallowed creature, the [[lookup @name lowercase]]{monster} must succeed on a [[/save activity=spit]] saving throw at the end of that turn or regurgitate the creature, which falls prone in a space within 10 feet of the [[lookup @name lowercase]]{monster}.</p>";
const SWALLOW_2024 = "<p>Strength Saving Throw: DC [[lookup @save.dc.value activity=swallow]], [[lookup @target.affects.special activity=swallow]] by the [[lookup @name lowercase]]{monster} (it can have up to three creatures swallowed at a time). Failure: The target is swallowed by the [[lookup @name lowercase]]{monster}, and the Grappled conditions end. A swallowed creature has the &amp;Reference[Blinded apply=false] and &amp;Reference[Restrained apply=false] conditions, has &amp;Reference[Total Cover] against attacks and other effects outside the [[lookup @name lowercase]]{monster}, and takes [[/damage average activity=digest]] damage at the start of each of the [[lookup @name lowercase]]{monster}'s turns. If the [[lookup @name lowercase]]{monster} takes 30 damage or more on a single turn from a creature inside it, the [[lookup @name lowercase]]{monster} must succeed on a [[/save format=long activity=spit]] at the end of that turn or regurgitate all swallowed creatures.</p>";
const CUBE_ENGULF_2014 = "<p>The [[lookup @name lowercase]]{monster} moves up to its speed. While doing so, it can enter Large or smaller creatures' spaces. Whenever the [[lookup @name lowercase]]{monster} enters a creature's space, the creature must make a [[/save activity=engulf]] saving throw. On a successful save, the creature can choose to be pushed 5 feet back or to the side of the [[lookup @name lowercase]]{monster}. A creature that chooses not to be pushed suffers the consequences of a failed saving throw. On a failed save, the [[lookup @name lowercase]]{monster} enters the creature's space, and the creature takes [[/damage average activity=engulf]] damage and is engulfed. The engulfed creature can't &amp;reference[suffocating]{Breathe}, is &amp;reference[restrained], and takes [[/damage average activity=digest]] damage at the start of each of the [[lookup @name lowercase]]{monster}'s turns. An engulfed creature can try to escape by taking an action to make a [[/check activity=escape]] check. On a success, the creature escapes and enters a space of its choice within 5 feet of the [[lookup @name lowercase]]{monster}.</p>";
const CUBE_ENGULF_2024 = "<p>The [[lookup @name lowercase]]{monster} moves up to its Speed without provoking Opportunity Attacks. Dexterity Saving Throw: DC [[lookup @save.dc.value activity=engulf]], each creature whose space the [[lookup @name lowercase]]{monster} enters for the first time during this move. Failure: [[/damage average]] damage, and the target is engulfed. An engulfed target is &amp;Reference[suffocating], has the &amp;Reference[Restrained apply=false] condition, and takes [[/damage average]] damage at the start of each of the [[lookup @name lowercase]]{monster}'s turns. An engulfed target can try to escape by taking an action to make a [[/check ability=str skill=ath dc=@abilities.str.dc]] check. On a successful check, the target escapes and enters the nearest unoccupied space. Success: Half damage, and the target moves to an unoccupied space within 5 feet of the [[lookup @name lowercase]]{monster}'s.</p>";

const gullet = (statuses = ["blinded", "restrained", "coverTotal"]) => effectOf("gullet", "Swallowed", statuses);
const spitAct = (dc, condition = "") => ({ id: "spit", type: "save", activation: { type: "special", condition }, save: { ability: new Set(["con"]), dc: { value: dc } }, damage: { parts: [] }, effects: [], range: {}, target: {}, getDamageConfig: rollsOf(null) });
const digestAct = (formula, activation = "special") => ({ id: "digest", type: "damage", activation: { type: activation }, range: {}, target: {}, effects: [], getDamageConfig: rollsOf(formula, "acid") });
const biteAct = (formula = "3d8 + 9") => ({ id: "atk", type: "attack", activation: { type: "action" }, attack: { type: { value: "melee" } }, labels: { modifier: "+14" }, range: { reach: 10, units: "ft" }, target: {}, effects: [], getDamageConfig: rollsOf(formula, "piercing") });

/** A 2014 purple worm's bite: its attack, the save that swallows on a hit, its digestion, and its save not to bring them up. */
const wormBite2014 = () => itemOf("weapon", "bite", "Bite", {
  activities: [
    biteAct(),
    { id: "swallow", type: "save", activation: { type: "special" }, save: { ability: new Set(["dex"]), dc: { value: 19 } }, damage: { onSave: "none", parts: [] }, effects: [{ _id: "gullet" }], range: {}, target: {}, getDamageConfig: rollsOf(null) },
    digestAct("6d6"), spitAct(21, "When the [[lookup @name lowercase]]{monster} takes 30 or more damage on a single turn form a swallowed creature.")
  ],
  effects: [gullet()], words: WORM_BITE_2014, system: { type: { value: "natural" }, equipped: true }
});
/** A 2014 swallow of a creature it's grappling (a behir's; a tarrasque's), its own bite making the attack. */
const swallow2014 = ({ digest = "6d6", dc = 14, condition = "When the [[lookup @name lowercase]]{monster} takes 30 or more damage on a single turn form a swallowed creature.", words = BEHIR_SWALLOW_2014 } = {}) => itemOf("feat", "swallow", "Swallow", {
  activities: [digestAct(digest), { id: "take", type: "utility", activation: { type: "action" }, range: { units: "touch" }, target: {}, effects: [{ _id: "gullet" }] }, spitAct(dc, condition)],
  effects: [gullet()], words
});
/** A 2024 swallow: a save (a bonus action) at one it's grappling, its digestion, and its save not to bring them up. */
const swallow2024 = ({ digest = "5d6", spitDC = 21 } = {}) => itemOf("feat", "swallow", "Swallow", {
  activities: [
    { id: "swallow", type: "save", activation: { type: "bonus" }, save: { ability: new Set(["str"]), dc: { value: 19 } }, damage: { onSave: "none", parts: [] }, effects: [{ _id: "gullet" }],
      range: { value: 0, units: "ft" }, target: { affects: { type: "creature", count: "1", special: "one Large or smaller creature Grappled" } }, getDamageConfig: rollsOf(null) },
    digestAct(digest, ""), { ...spitAct(spitDC), activation: { type: "" } }
  ],
  effects: [gullet(["coverTotal", "blinded", "restrained", "prone"])], words: SWALLOW_2024
});
/** A gelatinous cube's engulfing (2014 or 2024), and its Ooze Cube (a creature beside it can pull another out). */
function cube(edition) {
  const engulf = { id: "engulf", type: "save", activation: { type: "action" }, save: { ability: new Set(["dex"]), dc: { value: 12 } }, damage: { onSave: edition === 2014 ? "half" : "none", parts: [{}] },
    effects: [{ _id: "inside" }], range: edition === 2014 ? { units: "touch" } : { units: "self" }, target: {}, getDamageConfig: rollsOf("3d6", "acid") };
  const escape = { id: "escape", type: "check", activation: { type: "" }, check: edition === 2014 ? { ability: "str", associated: [], dc: { value: 12, formula: "12" } } : { ability: "", associated: new Set(["ath"]), dc: { value: 12, calculation: "str" } }, effects: [], range: {}, target: {} };
  const activities = edition === 2014 ? [escape, digestAct("6d6", "turnStart"), engulf] : [engulf, escape];
  const item = itemOf("feat", "engulf", "Engulf", { activities, effects: [effectOf("inside", "Engulfed", edition === 2014 ? ["restrained", "suffocation"] : ["coverTotal", "restrained", "suffocation"])], words: edition === 2014 ? CUBE_ENGULF_2014 : CUBE_ENGULF_2024 });
  const ooze = itemOf("feat", "ooze-cube", "Ooze Cube", { activities: [{ id: "pull", type: "check", activation: { type: "special" }, check: { ability: "str", associated: [], dc: { value: 12 } }, effects: [], range: {}, target: {} }] });
  return [item, ooze];
}

describe("swallowed and engulfed: what the adapter reads", () => {
  test("a purple worm's bite (2014): a save on its hit swallows a Large or smaller creature; its digestion and its save not to bring it up go on its spec", async () => {
    const spec = await specOf(actorOf({ creature: "monstrosity", size: "grg", items: [wormBite2014()] }));
    const actions = spec.actions.filter(a => a.itemId === "bite");
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "strike", melee: true });
    expect(actions[0].effects).toEqual([expect.objectContaining({ kind: "save", save: { type: "dex", dc: 19, basic: false }, conditions: { swallowed: 1 }, rounds: 100, maxSize: 3 })]);
    expect(actions[0].effects[0].label).toBeTruthy();
    expect(spec.inside).toEqual({ key: "swallowed", harm: [expect.objectContaining({ dice: [{ n: 6, faces: 6 }], type: "acid" })], spit: { after: 30, save: { type: "con", dc: 21 } } });
  });

  test("a behir's swallow (2014): its bite's attack, swallowing on a hit a Medium or smaller creature it's grappling", async () => {
    const bite = itemOf("weapon", "bite", "Bite", { activities: [biteAct("3d10 + 6")], system: { type: { value: "natural" }, equipped: true } });
    const spec = await specOf(actorOf({ creature: "monstrosity", size: "huge", items: [bite, swallow2014()] }));
    const [swallow] = spec.actions.filter(a => a.itemId === "swallow");
    expect(swallow).toMatchObject({ kind: "control", melee: true, bonus: 14, grappledOnly: true, requires: { holding: true } });
    expect(swallow.damage).toEqual([expect.objectContaining({ dice: [{ n: 3, faces: 10 }], flat: 6, type: "piercing" })]);
    expect(swallow.onHit.slice(0, 2)).toEqual([null, null]);
    expect(swallow.onHit[2]).toMatchObject({ conditions: { swallowed: 1 }, rounds: 100, maxSize: 2 });
    expect(spec.inside).toMatchObject({ key: "swallowed", spit: { after: 30, save: { type: "con", dc: 14 } } });
    // (Its own bite stays an attack of its own.)
    expect(spec.actions.filter(a => a.itemId === "bite").map(a => a.kind)).toEqual(["strike"]);
  });

  test("a tarrasque's swallow (2014): how much brings it up, from the save's own words before the trait's", async () => {
    const bite = itemOf("weapon", "bite", "Bite", { activities: [biteAct("4d12 + 10")], system: { type: { value: "natural" }, equipped: true } });
    const swallow = swallow2014({ digest: "16d6", dc: 20, condition: "When the [[lookup @name lowercase]]{monster} takes 60 or more damage on a single turn form a swallowed creature." });
    const spec = await specOf(actorOf({ creature: "monstrosity", size: "grg", items: [bite, swallow] }));
    expect(spec.inside).toMatchObject({ key: "swallowed", harm: [expect.objectContaining({ dice: [{ n: 16, faces: 6 }] })], spit: { after: 60, save: { type: "con", dc: 20 } } });
  });

  test("a 2024 swallow: a bonus action's save at a Large or smaller creature it's grappling", async () => {
    const spec = await specOf(actorOf({ creature: "monstrosity", size: "grg", items: [swallow2024()] }));
    const actions = spec.actions.filter(a => a.itemId === "swallow");
    expect(actions).toHaveLength(1);
    const [swallow] = actions;
    expect(swallow).toMatchObject({ kind: "control", economy: "bonus", melee: true, reach: 5, save: { type: "str", dc: 19 }, grappledOnly: true, effectRef: { uuid: "Item.swallow", ids: ["gullet"] } });
    expect(swallow.onSave[1]).toMatchObject({ conditions: { swallowed: 1 }, maxSize: 3 });
    expect(swallow.onSave.slice(2)).toEqual([null, null]);
    expect(spec.inside).toMatchObject({ key: "swallowed", harm: [expect.objectContaining({ dice: [{ n: 5, faces: 6 }], type: "acid" })], spit: { after: 30, save: { type: "con", dc: 21 } } });
  });

  test("a gelatinous cube (2014): engulfed on a failed save (its acid, halved on a success), pushed clear on a success; out with a DC 12 Strength check, a friend beside it too", async () => {
    const spec = await specOf(actorOf({ creature: "ooze", size: "lg", items: cube(2014) }));
    const [engulf] = spec.actions.filter(a => a.itemId === "engulf");
    expect(engulf).toMatchObject({ kind: "control", melee: true, save: { type: "dex", dc: 12, basic: true } });
    expect(engulf.damage).toEqual([expect.objectContaining({ dice: [{ n: 3, faces: 6 }], type: "acid" })]);
    expect(engulf.onSave[1]).toMatchObject({ conditions: { engulfed: 1 }, maxSize: 3, escape: { dc: 12, others: "check", checks: [{ ability: "str", skill: null }] } });
    expect(engulf.onSave[2]).toEqual({ move: { kind: "push", feet: 5 } });
    expect(engulf.grappledOnly).toBeUndefined();
    expect(engulf.requires).toBeUndefined();
    expect(spec.inside).toMatchObject({ key: "engulfed", harm: [expect.objectContaining({ dice: [{ n: 6, faces: 6 }] })], escape: true });
    expect(spec.inside.spit).toBeUndefined();
  });

  test("a gelatinous cube (2024): its engulfing's own acid each turn, out with a DC 12 Strength (Athletics) check", async () => {
    const spec = await specOf(actorOf({ creature: "ooze", size: "lg", items: cube(2024) }));
    const [engulf] = spec.actions.filter(a => a.itemId === "engulf");
    expect(engulf.onSave[1].escape).toEqual({ dc: 12, others: "check", checks: [{ ability: "str", skill: "ath" }] });
    expect(engulf.onSave[2]).toEqual({ move: { kind: "push", feet: 5 } });
    expect(spec.inside.harm).toEqual([expect.objectContaining({ dice: [{ n: 3, faces: 6 }], type: "acid" })]);
  });

  test("nothing else is a swallow: a bite with an ordinary grapple, a web's restraint", async () => {
    const grip = itemOf("weapon", "bite", "Bite", { activities: [{ ...biteAct(), effects: [{ _id: "grip" }] }], effects: [effectOf("grip", "Grappled", ["grappled", "restrained"])], system: { type: { value: "natural" }, equipped: true } });
    expect((await specOf(actorOf({ items: [grip] }))).inside).toBeUndefined();
  });
});

describe("swallowed and engulfed: what the rules say", () => {
  const unit = (id, conds = {}, effects = [], spec = {}) => ({ id, conds, effects, spec: { defenses: saves(0), ...spec }, adjacent: new Set(), pos: null });
  const runOf = units => ({ byId: new Map(units.map(u => [u.id, u])), units, prep: { rules: dnd5eRules } });
  const inWorm = (id, worm) => unit(id, { swallowed: 1 }, [{ key: "bite", sourceId: worm.id, conditions: { swallowed: 1 } }]);

  test("Total Cover (the core's): none outside goes for one inside, and it goes for none but its holder (and another inside with it)", () => {
    const worm = unit("worm");
    const hero = inWorm("hero", worm);
    const friend = inWorm("friend", worm);
    const orc = unit("orc");
    const run = runOf([worm, hero, friend, orc]);
    expect(holderOf(run, hero)).toBe(worm);
    expect([cutOff(run, orc, hero), cutOff(run, worm, hero), cutOff(run, hero, orc)]).toEqual([true, true, true]);
    expect([cutOff(run, hero, worm), cutOff(run, hero, friend), cutOff(run, orc, worm)]).toEqual([false, false, false]);
  });

  test("Blinded and Restrained in a gullet, Restrained in an ooze: its attacks at Disadvantage, its Dexterity saves too", () => {
    const worm = unit("worm");
    const hero = { ...inWorm("hero", worm), prone: false };
    const foe = { ...unit("foe"), prone: false };
    const plain = dnd5eRules.modifiers.attack({ attacker: foe, target: foe, action: { melee: true }, distance: 5 });
    expect(plain.advantage).toBe(0);
    expect(dnd5eRules.modifiers.attack({ attacker: hero, target: foe, action: { melee: true }, distance: 5 }).advantage).toBe(-1);
    expect(dnd5eRules.modifiers.save({ unit: hero, type: "dex" }).advantage).toBe(-1);
    expect(dnd5eRules.modifiers.save({ unit: { ...unit("x", { engulfed: 1 }) }, type: "dex" }).advantage).toBe(-1);
    expect(dnd5eRules.modifiers.exposed({ target: hero, action: { melee: true }, distance: 5 })).toBe(true);
  });

  test("a gullet's hold: nothing breaks it, its own try or a friend's, in the core's own's place; an ooze's is its escape's", () => {
    const worm = unit("worm", {}, [], { inside: { key: "swallowed" } });
    const hero = inWorm("hero", worm);
    expect(dnd5eRules.holds(runOf([worm, hero]), hero)).toEqual([{ key: "swallowed", byId: "worm", dc: null, others: null, friendOnly: true }]);
    expect(dnd5eRules.holds(runOf([worm, unit("orc")]), unit("orc"))).toEqual([]);
  });

  test("its harm: its holder's own; one with none says, the core's", () => {
    const worm = { id: "worm", spec: { inside: { key: "swallowed", harm: [parseFormula("6d6", "acid")] } } };
    expect(dnd5eRules.conditionHarm("swallowed", 1, { effects: [] }, worm)).toBe(worm.spec.inside.harm);
    expect(dnd5eRules.conditionHarm("engulfed", 1, { effects: [] }, worm)).toBeUndefined();
    expect(dnd5eRules.conditionHarm("swallowed", 1, { effects: [] }, { id: "gm", spec: {} })).toBeUndefined();
  });

  test("brought up: so much from inside on one turn, and the holder's save failed; once a turn", () => {
    const rng = { d20: () => 10, chance: () => false, die: () => 1, next: () => 0.5 };
    const worm = unit("worm", {}, [], { inside: { key: "swallowed", spit: { after: 30, save: { type: "con", dc: 21 } } }, defenses: saves(0) });
    const hero = inWorm("hero", worm);
    hero.spec.name = "Hero";
    const run = { ...runOf([worm, hero]), round: 1, turn: 2, rng };
    expect(spitUp(run, worm, 20, rng, hero)).toBeNull();
    const said = spitUp(run, worm, 15, rng, hero);
    expect(said.text).toBeTruthy();
    expect(hero.conds.swallowed ?? 0).toBe(0);
    expect(hero.prone).toBe(true);
    // (Not from outside; not when it isn't the holder's.)
    const other = inWorm("other", worm);
    const outside = { ...runOf([worm, other, unit("orc")]), round: 1, turn: 3, rng };
    expect(spitUp(outside, worm, 50, rng, outside.units[2])).toBeNull();
    expect(other.conds.swallowed).toBe(1);
  });

  test("a swallow of a creature it's grappling: only one in its grip", () => {
    const worm = unit("worm");
    const action = { kind: "control", grappledOnly: true };
    expect(dnd5eRules.usable(null, worm, action, { grabbedBy: "worm" })).toBe(true);
    expect(dnd5eRules.usable(null, worm, action, { grabbedBy: null })).toBe(false);
    expect(dnd5eRules.usable(null, worm, { kind: "control" }, { grabbedBy: null })).toBe(true);
  });
});

describe("swallowed and engulfed, in the engine", () => {
  /** A purple worm (2014's bite) and its spec's swallowing. */
  const wormOf = async (over = {}) => {
    const spec = await specOf(actorOf({ creature: "monstrosity", size: "grg", items: [wormBite2014()] }));
    const [bite] = spec.actions.filter(a => a.itemId === "bite");
    return fighter("worm", "hostile", 0, { size: 5, actions: [{ ...bite, bonus: 50 }], inside: spec.inside, hp: { value: 200, max: 200, temp: 0 }, ...over });
  };
  const frail = { defenses: saves(-30) };

  test("bitten, a failed save: swallowed, out of everyone's reach but its holder's, 6d6 acid at the start of its turn (not the end), no penalty of the core's on top", async () => {
    const run = fight([await wormOf(), fighter("hero", "friendly", 5, frail), fighter("orc", "hostile", 10)]);
    const [worm, hero, orc] = ["worm", "hero", "orc"].map(id => run.byId.get(id));
    takeTurn(run, worm);
    expect(hero.conds.swallowed).toBe(1);
    expect(holderOf(run, hero)).toBe(worm);
    expect(cutOff(run, orc, hero)).toBe(true);
    expect(hero.mods?.attack ?? 0).toBe(0);
    endOfTurn(run, hero);
    expect(run.log.some(e => e.type === "persistent" && e.actorId === "hero")).toBe(false);
    const before = hero.hp;
    takeTurn(run, hero);
    const acid = run.log.find(e => e.type === "persistent" && e.actorId === "hero");
    expect(acid).toMatchObject({ condition: "swallowed", damageType: "acid" });
    expect(acid.amount).toBeGreaterThanOrEqual(6);
    expect(acid.amount).toBeLessThanOrEqual(36);
    expect(hero.hp).toBe(before - acid.amount);
  });

  test("inside, it goes for its holder, where its holder now is; 30 from it in a turn, and a failed save brings it up, Prone", async () => {
    const hard = { id: "hero.fist", name: "Fist", kind: "strike", bonus: 50, melee: true, reach: 5, damage: [parseFormula("40", "bludgeoning")], hands: 0 };
    const run = fight([await wormOf({ defenses: saves(-30) }), fighter("hero", "friendly", 5, { ...frail, actions: [hard] })]);
    const [worm, hero] = ["worm", "hero"].map(id => run.byId.get(id));
    takeTurn(run, worm);
    expect(hero.conds.swallowed).toBe(1);
    worm.pos = { x: -20, y: 0 };
    takeTurn(run, hero);
    expect(run.log.find(e => e.type === "attack" && e.actorId === "hero")).toMatchObject({ targetId: "worm" });
    expect(hero.pos).toEqual({ x: -20, y: 0 });
    expect(run.log.find(e => e.type === "endure" && e.actorId === "worm")?.text).toBeTruthy();
    expect(hero.conds.swallowed ?? 0).toBe(0);
    expect(hero.prone).toBe(true);
  });

  test("its holder's save made, it stays down; its holder falls, and it's let go", async () => {
    const hard = { id: "hero.fist", name: "Fist", kind: "strike", bonus: 50, melee: true, reach: 5, damage: [parseFormula("40", "bludgeoning")], hands: 0 };
    const run = fight([await wormOf({ defenses: saves(50), hp: { value: 60, max: 60, temp: 0 } }), fighter("hero", "friendly", 5, { ...frail, actions: [hard] })]);
    const [worm, hero] = ["worm", "hero"].map(id => run.byId.get(id));
    takeTurn(run, worm);
    takeTurn(run, hero);
    expect(run.log.find(e => e.type === "endure" && e.actorId === "worm")?.text).toBeTruthy();
    expect(hero.conds.swallowed).toBe(1);
    takeTurn(run, hero);
    expect(worm.status).not.toBe("standing");
    expect(hero.conds.swallowed ?? 0).toBe(0);
    // (Out of the corpse, Prone.)
    expect(hero.prone).toBe(true);
  });

  test("a gelatinous cube: engulfed on a failed save, out again with an action and a DC 12 Strength check; a save made, pushed clear", async () => {
    const spec = await specOf(actorOf({ creature: "ooze", size: "lg", items: cube(2014) }));
    const [engulf] = spec.actions.filter(a => a.itemId === "engulf");
    const cubeOf = () => fighter("cube", "hostile", 0, { actions: [engulf], inside: spec.inside });
    const run = fight([cubeOf(), fighter("hero", "friendly", 5, { defenses: saves(-30), escapeWork: { mod: 30, ath: 30, acr: 0, str: 30, dex: 0 } })]);
    const hero = run.byId.get("hero");
    takeTurn(run, run.byId.get("cube"));
    expect(hero.conds.engulfed).toBe(1);
    const [hold] = holdsOf(run, hero);
    expect(hold).toMatchObject({ key: "engulfed", byId: "cube", dc: 12, others: "check" });
    const got = tryHold(run, hero, hold);
    expect(got).toMatchObject({ success: true, dc: 12 });
    release(run, hero, hold);
    expect(hero.conds.engulfed ?? 0).toBe(0);
    const clear = fight([cubeOf(), fighter("hero", "friendly", 5, { defenses: saves(50) })]);
    takeTurn(clear, clear.byId.get("cube"));
    expect(clear.byId.get("hero").conds.engulfed ?? 0).toBe(0);
    expect(clear.log.find(e => e.type === "forced" && e.targetId === "hero")).toMatchObject({ how: "push", feet: 5 });
  });

  test("a 2024 swallow goes only for one in its grip", async () => {
    const spec = await specOf(actorOf({ creature: "monstrosity", size: "grg", items: [swallow2024()] }));
    const [swallow] = spec.actions.filter(a => a.itemId === "swallow");
    const run = fight([fighter("worm", "hostile", 0, { size: 5, actions: [swallow], inside: spec.inside }), fighter("hero", "friendly", 5, frail)]);
    const [worm, hero] = ["worm", "hero"].map(id => run.byId.get(id));
    takeTurn(run, worm);
    expect(hero.conds.swallowed ?? 0).toBe(0);
    hero.grabbedBy = "worm";
    takeTurn(run, worm);
    expect(hero.conds.swallowed).toBe(1);
    // (Its grapple over once it's inside: the core's.)
    expect(hero.grabbedBy).toBeNull();
  });

  test("a 2014 behir swallows the one it's grappling, rather than bite a weaker foe beside it (the core's opening)", async () => {
    const bite = itemOf("weapon", "bite", "Bite", { activities: [biteAct("3d10 + 6")], system: { type: { value: "natural" }, equipped: true } });
    const spec = await specOf(actorOf({ creature: "monstrosity", size: "huge", items: [bite, swallow2014()] }));
    let swallowed = 0;
    for ( let seed = 1; seed <= 6; seed++ ) {
      const run = fight([fighter("behir", "hostile", 0, { size: 3, actions: spec.actions, inside: spec.inside, hp: { value: 160, max: 160, temp: 0 } }),
        fighter("hero", "friendly", 10), fighter("archer", "friendly", 10, { position: { x: 5, y: 10, size: 5 }, hp: { value: 20, max: 60, temp: 0 } })], seed);
      const [behir, hero, archer] = ["behir", "hero", "archer"].map(id => run.byId.get(id));
      hero.grabbedBy = "behir";
      for ( const o of [hero, archer] ) {
        behir.adjacent.add(o.id);
        o.adjacent.add(behir.id);
      }
      takeTurn(run, behir);
      expect(run.log.some(e => e.actorId === "behir" && e.targetId === "archer")).toBe(false);
      if ( (hero.conds.swallowed ?? 0) > 0 ) swallowed++;
    }
    expect(swallowed).toBeGreaterThan(3);
  });
});

describe("healing that goes on, in a fight", () => {
  test("Regenerate's hit point a turn lands with its heal (the core lays a heal's outcome)", () => {
    const regenerate = { id: "cleric.regen", name: "Regenerate", kind: "heal", cost: 1, heal: [parseFormula("4d8 + 15", "healing")], reach: 5, outcome: { fastHealing: 1, rounds: 600, label: "Regenerating" } };
    const run = fight([fighter("cleric", "friendly", 0, { actions: [fist("cleric"), regenerate], hp: { value: 20, max: 80, temp: 0 } }), fighter("orc", "hostile", 30)]);
    const cleric = run.byId.get("cleric");
    takeTurn(run, cleric);
    expect(run.log.find(e => e.type === "heal" && e.actorId === "cleric")).toMatchObject({ action: "Regenerate" });
    expect(cleric.fxHealing).toBe(1);
  });
});

describe("fear, as 5e has it (the core's conditionWishes)", () => {
  test("Frightened: it can't come any closer to what frightens it, so it keeps away from it, however bold; on or off, the core building how bad it's got", () => {
    const by = { id: "dragon" };
    expect(dnd5eRules.conditionWishes(null, {}, { key: "frightened", value: 1, by })).toEqual([{ kind: "avoid", targetId: "dragon", level: 60 }]);
    expect(dnd5eRules.conditionWishes(null, {}, { key: "frightened", value: 1, by: null })).toEqual([]);
    expect(dnd5eRules.conditionWishes(null, {}, { key: "poisoned", value: 1, by })).toBeNull();
    expect(dnd5eRules.fearValued).toBeUndefined();
    const run = fight([fighter("hero", "friendly", 0), fighter("orc", "hostile", 30)]);
    const [hero, orc] = ["hero", "orc"].map(id => run.byId.get(id));
    applyOutcome(hero, { conditions: { frightened: 1 }, rounds: 5, label: "" }, "orc", { id: "orc.roar" });
    takeTurn(run, hero);
    expect(levelOf(hero, "avoid", orc.id)).toBeGreaterThanOrEqual(60);
    expect(run.log.some(e => e.type === "flee" && e.actorId === "hero")).toBe(false);
  });
});
