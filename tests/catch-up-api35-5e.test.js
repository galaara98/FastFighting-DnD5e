/**
 * What this helper takes up of the core's APIs 26 to 35: deals (goods.js), food and corpses (food.js), the core's
 * settings as 5e has them, a party, Ready and the homebrew Delay, hearing a fight, minions commanded, 2024's knock-out,
 * areas that spare whom their maker chooses, and what lasts only to the end of the turn.
 */
import { afterEach, describe, expect, test } from "vitest";
import { replay, prepareBattle, beginRun } from "../../FastFighting/scripts/engine/simulator.js";
import { delayFor } from "../../FastFighting/scripts/engine/behavior/waiting.js";
import { Dnd5eAdapter, checkOf, thisTurnIn } from "../scripts/adapter.js";
import { dnd5eRules, dnd5eRulesWith } from "../scripts/rules.js";
import { takeDnd5eGoods, putDnd5eGoods, dnd5eGiveables, dnd5ePileContents, dnd5eSkillsOf, commitDnd5eConcession, copperValue, copperOf } from "../scripts/goods.js";
import { dnd5eAppetite, dnd5eCorpseKind, dnd5eMeatFor, dnd5eIsFood } from "../scripts/food.js";
import { commitDnd5eChanges } from "../scripts/commit.js";
import { parseFormula } from "../scripts/core.js";

const was = { game: globalThis.game, foundry: globalThis.foundry };
afterEach(() => Object.assign(globalThis, was));

const listOf = list => Object.assign(list, { get: id => list.find(i => i.id === id) });

/** An item as dnd5e has one, its updates and deletion kept on its actor. */
function itemOf(actor, data) {
  const item = {
    ...data, system: { quantity: 1, ...data.system },
    toObject() { return structuredClone({ _id: this.id, name: this.name, type: this.type, system: this.system }); },
    async update(u) { item.system.quantity = u["system.quantity"]; },
    async delete() { actor.items.splice(actor.items.indexOf(item), 1); }
  };
  return item;
}

/** An actor with coins and things, its updates applied. */
function actorWith({ currency = {}, items = [], skills = {} } = {}) {
  const actor = {
    uuid: "Actor.a", type: "npc", statuses: new Set(), system: { currency: { ...currency }, skills }, items: listOf([]),
    async update(u) { if ( u["system.currency"] ) actor.system.currency = { ...u["system.currency"] }; },
    async createEmbeddedDocuments(type, data) {
      const made = data.map((d, i) => itemOf(actor, { ...d, id: `new${i}` }));
      actor.items.push(...made);
      return made;
    }
  };
  for ( const d of items ) actor.items.push(itemOf(actor, d));
  return actor;
}
const tokenOf = actor => ({ uuid: "Token.t", actor });

describe("deals (core API 26): goods off one sheet and onto another", () => {
  test("money with change made, and so many of a thing carried put away; never one equipped", async () => {
    globalThis.foundry = { utils: { deepClone: structuredClone } };
    const giver = actorWith({ currency: { gp: 3, sp: 2, cp: 5 }, items: [
      { id: "rope", name: "Rope", type: "loot", system: { quantity: 3, price: { value: 1, denomination: "gp" } } },
      { id: "sword", name: "Sword", type: "weapon", system: { equipped: true } }
    ] });
    const { goods, records } = await takeDnd5eGoods(tokenOf(giver), [
      { kind: "money", amount: 135 }, { kind: "item", item: { id: "rope" }, count: 2 }, { kind: "item", item: { id: "sword" } }
    ]);
    expect(goods.coins).toEqual({ gp: 1, sp: 3, cp: 5 });
    // (325 copper less 135: the core's payFrom, its change in whatever coins make it.)
    expect(copperOf(giver.system.currency)).toBe(190);
    expect(goods.items).toHaveLength(1);
    expect(goods.items[0]).toMatchObject({ name: "Rope", system: { quantity: 2 } });
    expect(giver.items.get("rope").system.quantity).toBe(1);
    expect(giver.items.get("sword")).toBeTruthy();
    expect(records[0].actorUpdate["system.currency"]).toMatchObject({ gp: 3, sp: 2, cp: 5 });
    // (Onto another: the coins added to its own, the thing a new item; a team's purse's copper as coins.)
    const taker = actorWith({ currency: { gp: 1 } });
    await putDnd5eGoods(tokenOf(taker), { ...goods, money: 250 });
    expect(taker.system.currency).toMatchObject({ gp: 4, sp: 8, cp: 5 });
    expect(taker.items.map(i => i.name)).toEqual(["Rope"]);
  });

  test("a concession hands its goods over; what a character could give; a pile's contents; its skills", async () => {
    globalThis.foundry = { utils: { deepClone: structuredClone } };
    const giver = actorWith({ currency: { gp: 2 }, items: [{ id: "gem", name: "Gem", type: "loot", system: { price: { value: 50, denomination: "gp" } } }] });
    const taker = actorWith();
    await commitDnd5eConcession(tokenOf(giver), tokenOf(taker), { kind: "item", item: { id: "gem" } });
    expect(taker.items.map(i => i.name)).toEqual(["Gem"]);
    expect(giver.items).toHaveLength(0);
    const pc = actorWith({ currency: { gp: 1, ep: 2 }, items: [{ id: "potion", name: "Potion", type: "consumable", system: { quantity: 2, price: { value: 50 } } },
      { id: "shield", name: "Shield", type: "equipment", system: { equipped: true } }, { id: "pack", name: "Backpack", type: "container", system: {} }] });
    const can = dnd5eGiveables(pc);
    expect(can.money).toBe(200);
    expect(can.items.map(i => [i.id, i.quantity, i.value])).toEqual([["potion", 2, 5000]]);
    expect(can.denominations.map(d => d.value)).toEqual([1000, 100, 10, 1]);
    expect(dnd5ePileContents(tokenOf(pc)).items.map(i => i.id)).toEqual(["potion", "shield"]);
    expect(copperValue({ value: 5, denomination: "sp" })).toBe(50);
    const skills = dnd5eSkillsOf({ system: { skills: { per: { total: 5 }, itm: { total: 2 }, ath: { total: 4 } } } });
    expect(skills.find(s => s.key === "per")).toMatchObject({ mod: 5, talk: "persuade" });
    expect(skills.find(s => s.key === "ath").talk).toBeNull();
  });

  test("a deal's check: a bribe Persuasion, a demand or a threat Intimidation (2024's Influence)", () => {
    const actor = { system: { skills: {} } };
    expect(checkOf(actor, { purpose: "bribe" })).toEqual({ skill: "per" });
    expect(checkOf(actor, { purpose: "extort" })).toEqual({ skill: "itm" });
    expect(checkOf(actor, { purpose: "scare" })).toEqual({ skill: "itm" });
  });

  test("the main coin is gold; the core's settings as 5e has them; dnd5e's own party", () => {
    const adapter = new Dnd5eAdapter();
    expect(adapter.mainCoin()).toMatchObject({ key: "gp", value: 100 });
    expect(adapter.settingDefaults()).toMatchObject({ maxRounds: { min: 4, max: 12, default: 10 }, loreBoost: { default: 2.5 } });
    globalThis.game = { ...was.game, actors: [
      { type: "group", system: { type: { value: "party" }, members: [{ actor: { id: "akra" } }, { actor: { id: "zanna" } }] } },
      { type: "group", system: { type: { value: "encounter" }, members: [{ actor: { id: "goblin" } }] } },
      { type: "npc" }
    ] };
    expect(adapter.partyMembers()).toEqual(["akra", "zanna"]);
  });
});

describe("food and corpses (core APIs 27 and 30)", () => {
  const npc = (type, { int = 10, items = [], size = "med", swarm = null } = {}) => ({
    type: "npc", items, system: { details: { type: { value: type, swarm } }, abilities: { int: { value: int } }, traits: { size } }
  });
  const bite = { type: "weapon", system: { identifier: "bite" } };

  test("what it eats: a biting beast meat, other beasts anything, constructs and undead and the mindless nothing", () => {
    expect(dnd5eAppetite(npc("beast", { int: 2, items: [bite] }))).toMatchObject({ diet: "meat" });
    expect(dnd5eAppetite(npc("beast", { int: 2 }))).toMatchObject({ diet: "any" });
    expect(dnd5eAppetite(npc("humanoid"))).toMatchObject({ diet: "any", hunger: 0.1 });
    for ( const kind of ["construct", "undead", "elemental"] ) expect(dnd5eAppetite(npc(kind)).diet).toBeNull();
    expect(dnd5eAppetite(npc("ooze", { int: 1 })).diet).toBeNull();
  });

  test("what its body leaves: fresh (food, portions by size), rotten, scrap, or nothing", () => {
    expect(dnd5eCorpseKind(npc("humanoid"))).toBe("fresh");
    expect(dnd5eCorpseKind(npc("undead"))).toBe("rotten");
    expect(dnd5eCorpseKind(npc("construct"))).toBe("scrap");
    expect(dnd5eCorpseKind(npc("elemental"))).toBeNull();
    expect(dnd5eCorpseKind(npc("beast", { swarm: "tiny" }))).toBeNull();
    expect(dnd5eCorpseKind(npc("undead", { items: [{ system: { identifier: "incorporeal-movement" } }] }))).toBeNull();
    const meat = dnd5eMeatFor(npc("beast", { size: "lg" }));
    expect(meat.quantity).toBe(8);
    expect(meat.item).toMatchObject({ type: "consumable", system: { type: { value: "food" } }, flags: { "fast-fighting": { corpse: "fresh", food: "meat", portions: 8 } } });
    expect(dnd5eMeatFor(npc("undead"))).toMatchObject({ quantity: 0, item: { type: "loot", flags: { "fast-fighting": { corpse: "rotten" } } } });
    expect(dnd5eIsFood(meat.item)).toEqual({ portions: 8, meat: true });
    expect(dnd5eIsFood({ type: "consumable", system: { type: { value: "food" }, quantity: 3 } })).toEqual({ portions: 3, meat: false });
    expect(dnd5eIsFood({ type: "loot", system: {} })).toBeNull();
  });
});

describe("the rules (core APIs 31 to 35)", () => {
  test("Ready: an action, a single attack; no Delay but the GM's homebrew, back at the round's end", () => {
    expect(dnd5eRules.ready).toEqual({ cost: { action: 1 }, most: 1 });
    expect(dnd5eRules.delay).toBeUndefined();
    expect(dnd5eRulesWith()).toBe(dnd5eRules);
    expect(dnd5eRulesWith({ homebrewDelay: true }).delay).toEqual({ toEnd: true });
    // (Knocking a foe out costs nothing on the roll.)
    expect(dnd5eRules.pullPenalty).toBeUndefined();
  });

  test("hearing a fight on the SRD's typical DCs: easy, medium for talk, harder far off and through walls", () => {
    expect(dnd5eRules.hearDC({ feet: 20 })).toBe(10);
    expect(dnd5eRules.hearDC({ feet: 20, talk: true })).toBe(15);
    expect(dnd5eRules.hearDC({ feet: 90, walls: 1 })).toBe(25);
    expect(dnd5eRules.hearDC({ feet: 20, walls: 1, talk: true })).toBeNull();
    expect(dnd5eRules.hearDC({ feet: 200, walls: 2 })).toBeNull();
  });

  test("a minion is commanded as its spec says (Animate Dead's bonus action, once for all); others act on their own", () => {
    const cost = { bonus: 1, once: "necro.animate" };
    expect(dnd5eRules.minionCommand({ spec: { flags: { command: cost } } })).toEqual(cost);
    expect(dnd5eRules.minionCommand({ spec: { flags: {} } })).toBeNull();
  });

  test("a knock-out is captured for the sheet: under the 2024 rules, 1 hit point and Unconscious, marked", async () => {
    expect(dnd5eRules.capture({ knockedOut: true })).toMatchObject({ knockedOut: true });
    expect(dnd5eRules.capture({})).not.toHaveProperty("knockedOut");
    const updates = [];
    const actor = { uuid: "Actor.g", type: "npc", statuses: new Set(), flags: {}, system: { attributes: { hp: { value: 7 } } }, items: { get: () => null },
      effects: Object.assign([], { has: () => false }), async update(u) { updates.push(u); } };
    globalThis.foundry = { utils: { getProperty: (o, p) => p.split(".").reduce((x, k) => x?.[k], o) } };
    globalThis.game = { ...was.game, combat: null };
    const final = { status: "down", stable: true, system: { knockedOut: true } };
    await commitDnd5eChanges({ uuid: "Token.g", actor }, { actions: [], rulesVersion: "modern" }, { hp: { from: 7, to: 0 } }, final, {});
    expect(updates.at(-1)).toMatchObject({ "system.attributes.hp.value": 1, "flags.fast-fighting-dnd5e.knockedOut": true });
    updates.length = 0;
    await commitDnd5eChanges({ uuid: "Token.g", actor }, { actions: [], rulesVersion: "legacy" }, { hp: { from: 7, to: 0 } }, final, {});
    expect(updates.at(-1)).toMatchObject({ "system.attributes.hp.value": 0 });
  });

  test("the homebrew Delay in a fight: one with no foe in reach waits, and comes back after everyone", () => {
    const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
    const body = (id, side, pos, init) => ({
      id, name: id, side, kind: "npc", level: 3, size: 2, hp: { value: 300, max: 300, temp: 0 }, defenses: { ac: 15, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      initiative: { mod: init }, speeds: { walk: 30 }, iwr: {}, flags: { fearless: true }, diesAtZero: false,
      actions: [{ id: `${id}.axe`, name: "Axe", kind: "strike", cost: 1, bonus: 5, melee: true, reach: 5, damage: [parseFormula("1d8+3", "slashing")] }],
      traits: { tactical: { base: 80, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } }, ...pos
    });
    const battle = () => ({
      combatants: [body("hero", "friendly", at(0), 100), body("brute", "hostile", at(60), -100), body("last", "friendly", at(0, 10), -200)],
      sides: { friendly: { label: "Party", enemies: ["hostile"] }, hostile: { label: "Foes", enemies: ["friendly"] } }, options: { positioning: true, opening: "fight", maxRounds: 2 }
    });
    const homebrew = dnd5eRulesWith({ homebrewDelay: true });
    const run = beginRun(prepareBattle(battle(), homebrew), 1);
    run.round = 1;
    expect(delayFor(run, run.byId.get("hero"))).toMatchObject({ afterId: null });
    const { log } = replay(battle(), homebrew, 1);
    const delay = log.find(e => e.type === "delay");
    expect(delay).toMatchObject({ actorId: "hero" });
    const last = log.findIndex(e => e.actorId === "last" && e.round === delay.round);
    const back = log.findIndex(e => e.actorId === "hero" && e.round === delay.round && e.type !== "delay");
    expect(back).toBeGreaterThan(last);
    // (Without the homebrew, no one delays.)
    expect(replay(battle(), dnd5eRules, 1).log.some(e => e.type === "delay")).toBe(false);
  });

  test("what lasts only to the end of the turn, by its words (not the next turn's end)", () => {
    expect(thisTurnIn("you have Advantage on your next attack roll on the current turn")).toBe(true);
    expect(thisTurnIn("until the end of your turn")).toBe(true);
    expect(thisTurnIn("until the end of your next turn")).toBe(false);
  });
});
