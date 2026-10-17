/**
 * A player's damage card in a live battle (core API 19): read as it's made (how much, damage or healing, at which
 * tokens, a save to roll first), applied to a creature the way dnd5e's own damage tray applies it (the actor's
 * applyDamage, times the GM's multiplier) with an undo record of the hit points as they were, and no dnd5e setting that
 * applies players' damage by itself.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { Dnd5eAdapter } from "../scripts/adapter.js";
import { damageCardOf, damagesOf } from "../scripts/read-turn.js";
import { applyDnd5eDamageCard } from "../scripts/commit.js";

const was = { CONFIG: globalThis.CONFIG, dnd5e: globalThis.dnd5e, fromUuidSync: globalThis.fromUuidSync };
afterEach(() => {
  for ( const [k, v] of Object.entries(was) ) {
    if ( v === undefined ) delete globalThis[k];
    else globalThis[k] = v;
  }
});

const goblin = { ac: 15, token: "Scene.s.Token.tokB", actor: "Scene.s.Token.tokB.Actor.x" };
const orc = { ac: 13, token: "Scene.s.Token.tokC", actor: "Actor.orc" };
const roll = (total, type, properties = []) => ({ total, options: { type, properties } });
/** A card as dnd5e 6 makes it: its type, and the rest in its system data. */
const card = (type, system, rolls) => ({ id: "m1", type, speaker: { token: "tokA" }, flags: {}, system: { targets: [], ...system }, rolls });
const context = { ids: { tokA: "A", tokB: "B", tokC: "C" } };

describe("a damage card, read as it's made", () => {
  test("a damage roll at a goblin: every roll's total (none below 0), at that token, no save", () => {
    const m = card("damage", { targets: [goblin] }, [roll(7, "slashing"), roll(3, "fire"), roll(-2, "cold")]);
    expect(damageCardOf(m)).toEqual({ amount: 10, kind: "damage", targets: ["tokB"], save: false });
    // (At two, one twice: each token once.)
    expect(damageCardOf(card("damage", { targets: [goblin, orc, goblin] }, [roll(4, "fire")])).targets).toEqual(["tokB", "tokC"]);
    // (At no one: no targets, for a GM to pick.)
    expect(damageCardOf(card("damage", {}, [roll(4, "fire")])).targets).toEqual([]);
  });

  test("a save activity's damage waits on the save, unless it lands in full anyway", () => {
    const of = onSave => damageCardOf(card("damage", { targets: [goblin], onSave }, [roll(12, "fire")])).save;
    expect(of("half")).toBe(true);
    expect(of("none")).toBe(true);
    expect(of("full")).toBe(false);
    expect(of(null)).toBe(false);
    // (A card without onSave, from a save activity: the activity's own.)
    globalThis.fromUuidSync = uuid => (uuid === "Actor.w.Item.i.Activity.a" ? { type: "save", damage: { onSave: "half" } } : null);
    expect(damageCardOf(card("damage", { targets: [goblin], activity: { uuid: "Actor.w.Item.i.Activity.a" } }, [roll(9, "cold")])).save).toBe(true);
  });

  test("healing: by the card's type, or rolls that are all healing (temporary hit points too); never a save", () => {
    expect(damageCardOf(card("healing", { targets: [orc] }, [roll(8, "healing")]))).toEqual({ amount: 8, kind: "healing", targets: ["tokC"], save: false });
    expect(damageCardOf(card("damage", { targets: [orc] }, [roll(5, "temphp")])).kind).toBe("healing");
    expect(damageCardOf(card("damage", { targets: [orc] }, [roll(5, "healing"), roll(2, "necrotic")])).kind).toBe("damage");
  });

  test("earlier dnd5e: the same, from flags.dnd5e (the roll's damageOnSave)", () => {
    const old = { type: "base", speaker: { token: "tokA" }, flags: { dnd5e: { roll: { type: "damage", damageOnSave: "half" }, targets: [{ uuid: "Scene.s.Token.tokB.Actor.x", ac: 13 }] } }, rolls: [roll(9, "fire")] };
    expect(damageCardOf(old)).toEqual({ amount: 9, kind: "damage", targets: ["tokB"], save: true });
  });

  test("anything else is no damage card: an attack, a check, a plain message, a damage card with no roll", () => {
    expect(damageCardOf(card("attack", { targets: [goblin] }, [{ total: 17, dice: [{ faces: 20, total: 14 }], options: {} }]))).toBeNull();
    expect(damageCardOf(card("check", { skill: "per" }, [{ total: 14, options: {} }]))).toBeNull();
    expect(damageCardOf({ type: "base", speaker: {}, flags: {}, system: {}, rolls: [] })).toBeNull();
    expect(damageCardOf(card("damage", { targets: [goblin] }, []))).toBeNull();
    expect(damageCardOf(null)).toBeNull();
  });

  test("with dnd5e loaded: only its damage rolls, split by type and properties as its tray splits them", () => {
    class DamageRoll {
      constructor(total, type, properties = []) {
        Object.assign(this, { total, options: { type, properties } });
      }
    }
    globalThis.CONFIG = { Dice: { DamageRoll }, DND5E: { healingTypes: { healing: {}, temphp: {} } } };
    const aggregateDamageRolls = vi.fn(() => [new DamageRoll(6, "slashing", ["mgc"]), new DamageRoll(4, "fire")]);
    globalThis.dnd5e = { dice: { aggregateDamageRolls } };
    const m = card("damage", { targets: [goblin] }, [new DamageRoll(10, "slashing", ["mgc"]), { total: 20, options: { type: "slashing" } }]);
    expect(damagesOf(m)).toEqual([{ type: "slashing", properties: new Set(["mgc"]), value: 6 }, { type: "fire", properties: new Set(), value: 4 }]);
    expect(aggregateDamageRolls).toHaveBeenCalledWith([m.rolls[0]], { respectProperties: true });
    expect(damageCardOf(m).amount).toBe(10);
  });

  test("the adapter's damageCard is this reading", () => {
    const m = card("damage", { targets: [goblin], onSave: "half" }, [roll(12, "fire")]);
    expect(new Dnd5eAdapter().damageCard(m, context)).toEqual(damageCardOf(m));
  });
});

/**
 * A creature's token as dnd5e prepares its actor, with only what applying damage looks at; its applyDamage keeps each
 * call and does what dnd5e's would to these numbers (temporary hit points first; Bloodied at half or less).
 */
function creature({ hp = 20, temp = 0, tempmax = 0, max = 30, stored = null, death = null, effects = [] } = {}) {
  const calls = [];
  const list = [...effects];
  const statuses = new Set(list.flatMap(e => [...(e.statuses ?? [])]));
  const prepared = { value: hp, temp, tempmax, max };
  const actor = {
    uuid: "Scene.s.Token.tokB.Actor.x", statuses, items: [], effects: list,
    system: { attributes: { hp: prepared, ...(death ? { death } : {}) }, _source: { attributes: { hp: { value: stored ?? hp, temp, tempmax }, ...(death ? { death: { ...death } } : {}) } } },
    async applyDamage(damages, options) {
      calls.push({ damages, options });
      const total = damages.reduce((sum, d) => sum + (d.type === "healing" ? -d.value : d.value), 0) * (options.multiplier ?? 1);
      const fromTemp = total > 0 ? Math.min(prepared.temp, total) : 0;
      prepared.temp -= fromTemp;
      prepared.value = Math.max(0, Math.min(max, prepared.value - Math.trunc(total - fromTemp)));
      const bloodied = list.findIndex(e => e.id === "bloodied");
      if ( prepared.value <= max / 2 && bloodied < 0 ) {
        list.push({ id: "bloodied", statuses: new Set(["bloodied"]) });
        statuses.add("bloodied");
      } else if ( prepared.value > max / 2 && bloodied >= 0 ) {
        list.splice(bloodied, 1);
        statuses.delete("bloodied");
      }
    }
  };
  return { token: { uuid: "Scene.s.Token.tokB", actor }, actor, calls };
}

describe("a damage card applied, the dnd5e way", () => {
  test("through the actor's applyDamage, by damage type, times the multiplier, the card its origin; the hit points as they were in the record", async () => {
    const m = card("damage", { targets: [goblin] }, [roll(14, "slashing", ["mgc"]), roll(6, "fire")]);
    const { token, actor, calls } = creature({ hp: 30, temp: 5, max: 30 });
    const records = await applyDnd5eDamageCard(m, token, { multiplier: 0.5 });
    expect(calls).toHaveLength(1);
    expect(calls[0].damages).toEqual([{ type: "slashing", properties: new Set(["mgc"]), value: 14 }, { type: "fire", properties: new Set(), value: 6 }]);
    expect(calls[0].options).toMatchObject({ multiplier: 0.5, isDelta: true, originatingMessage: m, origin: m });
    // (Half of 20: 5 off the temporary hit points, 5 off the rest.)
    expect(actor.system.attributes.hp).toMatchObject({ value: 25, temp: 0 });
    expect(records).toHaveLength(1);
    const [undo] = records;
    expect(undo).toMatchObject({ tokenUuid: "Scene.s.Token.tokB", actorUuid: actor.uuid, statusesBefore: [] });
    expect(undo.actorUpdate).toEqual({ "system.attributes.hp.value": 30, "system.attributes.hp.temp": 5, "system.attributes.hp.tempmax": 0 });
    expect(undo.createdEffects).toEqual([]);
  });

  test("what dnd5e lays on along the way is in the record: a new effect by its id, the statuses before", async () => {
    const { token, actor } = creature({ hp: 20, max: 30 });
    const [undo] = await applyDnd5eDamageCard(card("damage", { targets: [goblin] }, [roll(8, "fire")]), token, { multiplier: 2 });
    expect(actor.system.attributes.hp.value).toBe(4);
    expect(undo.createdEffects).toEqual(["bloodied"]);
    expect(undo.statusesBefore).toEqual([]);
  });

  test("healing a downed creature: the death saves it clears, and an effect it lifts, go back too; the stored hit points, not the capped", async () => {
    const bloodied = { id: "bloodied", statuses: new Set(["bloodied"]), toObject: () => ({ _id: "bloodied", name: "Bloodied" }) };
    const { token, calls } = creature({ hp: 0, stored: 0, max: 30, death: { success: 1, failure: 2 }, effects: [bloodied] });
    const [undo] = await applyDnd5eDamageCard(card("healing", { targets: [goblin] }, [roll(20, "healing")]), token);
    expect(calls[0].options.multiplier).toBe(1);
    expect(undo.actorUpdate).toMatchObject({ "system.attributes.hp.value": 0, "system.attributes.death.success": 1, "system.attributes.death.failure": 2 });
    expect(undo.deletedEffects).toEqual([{ _id: "bloodied", name: "Bloodied" }]);
    expect(undo.statusesBefore).toEqual(["bloodied"]);
    // (A sheet whose prepared hit points are capped below what's stored: the stored ones go back.)
    const capped = creature({ hp: 30, stored: 34, max: 30 });
    const [again] = await applyDnd5eDamageCard(card("damage", {}, [roll(3, "cold")]), capped.token);
    expect(again.actorUpdate["system.attributes.hp.value"]).toBe(34);
  });

  test("nothing to apply, nothing applied: no damage roll, no actor, or one without hit points", async () => {
    const { token, calls } = creature();
    expect(await applyDnd5eDamageCard(card("damage", { targets: [goblin] }, []), token)).toEqual([]);
    expect(await applyDnd5eDamageCard(card("damage", {}, [roll(5, "fire")]), { uuid: "Scene.s.Token.t" })).toEqual([]);
    expect(await applyDnd5eDamageCard(card("damage", {}, [roll(5, "fire")]), { uuid: "Scene.s.Token.t", actor: { system: { attributes: {} }, applyDamage: vi.fn() } })).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("the adapter's applyDamageCard is this application (times 1 unless the GM says otherwise)", async () => {
    const { token, calls } = creature({ hp: 20 });
    const records = await new Dnd5eAdapter().applyDamageCard(card("damage", { targets: [goblin] }, [roll(5, "fire")]), token);
    expect(calls[0].options.multiplier).toBe(1);
    expect(records[0].actorUpdate["system.attributes.hp.value"]).toBe(20);
  });

  test("halved, in a live battle, by a reaction the target used against the blow (Uncanny Dodge): dnd5e's own application at half", async () => {
    const { token, calls } = creature({ hp: 20 });
    await new Dnd5eAdapter().applyDamageCard(card("damage", { targets: [goblin] }, [roll(8, "slashing")]), token, { multiplier: 1, halve: true });
    expect(calls[0].options.multiplier).toBe(0.5);
  });
});

describe("dnd5e's own settings and players' damage", () => {
  test("none applies it by itself: Allow Player Damage Application (their own tokens, at a click) and Auto-Apply Downed don't count", () => {
    globalThis.dnd5e = { settings: { allowPlayerDamageTray: true, autoApplyDowned: "all" } };
    Object.assign(globalThis.game, { settings: { get: () => true }, modules: { get: () => ({ active: true }) } });
    expect(new Dnd5eAdapter().appliesPlayerDamage()).toBeNull();
  });
});
