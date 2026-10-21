/**
 * The engine's own dice as dnd5e's own cards (table-cards.js, the core's showTableRoll): which card a table roll is,
 * its D20Roll or DamageRolls holding the engine's dice exactly, and the card posted: its type, its activity, whom it's
 * at, to whom, marked as FastFighting's. Anything dnd5e has no card for: the core's plain roll.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cardKind, d20RollData, damageRollData, showDnd5eTableRoll } from "../scripts/table-cards.js";
import { Dnd5eAdapter } from "../scripts/adapter.js";
import { dnd5eRules } from "../scripts/rules.js";
import { rollCheck, STATUS } from "../scripts/core.js";
import { createRng } from "../../FastFighting/scripts/engine/rng.js";
import { recordingRng } from "../../FastFighting/scripts/engine/table-rolls.js";

/** A save or a check the engine rolls, as a live battle records it. */
function recorded(options, mod = 4, dc = 14) {
  const rng = recordingRng(createRng(7));
  rollCheck(dnd5eRules, rng, mod, dc, options);
  return rng.tray.rolls[0];
}
/** A damage roll as the engine records one: its parts by type, each die as it fell. */
const damage = (kind = "damage") => ({
  kind, by: "orc", target: "pc", action: "orc.axe.atk", source: "attack",
  groups: [{ part: 0, faces: 12, results: [9], type: "slashing" }, { part: 0, flat: 3, type: "slashing" }, { part: 1, faces: 6, results: [2, 5], type: "fire", sign: 1 }]
});

describe("which card", () => {
  test("an attack, a save (a death save dnd5e's own), a check of a skill or an ability, damage, healing; else none", () => {
    expect(cardKind({ kind: "attack" })).toEqual({ type: "attack", system: {} });
    expect(cardKind({ kind: "save", stat: "dex" })).toEqual({ type: "save", system: { type: "ability", ability: "dex" } });
    expect(cardKind({ kind: "save", what: "recovery" })).toEqual({ type: "save", system: { type: "death" } });
    expect(cardKind({ kind: "check", stat: "ste" })).toEqual({ type: "check", system: { type: "ability", ability: "dex", skill: "ste" } });
    expect(cardKind({ kind: "check", stat: "str" })).toEqual({ type: "check", system: { type: "ability", ability: "str" } });
    expect(cardKind({ kind: "healing" })).toEqual({ type: "healing", system: {} });
    for ( const roll of [{ kind: "recharge" }, { kind: "flat" }, { kind: "check" }, { kind: "save", stat: "reflex" }, null] ) expect(cardKind(roll)).toBeNull();
  });
});

describe("the engine's dice as dnd5e keeps them", () => {
  test("a save with advantage: a D20Roll of both d20s, the higher kept, its modifier, total and DC", () => {
    const roll = recorded({ kind: "save", by: "orc", stat: "wis", advantage: 1 });
    const data = d20RollData(roll);
    expect(data).toMatchObject({ class: "D20Roll", total: roll.total, evaluated: true, options: { target: 14, advantageMode: 1 } });
    const die = data.terms.find(x => x.class === "Die");
    expect(die).toMatchObject({ faces: 20, number: 2, modifiers: ["kh"] });
    expect(die.results.filter(r => r.active).map(r => r.result)).toEqual([roll.natural]);
    expect(d20RollData({ kind: "save", groups: [{ faces: 6, results: [3] }] })).toBeNull();
  });

  test("damage: a DamageRoll a part, of its type, every die as it fell; healing as healing", () => {
    const [slash, fire] = damageRollData(damage(), { properties: ["mgc"] });
    expect(slash).toMatchObject({ class: "DamageRoll", formula: "1d12 + 3", total: 12, options: { type: "slashing", types: ["slashing"], properties: ["mgc"] } });
    expect(slash.terms[0]).toMatchObject({ class: "Die", faces: 12, number: 1, results: [{ result: 9, active: true }] });
    expect(fire).toMatchObject({ formula: "2d6", total: 7, options: { type: "fire" } });
    const [heal] = damageRollData({ kind: "healing", groups: [{ part: 0, faces: 4, results: [3], type: "healing" }, { part: 0, flat: 2, type: "healing" }] });
    expect(heal).toMatchObject({ formula: "1d4 + 2", total: 5, options: { type: "healing" } });
    expect(damageRollData({ kind: "damage", groups: [] })).toEqual([]);
  });
});

describe("posted", () => {
  let create;
  beforeEach(() => {
    create = vi.fn(async data => ({ id: "card1", ...data }));
    globalThis.CONFIG = { ChatMessage: { documentClass: { create, getSpeaker: ({ token }) => ({ token: token.id, alias: token.name }) } }, sounds: { dice: "dice.wav" } };
    globalThis.foundry = { dice: { Roll: { fromData: data => ({ data }) } } };
    globalThis.game.users = [{ id: "gm", isGM: true }, { id: "p1", isGM: false }];
  });
  afterEach(() => { delete globalThis.CONFIG; delete globalThis.foundry; delete globalThis.game.users; });

  const token = { id: "tokOrc", name: "Orc", actor: { id: "orc" } };
  const target = { id: "tokPc", name: "Lem", actor: { id: "pc" } };
  const axe = { uuid: "Actor.orc.Item.axe.Activity.atk", item: { id: "axe" } };

  test("damage: dnd5e's damage card, its activity and target, to the GMs alone, marked as FastFighting's with the core's flags", async () => {
    const ids = await showDnd5eTableRoll(damage(), {
      token, target, audience: "gm", flavor: "Greataxe", flags: { "fast-fighting": { live: { battle: "b" } } },
      activityOf: (actor, id) => (actor.id === "orc" && id === "orc.axe.atk" ? { activity: axe, item: axe.item } : null),
      targetsOf: t => [{ name: t.name, ac: 15 }], properties: () => ["sil"]
    });
    expect(ids).toEqual(["card1"]);
    const data = create.mock.calls[0][0];
    expect(data).toMatchObject({
      type: "damage", speaker: { token: "tokOrc" }, flavor: "Greataxe", whisper: ["gm"],
      system: { activity: { uuid: axe.uuid }, targets: [{ name: "Lem", ac: 15 }] },
      flags: { "fast-fighting": { live: { battle: "b" } }, "fast-fighting-dnd5e": { rolled: { times: 1 } } }
    });
    expect(data.rolls.map(r => r.data.options.type)).toEqual(["slashing", "fire"]);
    expect(data.rolls[0].data.options.properties).toEqual(["sil"]);
  });

  test("a death save: dnd5e's death save card, to everyone, at no one", async () => {
    const rng = recordingRng(createRng(3));
    dnd5eRules.recoveryCheck({ id: "pc", spec: {}, status: STATUS.DOWN, stable: false }, rng);
    const [roll] = rng.tray.rolls;
    await showDnd5eTableRoll(roll, { token: target, target: null, audience: "public" });
    expect(create.mock.calls[0][0]).toMatchObject({ type: "save", whisper: [], system: { type: "death" } });
    expect(create.mock.calls[0][0].rolls[0].data.options.target).toBe(10);
  });

  test("none (the core's plain roll): a recharge, a roll with no token, nothing to post with", async () => {
    expect(await showDnd5eTableRoll({ kind: "recharge", groups: [{ faces: 6, results: [5] }] }, { token })).toBeNull();
    expect(await showDnd5eTableRoll(damage(), { token: null })).toBeNull();
    delete globalThis.CONFIG.ChatMessage;
    expect(await showDnd5eTableRoll(damage(), { token })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  test("the adapter offers it, the strike's activity found by the adapter's ids", async () => {
    const atk = { id: "atk", type: "attack", uuid: "Actor.orc.Item.axe.Activity.atk", rollAttack: () => {}, item: { id: "axe" } };
    const actor = { id: "orc", items: { get: id => (id === "axe" ? { id: "axe", system: { activities: Object.assign([atk], { get: k => (k === "atk" ? atk : null) }) } } : null) } };
    await new Dnd5eAdapter().showTableRoll(damage(), { token: { ...token, actor }, target: null, audience: "public" });
    expect(create.mock.calls[0][0].system.activity).toEqual({ uuid: atk.uuid });
  });
});
