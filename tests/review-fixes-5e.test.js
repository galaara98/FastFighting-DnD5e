/**
 * A review's findings: a charged consumable spends its charges before its quantity; the knock-out mark is one Rewind
 * puts back, and comes off when the creature wakes or dies; Incapacitated alone isn't helpless; the 2014 rules'
 * exhaustion; legendary actions written back to the sheet.
 */
import { afterEach, describe, expect, test } from "vitest";
import { commitDnd5eChanges, itemSpent } from "../scripts/commit.js";
import { Dnd5eAdapter } from "../scripts/adapter.js";
import { dnd5eRules } from "../scripts/rules.js";

const was = { foundry: globalThis.foundry, game: globalThis.game };
afterEach(() => Object.assign(globalThis, was));

const getProperty = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);

/** An actor with these items and flags, its updates and its items' kept. */
function actorWith({ items = [], flags = {}, system = {}, statuses = [] } = {}) {
  const calls = { actor: [], items: [], deleted: [] };
  const list = items.map(i => ({
    ...i, toObject: () => ({ _id: i.id }),
    async update(u) { calls.items.push({ id: i.id, ...u }); },
    async delete() { calls.deleted.push(i.id); }
  }));
  const actor = {
    uuid: "Actor.a", type: "npc", statuses: new Set(statuses), flags, system,
    items: Object.assign(list, { get: id => list.find(i => i.id === id) }),
    effects: Object.assign([], { has: () => false }),
    async update(u) { calls.actor.push(u); },
    async toggleStatusEffect() {}
  };
  return { actor, calls };
}

function commit(actor, changes, final = { status: "standing" }, spec = {}) {
  globalThis.foundry = { utils: { getProperty } };
  globalThis.game = { ...was.game, combat: null };
  return commitDnd5eChanges({ uuid: "Token.a", actor }, { actions: [], ...spec }, changes, final, {});
}

describe("a charged consumable", () => {
  test("a wand of seven charges loses one charge a shot, not itself", async () => {
    const wand = { id: "wand", type: "consumable", system: { quantity: 1, uses: { max: 7, spent: 0 } } };
    const { actor, calls } = actorWith({ items: [wand] });
    const undo = await commit(actor, { resources: { "item:wand": { from: 7, to: 6 } } });
    expect(calls.deleted).toEqual([]);
    expect(calls.items).toEqual([{ id: "wand", "system.quantity": 1, "system.uses.spent": 1 }]);
    expect(undo.itemUpdates).toEqual([{ id: "wand", update: { "system.quantity": 1, "system.uses.spent": 0 } }]);
  });

  test("charges first, then the next of the stack; the last gone only if it's autoDestroy", () => {
    const potions = (quantity, autoDestroy = true, spent = 0) => ({ quantity, uses: { max: 1, spent, autoDestroy } });
    expect(itemSpent(potions(3), 1)).toEqual({ quantity: 2, spent: 0, gone: false });
    expect(itemSpent(potions(3), 2)).toEqual({ quantity: 1, spent: 0, gone: false });
    expect(itemSpent(potions(1), 1)).toEqual({ quantity: 1, spent: 1, gone: true });
    expect(itemSpent(potions(1, false), 1)).toEqual({ quantity: 1, spent: 1, gone: false });
    const wands = { quantity: 2, uses: { max: 7, spent: 5, autoDestroy: false } };
    expect(itemSpent(wands, 3)).toEqual({ quantity: 1, spent: 1, gone: false });
    // (No charges: its quantity, gone at none.)
    expect(itemSpent({ quantity: 2 }, 1)).toEqual({ quantity: 1, spent: undefined, gone: false });
    expect(itemSpent({ quantity: 1 }, 1)).toMatchObject({ quantity: 0, gone: true });
  });

  test("its pool as the sheet has it: this one's charges left, then the rest of the stack's", async () => {
    const wand = { id: "wand", type: "consumable", system: { quantity: 2, uses: { max: 7, spent: 2 } } };
    const { actor } = actorWith({ items: [wand], system: { attributes: { hp: { value: 10, max: 10 } } } });
    const state = await new Dnd5eAdapter().readLiveState({ actor }, { unit: { spec: { hp: { max: 10 }, resources: { "item:wand": 14 } } } });
    expect(state.resources["item:wand"]).toBe(12);
  });
});

describe("the knock-out mark", () => {
  const out = { status: "down", stable: true, system: { knockedOut: true } };

  test("FastFighting's own flag, so Rewind puts it back; one it didn't have goes back to none", async () => {
    const { actor, calls } = actorWith({ system: { attributes: { hp: { value: 7 } } } });
    const undo = await commit(actor, { hp: { from: 7, to: 0 } }, out, { rulesVersion: "modern" });
    expect(calls.actor.at(-1)).toMatchObject({ "flags.fast-fighting.knockedOut": true });
    expect(undo.actorUpdate).toHaveProperty(["flags.fast-fighting.knockedOut"], null);
  });

  test("off when its Unconscious comes off, or it dies; still on while it lies there", async () => {
    const flags = () => ({ "fast-fighting": { knockedOut: true }, "fast-fighting-dnd5e": { knockedOut: true } });
    const off = { "flags.fast-fighting.knockedOut": false, "flags.fast-fighting-dnd5e.knockedOut": false };
    let { actor, calls } = actorWith({ flags: flags() });
    await commit(actor, { conditions: { set: {}, cleared: ["unconscious"] } }, { status: "standing" });
    expect(calls.actor.at(-1)).toMatchObject(off);
    ({ actor, calls } = actorWith({ flags: flags() }));
    await commit(actor, { hp: { from: 1, to: 0 }, died: true }, { status: "dead" });
    expect(calls.actor.at(-1)).toMatchObject(off);
    ({ actor, calls } = actorWith({ flags: flags() }));
    await commit(actor, { system: { from: null, to: {} } }, { status: "down", stable: true, system: {} });
    expect(calls.actor).toEqual([]);
  });
});

describe("conditions and exhaustion", () => {
  const unit = (conds = {}, rulesVersion = "modern") => ({ conds, spec: { rulesVersion, flags: {} } });

  test("Incapacitated alone: no advantage at it, and its Strength and Dexterity saves aren't failed", () => {
    const dazed = unit({ incapacitated: 1 });
    expect(dnd5eRules.modifiers.attack({ attacker: unit(), target: dazed, action: { melee: true }, distance: 5 }).advantage).toBe(0);
    expect(dnd5eRules.modifiers.exposed({ target: dazed, action: { melee: true }, distance: 5 })).toBe(false);
    expect(dnd5eRules.modifiers.save({ unit: dazed, type: "dex" }).bonus).toBe(0);
    // (Stunned still is both.)
    expect(dnd5eRules.modifiers.save({ unit: unit({ stunned: 1, incapacitated: 1 }), type: "dex" }).bonus).toBe(-99);
  });

  test("2014 exhaustion: Disadvantage on checks from level 1, on attacks and saves from level 3; no -2 a level", () => {
    const tired = level => unit({ exhaustion: level }, "legacy");
    const attack = u => dnd5eRules.modifiers.attack({ attacker: u, target: unit(), action: { melee: true }, distance: 5 });
    expect(dnd5eRules.modifiers.check({ unit: tired(1) })).toEqual({ bonus: 0, advantage: -1 });
    expect(attack(tired(2))).toEqual({ bonus: 0, advantage: 0 });
    expect(dnd5eRules.modifiers.save({ unit: tired(2), type: "wis" })).toEqual({ bonus: 0, advantage: 0 });
    expect(attack(tired(3))).toEqual({ bonus: 0, advantage: -1 });
    expect(dnd5eRules.modifiers.save({ unit: tired(3), type: "wis" })).toEqual({ bonus: 0, advantage: -1 });
    // (2024: -2 a level, no Disadvantage.)
    expect(dnd5eRules.modifiers.check({ unit: unit({ exhaustion: 2 }) })).toEqual({ bonus: -4, advantage: 0 });
  });
});

describe("legendary actions", () => {
  test("those left this round go onto the sheet as spent", async () => {
    expect(dnd5eRules.capture({ spec: { legendary: { pool: 3 } }, legendaryLeft: 1 })).toMatchObject({ legendaryLeft: 1 });
    expect(dnd5eRules.capture({ spec: {} })).not.toHaveProperty("legendaryLeft");
    const { actor, calls } = actorWith({ system: { resources: { legact: { max: 3, spent: 0 } } } });
    const undo = await commit(actor, { system: { from: { legendaryLeft: 3 }, to: { legendaryLeft: 1 } } }, { status: "standing", system: { legendaryLeft: 1 } });
    expect(calls.actor.at(-1)).toMatchObject({ "system.resources.legact.spent": 2 });
    expect(undo.actorUpdate["system.resources.legact.spent"]).toBe(0);
  });
});
