/**
 * Breaking free in 5e (holds.js, and the adapter's specs): a grapple's escape (Athletics or Acrobatics against the
 * grappler's escape DC, 2024's 8 + Strength + proficiency or 2014's contest as 10 + Athletics), what webs, plants and
 * nets say breaks them, FastFighting's bonds as rope, each try an action; and the free hands each action needs.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { beginRun, beginRound, takeTurn, prepareBattle } from "../../FastFighting/scripts/engine/simulator.js";
import { holdsOf, tryHold, release } from "../../FastFighting/scripts/engine/behavior/holds.js";
import { Dnd5eAdapter } from "../scripts/adapter.js";
import { dnd5eRules } from "../scripts/rules.js";
import { escapeWords, grabEscapeDC, escapeFrom, bondsDC, breakFree } from "../scripts/holds.js";
import { parseFormula, applyOutcome } from "../scripts/core.js";

/* The SRD's words (5.1 and 5.2, CC-BY 4.0), as dnd5e's compendiums keep them. */
const WEB_2014 = "<p>On a failed save, the creature is &amp;reference[Restrained] as long as it remains in the webs or until it breaks free.</p><p>A creature Restrained by the webs can use its action to make a Strength check against your spell save DC. If it succeeds, it is no longer Restrained.</p>";
const WEB_2024 = "<p>The first time a creature enters the webs on a turn or starts its turn there, it must succeed on a Dexterity saving throw or have the &amp;Reference[restrained] condition while in the webs or until it breaks free.</p><p>A creature Restrained by the webs can take an action to make a [[/check ability=str skill=ath dc=@attributes.spell.dc]] check against your spell save DC. If it succeeds, it is no longer Restrained.</p>";
const ENTANGLE_2014 = "<p>A creature restrained by the plants can use its action to make a Strength check against your spell save DC. On a success, it frees itself.</p>";
const NET_2014 = "<p>A creature can use its action to make a DC 10 Strength check, freeing itself or another creature within its reach on a success.</p>";
const NET_2024 = "<p>The target must succeed on a Dexterity saving throw (DC 8 plus your Dexterity modifier and Proficiency Bonus) or have the &amp;Reference[Restrained] condition until it escapes.</p><p>To escape, the target or a creature within 5 feet of it must take an action to make a [[/skill ath 10]] check, freeing the Restrained creature on a success.</p>";
const PHANTASM = "<p>A creature can use its action to examine the phantasm with an Intelligence (Investigation) check against your spell save DC.</p>";

describe("what breaks a hold, by its words", () => {
  test("webs and plants: an action and a Strength check (2024: Strength (Athletics)) against the spell's save DC", () => {
    expect(escapeWords(WEB_2014, { dc: 14 })).toEqual({ dc: 14, others: null, checks: [{ ability: "str", skill: null }] });
    expect(escapeWords(WEB_2024, { dc: 14 })).toEqual({ dc: 14, others: null, checks: [{ ability: "str", skill: "ath" }] });
    expect(escapeWords(ENTANGLE_2014, { dc: 13 })).toEqual({ dc: 13, others: null, checks: [{ ability: "str", skill: null }] });
  });

  test("a net: DC 10, by the one caught in it or anyone beside it", () => {
    expect(escapeWords(NET_2014, { dc: 12 })).toEqual({ dc: 10, others: "check", checks: [{ ability: "str", skill: null }] });
    expect(escapeWords(NET_2024, { dc: 12 })).toEqual({ dc: 10, others: "check", checks: [{ ability: "str", skill: "ath" }] });
  });

  test("a check that frees no one isn't a way out", () => {
    expect(escapeWords(PHANTASM, { dc: 13 })).toBeNull();
    expect(escapeWords("<p>A creature can take an action to make a [[/check ability=wis skill=ins dc=15]] check. On a success, it frees itself.</p>")).toBeNull();
  });

  test("a grab's escape DC: as its words give it (2014), or the creature's own number dnd5e looks up (2024)", () => {
    expect(grabEscapeDC("<p>Hit: 4 (1d6 + 1) bludgeoning damage, and the target is &amp;Reference[grappled] (escape DC 11).</p>")).toBe(11);
    const lookup = path => ({ "skills.ath.passive": 16 })[path];
    expect(grabEscapeDC("<p>it has the &amp;Reference[Grappled apply=false] condition (escape DC [[lookup @skills.ath.passive]]) from one of four tentacles.</p>", lookup)).toBe(16);
    expect(grabEscapeDC("<p>Hit: 7 (1d8 + 3) piercing damage.</p>")).toBeNull();
  });
});

/** Foundry's Roll.replaceFormulaData, as far as these tests need it. */
const replaceFormulaData = (formula, data) => String(formula).replace(/@([a-z.0-9_-]+)/gi, (m, term) => String(term.split(".").reduce((o, k) => o?.[k], data) ?? 0));
const listOf = list => Object.assign(list, { get: id => list.find(i => i.id === id), getName: name => list.find(i => i.name === name) });
const item = (type, identifier, name, system = {}) => ({ id: identifier, type, name, identifier, flags: {}, effects: [], system: { identifier, activities: [], ...system } });
/** An attack activity: a hit for 1d8 + 3. */
const attack = (id = "atk", melee = true) => ({ id, type: "attack", activation: { type: "action" }, attack: { type: { value: melee ? "melee" : "ranged" } }, labels: { modifier: "+5" }, range: {}, target: {},
  getDamageConfig: () => ({ rolls: [{ parts: ["1d8 + 3"], options: { types: ["slashing"] } }] }) });
const weapon = (identifier, { type = "martialM", props = [], activities = [attack()] } = {}) => item("weapon", identifier, identifier, { type: { value: type }, properties: new Set(props), activities, equipped: true, range: {} });
const spell = (identifier, props, { activities = [attack()], description = "", level = 0 } = {}) => item("spell", identifier, identifier, { level, properties: new Set(props), activities, range: {}, duration: {}, description: { value: description } });

/** An actor as dnd5e prepares one, with only what these tests look at. */
function actorOf({ type = "npc", creature = "humanoid", str = 0, dex = 0, ath = 1, acr = 0, athPassive = 11, cr = 1, items = [] } = {}) {
  return {
    id: "actor", uuid: "Actor.actor", type, name: "actor", img: "", flags: {}, statuses: new Set(), appliedEffects: [], classes: {},
    items: listOf(items), getRollData: () => ({ skills: { ath: { passive: athPassive } } }), toObject() { return { name: this.name }; },
    system: {
      abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(k => [k, { value: 10, mod: { str, dex }[k] ?? 0, save: 0 }])),
      attributes: { hp: { value: 20, max: 20, temp: 0 }, ac: { value: 12 }, movement: { walk: 30, units: "ft" }, senses: {}, death: {}, spell: { dc: 14 } },
      details: { cr, level: cr, type: { value: creature } },
      skills: { ath: { total: ath, passive: athPassive }, acr: { total: acr, passive: 10 + acr }, ste: { total: 1 }, prc: { total: 1, passive: 11 }, ins: { total: 1, passive: 11 } },
      traits: { size: "med", languages: { value: new Set() }, di: {}, dr: {}, dv: {}, ci: {} },
      resources: {}, currency: {}, spells: {}
    }
  };
}
const specOf = actor => new Dnd5eAdapter().toCombatantSpec({ id: "token", name: actor.name, actor });
const legacyWorld = () => { globalThis.game.settings = { get: (ns, key) => (ns === "dnd5e" && key === "rulesVersion" ? "legacy" : undefined) }; };

beforeEach(() => { globalThis.Roll = { replaceFormulaData }; });
afterEach(() => { delete globalThis.Roll; });

describe("the adapter's specs", () => {
  test("its ways out: Athletics and Acrobatics (the better, for a grapple), Strength and Dexterity checks on their own", async () => {
    const spec = await specOf(actorOf({ str: 3, dex: 1, ath: 5, acr: 6 }));
    expect(spec.escapeWork).toEqual({ mod: 6, ath: 5, acr: 6, str: 3, dex: 1 });
    expect(spec.rulesVersion).toBe("modern");
  });

  test("its own grab's escape DC: 2024, 8 + Strength + proficiency; 2014, 10 + its Athletics (its passive Athletics)", async () => {
    expect((await specOf(actorOf({ str: 3, cr: 5 }))).escapeDC).toBe(8 + 3 + 3);
    legacyWorld();
    const old = await specOf(actorOf({ str: 3, ath: 5, athPassive: 15 }));
    expect([old.escapeDC, old.rulesVersion]).toEqual([15, "legacy"]);
  });

  test("a grab that gives its escape DC (2014's words, 2024's lookup) has it", async () => {
    const claw = weapon("claw", { type: "natural" });
    claw.system.description = { value: "<p>the target is &amp;Reference[grappled] (escape DC 13).</p>" };
    expect((await specOf(actorOf({ str: 0, items: [claw] }))).escapeDC).toBe(13);
    const tentacle = weapon("tentacle", { type: "natural" });
    tentacle.system.description = { value: "<p>the &amp;Reference[Grappled apply=false] condition (escape DC [[lookup @skills.ath.passive]])</p>" };
    expect((await specOf(actorOf({ athPassive: 18, items: [tentacle] }))).escapeDC).toBe(18);
  });

  test("webs (the 2024 spell, read from its words) restrain, an action and a Strength (Athletics) check breaking them", async () => {
    const save = { id: "cast", type: "save", activation: { type: "action" }, save: { ability: new Set(["dex"]), dc: { value: 14 } }, damage: { parts: [] }, effects: [], range: {}, target: {} };
    const web = spell("web", ["vocal", "somatic", "material", "concentration"], { activities: [save], description: WEB_2024, level: 2 });
    const action = (await specOf(actorOf({ items: [web] }))).actions.find(a => a.itemId === "web");
    expect(action.kind).toBe("control");
    expect(action.onSave[0]).toMatchObject({ conditions: { restrained: 1 }, escape: { dc: 14, others: null, checks: [{ ability: "str", skill: "ath" }] } });
  });
});

describe("free hands", () => {
  test("a weapon one (two-handed two); a bite none, claws none (a creature's own body), a fist one; an unarmed strike none; a spell one with S or M, else none", async () => {
    const items = [
      weapon("scimitar"), weapon("greataxe", { props: ["hvy", "two"] }), weapon("bite", { type: "natural" }), weapon("claws", { type: "natural" }), weapon("fist", { type: "natural" }),
      weapon("unarmed-strike", { type: "simpleM" }),
      spell("vicious-mockery", ["vocal"]), spell("fire-bolt", ["vocal", "somatic"]), spell("produce-flame", ["vocal", "material"])
    ];
    const actions = (await specOf(actorOf({ items }))).actions;
    const hands = id => actions.find(a => a.itemId === id).hands;
    expect(["scimitar", "greataxe", "bite", "claws", "fist", "unarmed-strike", "vicious-mockery", "fire-bolt", "produce-flame"].map(hands)).toEqual([1, 2, 0, 0, 1, 0, 0, 1, 1]);
    // (What anyone can do needs none, but a grapple takes a free hand.)
    const named = id => actions.find(a => a.id === `actor.${id}`).hands;
    expect(["dodge", "shove", "grapple", "help"].map(named)).toEqual([0, 0, 1, 0]);
    expect(actions.every(a => Number.isInteger(a.hands))).toBe(true);
    expect(dnd5eRules.handsKnown).toBe(true);
  });

  test("a Multiattack needs what its most demanding strike does", async () => {
    const multi = item("feat", "multiattack", "Multiattack", { description: { value: "<p>The ogre makes two attacks: one with its bite and one with its fist.</p>" } });
    const bite = weapon("bite", { type: "natural" });
    const claws = weapon("fist", { type: "natural" });
    Object.assign(bite, { name: "Bite" });
    Object.assign(claws, { name: "Fist" });
    const actions = (await specOf(actorOf({ creature: "beast", items: [bite, claws, multi] }))).actions;
    const ma = actions.find(a => a.id === "actor.multiattack");
    expect(ma.sequence.map(s => s.hands)).toEqual([0, 1]);
    expect(ma.hands).toBe(1);
  });
});

/* The rules' say, on its own ------------------------------------------- */

/** Dice that come up as told, in turn (the last over and over). */
const dice = (...rolls) => ({ die: () => (rolls.length > 1 ? rolls.shift() : rolls[0]) });
const unit = (id, side, spec = {}, extra = {}) => ({ id, side, status: "standing", conds: {}, effects: [], adjacent: new Set(), spec: { level: 1, escapeWork: { mod: 2, ath: 2, acr: 0, str: 1, dex: 0 }, ...spec }, ...extra });
function runOf(units, rng = dice(10)) {
  const sides = { friendly: { enemies: new Set(["hostile"]) }, hostile: { enemies: new Set(["friendly"]) } };
  return { prep: { rules: dnd5eRules, sides }, rng, units, byId: new Map(units.map(u => [u.id, u])) };
}

describe("the rules' say", () => {
  test("grappled on its sheet: the hardest grab among the foes beside it, else a typical DC for its level; restrained, it can't tell", () => {
    const hero = unit("hero", "friendly", { level: 5 });
    const ogre = unit("ogre", "hostile", { escapeDC: 15 });
    const imp = unit("imp", "hostile", { escapeDC: 11 });
    const pal = unit("pal", "friendly", { escapeDC: 19 });
    hero.adjacent = new Set(["ogre", "imp", "pal"]);
    const run = runOf([hero, ogre, imp, pal]);
    expect(escapeFrom(run, hero, "grabbed")).toEqual({ dc: 15, others: null });
    hero.adjacent = new Set();
    expect(escapeFrom(run, hero, "grabbed")).toEqual({ dc: 10 + 3, others: null });
    expect(escapeFrom(run, hero, "restrained")).toBeNull();
  });

  test("bonds, as rope: 2024, slipped at DC 15; 2014, burst at DC 17", () => {
    expect(bondsDC(unit("a", "friendly"))).toBe(15);
    expect(bondsDC(unit("a", "friendly", { rulesVersion: "legacy" }))).toBe(17);
  });

  test("each try an action, and freeing a friend too", () => {
    expect(dnd5eRules.escapeCost(unit("a", "friendly"), { key: "grabbed" })).toEqual({ action: 1 });
    expect(dnd5eRules.untieCost(unit("a", "friendly"), unit("b", "friendly"), { key: "bound" })).toEqual({ action: 1 });
  });

  test("bonds: 2024, Acrobatics against 15 or Athletics against 20, whichever it's likelier to pass; 2014, Strength against 17", () => {
    const nimble = unit("a", "friendly", { escapeWork: { mod: 6, ath: 2, acr: 6, str: 1, dex: 4 } });
    expect(breakFree(runOf([nimble], dice(9)), nimble, { key: "bound", dc: 15 })).toMatchObject({ success: true, mod: 6, total: 15, dc: 15 });
    const strong = unit("b", "friendly", { escapeWork: { mod: 9, ath: 9, acr: 0, str: 5, dex: 0 } });
    expect(breakFree(runOf([strong], dice(9)), strong, { key: "bound", dc: 15 })).toMatchObject({ success: false, mod: 9, total: 18, dc: 20 });
    const old = unit("c", "friendly", { rulesVersion: "legacy", escapeWork: { mod: 9, ath: 9, acr: 6, str: 5, dex: 4 } });
    expect(breakFree(runOf([old], dice(12)), old, { key: "bound", dc: 17 })).toMatchObject({ success: true, mod: 5, total: 17, dc: 17 });
    // (A friend unties them: no roll, the core's.)
    expect(breakFree(runOf([old, strong]), strong, { key: "bound", dc: 17 }, { freeing: true })).toBeNull();
  });

  test("a grapple: its better of Athletics and Acrobatics against the grab's DC; poisoned, at disadvantage", () => {
    const u = unit("a", "friendly", { escapeWork: { mod: 6, ath: 2, acr: 6, str: 1, dex: 4 } });
    expect(breakFree(runOf([u], dice(7)), u, { key: "grabbed", dc: 13 })).toMatchObject({ success: true, mod: 6, total: 13, natural: 7 });
    u.conds.poisoned = 1;
    expect(breakFree(runOf([u], dice(18, 3)), u, { key: "grabbed", dc: 13 })).toMatchObject({ success: false, natural: 3 });
    // (Nothing to go on: the core's.)
    expect(breakFree(runOf([u]), u, { key: "grabbed", dc: null })).toBeNull();
  });

  test("webs, a net: the check their escape names, for itself or (a net) a friend beside it", () => {
    const escape = { dc: 10, others: "check", checks: [{ ability: "str", skill: "ath" }] };
    const caught = unit("a", "friendly", { escapeWork: { mod: 8, ath: 0, acr: 8, str: 0, dex: 4 } });
    caught.effects.push({ key: "orc.net", sourceId: "orc", conditions: { restrained: 1, immobilized: 1 }, escape });
    const friend = unit("b", "friendly", { escapeWork: { mod: 5, ath: 5, acr: 0, str: 3, dex: 0 } });
    const run = runOf([caught, friend], dice(6));
    const hold = { key: "restrained", byId: "orc", dc: 10, others: "check", effectKey: "orc.net" };
    expect(breakFree(run, caught, hold)).toMatchObject({ success: false, mod: 0, total: 6 });
    expect(breakFree(run, friend, hold, { freeing: true })).toMatchObject({ success: true, mod: 5, total: 11 });
    // (2014's webs: a Strength check of its own, no skill.)
    caught.effects[0].escape = { dc: 10, others: null, checks: [{ ability: "str", skill: null }] };
    caught.spec.escapeWork.str = 4;
    expect(breakFree(run, caught, hold)).toMatchObject({ mod: 4, total: 10, success: true });
  });
});

describe("in a turn FastFighting plays: the system's roll", () => {
  /** A live battle's run, the system rolling checks: each request kept, each answered with `answer`. */
  const live = (units, answer, rng = dice(10)) => {
    const run = runOf(units, rng);
    run.live = { playing: true, roll: vi.fn(() => answer) };
    return run;
  };
  const asked = run => run.live.roll.mock.calls.map(([, request]) => request);

  test("an escape asks for it as the core's own do (the one held its target, the hold's key its label), and takes it as rolled", () => {
    const u = unit("a", "friendly", { escapeWork: { mod: 6, ath: 2, acr: 6, str: 1, dex: 4 } });
    const run = live([u], { degree: 2, natural: 4, total: 13 });
    // (The engine's own die would have failed it.)
    run.rng = dice(1);
    expect(breakFree(run, u, { key: "grabbed", dc: 13 }, { held: u })).toEqual({ success: true, degree: 2, natural: 4, mod: 6, total: 13, dc: 13 });
    expect(asked(run)).toEqual([{ kind: "check", unitId: "a", targetId: "a", purpose: "escape", skill: "acr", against: null, dc: 13, action: { id: null, name: "grabbed" }, advantage: 0 }]);
    const failed = live([u], { degree: 1, natural: 18, total: 12 }, dice(20));
    expect(breakFree(failed, u, { key: "grabbed", dc: 13 })).toMatchObject({ success: false, natural: 18, total: 12 });
  });

  test("the way out it takes, by dnd5e's key: bonds' Acrobatics or Athletics (2014: Strength), a net's or a web's own check", () => {
    const skillOf = (who, hold, units = [who], options = {}) => {
      const run = live(units, { degree: 2, natural: 10, total: 15 });
      breakFree(run, who, hold, options);
      return asked(run).map(r => [r.skill, r.dc]);
    };
    expect(skillOf(unit("a", "friendly", { escapeWork: { mod: 6, ath: 2, acr: 6, str: 1, dex: 4 } }), { key: "bound", dc: 15 })).toEqual([["acr", 15]]);
    expect(skillOf(unit("b", "friendly", { escapeWork: { mod: 9, ath: 9, acr: 0, str: 5, dex: 0 } }), { key: "bound", dc: 15 })).toEqual([["ath", 20]]);
    expect(skillOf(unit("c", "friendly", { rulesVersion: "legacy", escapeWork: { mod: 9, ath: 9, acr: 6, str: 5, dex: 4 } }), { key: "bound", dc: 17 })).toEqual([["str", 17]]);
    expect(skillOf(unit("d", "friendly", { escapeWork: { mod: 2, ath: 2, acr: 0, str: 1, dex: 0 } }), { key: "grabbed", dc: 12 })).toEqual([["ath", 12]]);
    const caught = unit("e", "friendly", { escapeWork: { mod: 8, ath: 0, acr: 8, str: 0, dex: 4 } });
    caught.effects.push({ key: "orc.net", sourceId: "orc", conditions: { restrained: 1, immobilized: 1 }, escape: { dc: 10, others: "check", checks: [{ ability: "str", skill: "ath" }] } });
    const hold = { key: "restrained", byId: "orc", dc: 10, others: "check", effectKey: "orc.net" };
    expect(skillOf(caught, hold)).toEqual([["ath", 10]]);
    caught.effects[0].escape = { dc: 10, others: null, checks: [{ ability: "str", skill: null }] };
    expect(skillOf(caught, hold)).toEqual([["str", 10]]);
  });

  test("none to roll (no answer, or not a turn FastFighting plays): the engine's own die", () => {
    const u = unit("a", "friendly", { escapeWork: { mod: 6, ath: 2, acr: 6, str: 1, dex: 4 } });
    expect(breakFree(live([u], null, dice(7)), u, { key: "grabbed", dc: 13 })).toMatchObject({ success: true, natural: 7, total: 13 });
    const idle = live([u], { degree: 1, natural: 1, total: 7 }, dice(7));
    idle.live.playing = false;
    expect(breakFree(idle, u, { key: "grabbed", dc: 13 })).toMatchObject({ success: true, natural: 7 });
    expect(idle.live.roll).not.toHaveBeenCalled();
  });
});

/* In the engine ---------------------------------------------------------- */

let n = 0;
const at = x => ({ position: { x, y: 0, size: 5 } });
const fighter = (id, side, x, over = {}) => ({
  id, name: id, side, kind: "npc", level: 3, hp: { value: 300, max: 300, temp: 0 }, defenses: { ac: 15, str: 2, dex: 2, con: 2, int: 0, wis: 0, cha: 0 },
  initiative: { mod: 2 }, speeds: { walk: 30 }, iwr: {}, flags: { fearless: true }, diesAtZero: false,
  actions: [{ id: `s${++n}`, name: "Longsword", kind: "strike", bonus: 5, melee: true, reach: 5, damage: [parseFormula("1d8+3", "slashing")], hands: 1 }],
  traits: { tactical: { base: 60, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } },
  escapeWork: { mod: 2, ath: 2, acr: 0, str: 1, dex: 0 }, escapeDC: 13, ...at(x), ...over
});
function fight(list, seed = 3) {
  const battle = { combatants: list, sides: { friendly: { label: "Party", enemies: ["hostile"] }, hostile: { label: "Foes", enemies: ["friendly"] } }, options: { positioning: true, opening: "fight", maxRounds: 6 } };
  const run = beginRun(prepareBattle(battle, dnd5eRules), seed, { log: true });
  beginRound(run, 1);
  return run;
}

describe("in the engine", () => {
  test("a prisoner slips its bonds (2024: DC 15); one under the 2014 rules has to burst them (DC 17)", () => {
    const run = fight([fighter("hero", "friendly", 0), fighter("orc", "hostile", 5, { escapeWork: { mod: 60, ath: 0, acr: 60, str: 0, dex: 0 } })]);
    const orc = Object.assign(run.byId.get("orc"), { bound: true, boundBy: "hero", status: "bound" });
    takeTurn(run, orc);
    expect(run.log.at(-1)).toMatchObject({ type: "escape", hold: "bound", success: true, dc: 15 });
    const old = fight([fighter("hero", "friendly", 0), fighter("orc", "hostile", 5, { rulesVersion: "legacy", escapeWork: { mod: 60, ath: 60, acr: 60, str: -50, dex: 0 } })]);
    const o = Object.assign(old.byId.get("orc"), { bound: true, boundBy: "hero", status: "bound" });
    takeTurn(old, o);
    expect(old.log.at(-1)).toMatchObject({ type: "escape", hold: "bound", success: false, dc: 17 });
  });

  test("grabbed: it breaks the grabber's grab with an action and its best check, against the grabber's escape DC", () => {
    const run = fight([fighter("hero", "friendly", 0, { escapeDC: 16 }), fighter("orc", "hostile", 40, { escapeWork: { mod: 60, ath: 60, acr: 0, str: 0, dex: 0 } })]);
    const orc = run.byId.get("orc");
    orc.grabbedBy = "hero";
    expect(holdsOf(run, orc)).toEqual([expect.objectContaining({ key: "grabbed", dc: 16, others: null })]);
    takeTurn(run, orc);
    expect(run.log.find(e => e.actorId === "orc" && e.type === "escape")).toMatchObject({ hold: "grabbed", success: true, dc: 16 });
    expect(orc.grabbedBy).toBe(null);
  });

  test("grappled on its sheet alone: the grab of the foe beside it", () => {
    const run = fight([fighter("hero", "friendly", 0, { escapeDC: 17 }), fighter("orc", "hostile", 5)]);
    const orc = run.byId.get("orc");
    orc.baseConds = { grabbed: 1, immobilized: 1 };
    expect(holdsOf(run, orc)).toEqual([expect.objectContaining({ key: "grabbed", dc: 17, sheet: true })]);
  });

  test("webs the adapter's way: laid as the engine's effect, broken with the Strength (Athletics) check they name; free, it can move", () => {
    const restrained = { conditions: { restrained: 1, immobilized: 1 }, rounds: 600, label: "restrained", escape: { dc: 14, others: null, checks: [{ ability: "str", skill: "ath" }] } };
    const web = { id: "mage.web", name: "Web", kind: "control", cost: 1, save: { type: "dex", dc: 14, basic: false }, onSave: [restrained, restrained, null, null], range: { increment: 60, max: 60, noPenalty: true }, hands: 1 };
    const run = fight([fighter("mage", "friendly", 0, { actions: [web] }), fighter("orc", "hostile", 40, { escapeWork: { mod: 0, ath: 60, acr: 0, str: 0, dex: 0 } })]);
    const orc = run.byId.get("orc");
    applyOutcome(orc, restrained, "mage", web);
    const [hold] = holdsOf(run, orc);
    expect(hold).toMatchObject({ key: "restrained", byId: "mage", dc: 14, others: null, effectKey: "mage.web" });
    const got = tryHold(run, orc, hold);
    expect(got).toMatchObject({ success: true, mod: 60, dc: 14 });
    release(run, orc, hold);
    expect([orc.conds.restrained, orc.conds.immobilized].map(v => v ?? 0)).toEqual([0, 0]);
  });

  test("an effect that says how it's broken (a net): a friend beside it frees it with the check it names", () => {
    const run = fight([fighter("hero", "friendly", 0, { escapeWork: { mod: 0, ath: 60, acr: 0, str: 0, dex: 0 } }), fighter("kyra", "friendly", 5)]);
    const kyra = run.byId.get("kyra");
    kyra.effects.push({ key: "orc.net", sourceId: null, conditions: { restrained: 1 }, rounds: Infinity, escape: { dc: 10, others: "check", checks: [{ ability: "str", skill: "ath" }] } });
    const hold = holdsOf(run, kyra)[0];
    expect(hold).toMatchObject({ key: "restrained", effectKey: "orc.net", others: "check", dc: 10 });
    expect(tryHold(run, run.byId.get("hero"), hold, { freeing: true })).toMatchObject({ success: true, dc: 10, mod: 60 });
  });
});
