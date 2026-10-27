/**
 * Minions (core API 32): whom a summoned creature serves, as dnd5e records it (flags.dnd5e.summon.origin), and the
 * command Animate Dead's creatures wait for (a bonus action for all that one spell made: core API 35's `once`).
 */
import { afterEach, describe, expect, test } from "vitest";
import { Dnd5eAdapter } from "../scripts/adapter.js";

const was = { game: globalThis.game, Roll: globalThis.Roll };
afterEach(() => Object.assign(globalThis, was));
const listOf = list => Object.assign(list, { get: id => list.find(i => i.id === id), getName: name => list.find(i => i.name === name) });

/** A creature as dnd5e prepares one, with only what these tests look at; `origin`, what summoned it. */
const actorOf = origin => ({
  id: "skel", uuid: "Actor.skel", type: "npc", name: "Skeleton", img: "", statuses: new Set(), appliedEffects: [], classes: {},
  flags: origin ? { dnd5e: { summon: { origin } } } : {}, items: listOf([]), getRollData: () => ({}), toObject() { return { name: this.name }; },
  system: {
    abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(k => [k, { value: 10, mod: 0, save: 0 }])),
    attributes: { hp: { value: 13, max: 13, temp: 0 }, ac: { value: 13 }, movement: { walk: 30, units: "ft" }, senses: {}, death: {} },
    details: { cr: 0.25, type: { value: "undead" } }, skills: {},
    traits: { size: "med", languages: { value: new Set() }, di: {}, dr: {}, dv: {}, ci: {} }, resources: {}, currency: {}, spells: {}
  }
});
const specOf = origin => new Dnd5eAdapter().toCombatantSpec({ id: "t", name: "Skeleton", actor: actorOf(origin) });

describe("whom a summoned creature serves", () => {
  test("Animate Dead's: its necromancer, commanded with a bonus action shared by all that spell made", async () => {
    globalThis.Roll = { replaceFormulaData: f => f };
    const necro = { items: listOf([{ id: "ad", system: { identifier: "animate-dead" } }, { id: "ff", system: { identifier: "find-familiar" } }]) };
    globalThis.game = { ...was.game, actors: { get: id => (id === "necro" ? necro : null) } };
    expect((await specOf("Actor.necro.Item.ad")).flags).toMatchObject({ masterActorId: "necro", command: { bonus: 1, once: "necro.ad" } });
    // (A familiar obeys with no action of its master's: it acts on its own.)
    const familiar = (await specOf("Actor.necro.Item.ff")).flags;
    expect(familiar.masterActorId).toBe("necro");
    expect(familiar.command).toBeUndefined();
    expect((await specOf(null)).flags.masterActorId).toBeUndefined();
  });
});
