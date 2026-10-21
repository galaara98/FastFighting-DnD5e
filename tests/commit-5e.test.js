/**
 * A live turn's spell effects on the sheet: a buff or debuff laid this turn goes on as the spell's own effect (for the
 * rounds it has, marked as FastFighting's), and comes off when it ends, each in the undo record.
 */
import { afterEach, describe, expect, test } from "vitest";
import { commitDnd5eChanges } from "../scripts/commit.js";
import { text } from "./foundry-i18n.js";

const before = { fromUuid: globalThis.fromUuid, foundry: globalThis.foundry, game: globalThis.game };
afterEach(() => Object.assign(globalThis, before));

/** An actor whose ActiveEffects are a plain list, with the calls made on it kept. */
function actorWith(effects = []) {
  const calls = { created: [], deleted: [] };
  const list = [...effects];
  const actor = {
    uuid: "Actor.a", type: "npc", statuses: new Set(), system: {}, items: { get: () => null },
    effects: Object.assign(list, { has: id => list.some(e => e.id === id) }),
    async createEmbeddedDocuments(type, data) {
      calls.created.push({ type, data });
      return data.map((d, i) => ({ id: `made${i}` }));
    },
    async deleteEmbeddedDocuments(type, ids) {
      calls.deleted.push({ type, ids });
    }
  };
  return { actor, calls };
}

describe("a spell's effects in a live turn", () => {
  test("laid: the spell's own effect, for the rounds it has, marked as laid by whom", async () => {
    const bless = { documentName: "Item", uuid: "Item.bless", effects: { get: id => (id === "fx" ? { toObject: () => ({ _id: "fx", name: "Bless", statuses: [], flags: {} }) } : null) } };
    globalThis.fromUuid = async uuid => (uuid === "Item.bless" ? bless : null);
    globalThis.foundry = { utils: { getProperty: () => undefined } };
    const { actor, calls } = actorWith();
    const source = { action: { effectRef: { uuid: "Item.bless", ids: ["fx"] } } };
    const undo = await commitDnd5eChanges({ uuid: "Token.t", actor }, { actions: [] }, { effects: { added: [{ key: "bless", sourceId: "cleric", rounds: 9 }], ended: [] } },
      { status: "standing" }, { effectSource: key => (key === "bless" ? source : null) });
    expect(calls.created).toHaveLength(1);
    const [made] = calls.created[0].data;
    expect(made._id).toBeUndefined();
    expect(made).toMatchObject({ name: "Bless", origin: "Item.bless", transfer: false, duration: { value: 9, units: "rounds" } });
    expect(made.flags["fast-fighting"].laid).toEqual({ key: "bless", sourceId: "cleric" });
    expect(undo.createdEffects).toEqual(["made0"]);
  });

  test("from an item a player could write: only as the engine plays it (no status it doesn't, no macro, no other module's flags)", async () => {
    const effect = {
      _id: "fx", name: "Bane", statuses: ["dead", "frightened"],
      changes: [{ key: "system.bonuses.abilities.save", mode: 2, value: "-1d4" }, { key: "macro.execute", mode: 0, value: "PwnTheGM" }, { key: "system.attributes.hp.value", mode: 5, value: "0" }],
      flags: { dae: { macroRepeat: "startEveryTurn" }, "midi-qol": { x: 1 }, dnd5e: { type: "spell" } }
    };
    const players = ["p1"];
    const bane = { documentName: "Item", uuid: "Actor.pc.Item.bane", testUserPermission: (u, level) => level === "OWNER" && players.includes(u.id), effects: { get: () => ({ toObject: () => structuredClone(effect) }) } };
    globalThis.fromUuid = async () => bane;
    globalThis.foundry = { utils: { getProperty: () => undefined } };
    globalThis.game = { users: [{ id: "gm", isGM: true }, { id: "p1", isGM: false }] };
    const source = { action: { effectRef: { uuid: bane.uuid, ids: ["fx"] } } };
    const lay = async () => {
      const { actor, calls } = actorWith();
      await commitDnd5eChanges({ uuid: "Token.t", actor }, { actions: [] }, { effects: { added: [{ key: "bane", sourceId: "pc", rounds: 3 }], ended: [] } }, { status: "standing" }, { effectSource: () => source });
      return calls.created[0].data[0];
    };
    const played = await lay();
    expect(played.statuses).toEqual(["frightened"]);
    expect(played.changes).toEqual([{ key: "system.bonuses.abilities.save", mode: 2, value: "-1d4" }]);
    expect(Object.keys(played.flags).sort()).toEqual(["dnd5e", "fast-fighting"]);
    // (The GM's own spell, owned by no player: copied as it is.)
    players.length = 0;
    const whole = await lay();
    expect(whole.statuses).toEqual(["dead", "frightened"]);
    expect(whole.changes).toHaveLength(3);
    expect(whole.flags.dae).toBeTruthy();
    // (v14 keeps them in system.changes, each with a type: filtered there, and none added at the top.)
    players.push("p1");
    const v14 = effect.changes.map(({ mode, ...c }) => ({ ...c, type: { 0: "custom", 2: "add", 5: "override" }[mode] }));
    Object.assign(effect, { changes: undefined, system: { changes: v14 } });
    delete effect.changes;
    const later = await lay();
    expect(later.system.changes).toEqual([{ key: "system.bonuses.abilities.save", type: "add", value: "-1d4" }]);
    expect(later.changes).toBeUndefined();
  });

  test("not an item, nothing laid; ended, the one laid for it comes off and the record can put it back", async () => {
    globalThis.fromUuid = async () => ({ documentName: "Actor", effects: { get: () => ({ toObject: () => ({ name: "x" }) }) } });
    globalThis.foundry = { utils: { getProperty: () => undefined } };
    const mark = (key, sourceId) => ({ getFlag: (scope, k) => (scope === "fast-fighting" && k === "laid" ? { key, sourceId } : null) });
    const laid = { id: "e1", ...mark("bless", "cleric"), toObject: () => ({ _id: "e1", name: "Bless" }) };
    const other = { id: "e2", ...mark("bless", "bard"), toObject: () => ({ _id: "e2" }) };
    const { actor, calls } = actorWith([laid, other]);
    const source = { action: { effectRef: { uuid: "Actor.x", ids: ["fx"] } } };
    const undo = await commitDnd5eChanges({ uuid: "Token.t", actor }, { actions: [] },
      { effects: { added: [{ key: "bane", sourceId: "x", rounds: 3 }], ended: [{ key: "bless", sourceId: "cleric" }] } }, { status: "standing" }, { effectSource: () => source });
    expect(calls.created).toHaveLength(0);
    expect(calls.deleted).toEqual([{ type: "ActiveEffect", ids: ["e1"] }]);
    expect(undo.deletedEffects).toEqual([{ _id: "e1", name: "Bless" }]);
  });
});

describe("who got what (core API 21)", () => {
  /** A turn's changes written with the core's options, the cards it posted kept. */
  async function told({ action, added = [], left = null, audience = () => "public", secret = false, spec = { id: "lem", actions: [] } }) {
    const posted = [];
    globalThis.CONFIG = { ChatMessage: { documentClass: { create: async data => { posted.push(data); return { id: `m${posted.length}` }; }, getSpeaker: ({ token }) => ({ alias: token.name }) } } };
    globalThis.fromUuid = async () => null;
    globalThis.foundry = { utils: { getProperty: () => undefined } };
    globalThis.game = { ...before.game, users: [{ id: "gm", isGM: true }, { id: "p1", isGM: false }] };
    const { actor } = actorWith();
    actor.getFlag = (scope, key) => (scope === "fast-fighting" && key === "secretName" ? secret : undefined);
    const tokens = { cleric: { name: "Kyra", actor: {} }, lem: { name: "Lem", actor } };
    await commitDnd5eChanges({ uuid: "Token.t", name: "Lem", actor }, spec, { effects: { added, ended: [] }, ...(left ? { left } : {}) }, { status: "standing" },
      { effectSource: () => ({ action }), tokenOf: id => tokens[id] ?? null, audience });
    delete globalThis.CONFIG;
    return posted;
  }
  const bless = { name: "Bless", kind: "buff" };

  test("a buff laid on another: a card from its giver naming who got it and what", async () => {
    const [card, more] = await told({ action: bless, added: [{ key: "bless", sourceId: "cleric", label: "blessed" }] });
    expect(more).toBeUndefined();
    expect(card.speaker).toEqual({ alias: "Kyra" });
    expect(card.content).toContain("Bless");
    expect(card.content).toContain("Lem");
    expect(card.content).toContain("blessed");
    expect(card.whisper).toBeUndefined();
  });

  test("the GMs' alone where one of them is hidden; a secret name the GMs' alone; one left to the table, waiting", async () => {
    const [hidden] = await told({ action: bless, added: [{ key: "bless", sourceId: "cleric" }], audience: id => (id === "cleric" ? "gm" : "public") });
    expect(hidden.whisper).toEqual(["gm"]);
    const [secret] = await told({ action: bless, added: [{ key: "bless", sourceId: "cleric" }], secret: true });
    expect(secret.content).toContain('data-visibility="gm"');
    const [waits] = await told({ action: bless, left: { effects: [{ key: "bless", sourceId: "cleric" }], laid: [] } });
    expect(waits.content).toContain(text("FFDND5E.GivenWaits", { action: "Bless", target: "Lem", effect: "Bless" }));
  });

  test("none where a roll of dnd5e's names it (a save, an attack), nor a potion its user drank, nor without the core's options", async () => {
    expect(await told({ action: { name: "Hold Person", save: { type: "wis", dc: 14 } }, added: [{ key: "hold", sourceId: "cleric" }] })).toEqual([]);
    expect(await told({ action: { name: "Guiding Bolt", kind: "spell-attack", bonus: 5 }, added: [{ key: "bolt", sourceId: "cleric" }] })).toEqual([]);
    expect(await told({ action: { name: "Potion", selfOnly: true }, added: [{ key: "potion", sourceId: "lem" }] })).toEqual([]);
    const { actor } = actorWith();
    globalThis.foundry = { utils: { getProperty: () => undefined } };
    await expect(commitDnd5eChanges({ uuid: "Token.t", actor }, { actions: [] }, { effects: { added: [], ended: [] } }, { status: "standing" }, {})).resolves.toBeTruthy();
  });
});
