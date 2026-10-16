/**
 * A live battle's conditions on a dnd5e sheet, both ways: each condition the sheet carries is written as its status
 * (exhaustion as its level) and read back as the same key, and taken off again; what dnd5e has no status for the core
 * keeps, and nothing is written for it. Against an actor that keeps its statuses as dnd5e does: each status its own
 * effect (by its static id), some meaning others too (Stunned is Incapacitated), Unconscious bringing Prone with it.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Dnd5eAdapter } from "../scripts/adapter.js";
import { commitDnd5eChanges } from "../scripts/commit.js";
import { SHEET_STATUSES, sheetCarries } from "../scripts/conditions.js";
import { CORE_CONDITIONS } from "../../fast-fighting/scripts/engine/conditions.js";

/** The keys a dnd5e sheet carries: the engine's, with the status that shows each (exhaustion: its level). */
const CARRIED = {
  prone: "prone", blinded: "blinded", charmed: "charmed", deafened: "deafened", frightened: "frightened", grabbed: "grappled",
  incapacitated: "incapacitated", invisible: "invisible", paralyzed: "paralyzed", petrified: "petrified", poisoned: "poisoned",
  restrained: "restrained", stunned: "stunned", unconscious: "unconscious", asleep: "sleeping", silenced: "silenced", hidden: "hiding",
  burning: "burning", exhaustion: null
};

/** dnd5e's statuses that mean others too (its conditionTypes' and statusEffects' `statuses`), and Unconscious's rider. */
const IMPLIES = { paralyzed: ["incapacitated"], petrified: ["incapacitated"], stunned: ["incapacitated"], unconscious: ["incapacitated"], sleeping: ["incapacitated", "unconscious"] };
const RIDERS = { unconscious: ["prone"] };
const STATUSES = ["blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified",
  "poisoned", "prone", "restrained", "silenced", "stunned", "unconscious", "dead", "dodging", "hiding", "sleeping", "burning"];
/** dnd5e's static id for a status's effect. */
const idOf = status => `dnd5e${status}`.padEnd(16, "0").slice(0, 16);

/** CONFIG as dnd5e sets it up: its statuses by id (each with its effect's id), and the names of its conditions. */
function configure({ without = [] } = {}) {
  const ids = STATUSES.filter(s => !without.includes(s));
  globalThis.CONFIG = {
    statusEffects: Object.fromEntries(ids.map(id => [id, { id, _id: idOf(id) }])),
    DND5E: {
      conditionTypes: { grappled: { name: "Grappled" }, frightened: { name: "Frightened" }, exhaustion: { name: "Exhaustion", levels: 6 } },
      statusEffects: Object.fromEntries([["sleeping", { name: "Sleeping" }], ["hiding", { name: "Hiding" }]].filter(([id]) => ids.includes(id)))
    }
  };
}

const listOf = list => Object.assign(list, { get: id => list.find(i => i.id === id) });
const getProperty = (o, path) => path.split(".").reduce((x, k) => x?.[k], o);

/** An npc as dnd5e prepares one, its statuses kept on effects the way dnd5e keeps them, with the toggles made on it. */
function sheet({ statuses = [], exhaustion = 0 } = {}) {
  const effects = new Map();
  const put = id => {
    if ( effects.has(idOf(id)) ) return;
    const all = new Set([id, ...(IMPLIES[id] ?? [])]);
    effects.set(idOf(id), { id: idOf(id), disabled: false, statuses: all });
    for ( const s of all ) for ( const r of RIDERS[s] ?? [] ) put(r);
  };
  statuses.forEach(put);
  const toggles = [];
  const actor = {
    id: "goblin", uuid: "Actor.goblin", type: "npc", name: "Goblin", img: "", flags: {}, appliedEffects: [], classes: {}, items: listOf([]),
    get statuses() { return new Set([...effects.values()].flatMap(e => [...e.statuses])); },
    effects: { get: id => effects.get(id), [Symbol.iterator]: () => effects.values() },
    toggles,
    async toggleStatusEffect(id, { active } = {}) {
      if ( !globalThis.CONFIG.statusEffects[id] ) throw new Error(`Invalid status ID "${id}"`);
      toggles.push({ id, active });
      const key = idOf(id);
      if ( effects.has(key) ) {
        if ( active ) return true;
        effects.delete(key);
        return false;
      }
      if ( active === false ) return undefined;
      put(id);
      return effects.get(key);
    },
    updates: [],
    async update(data) {
      this.updates.push(data);
      for ( const [path, value] of Object.entries(data) ) {
        const keys = path.split(".");
        keys.slice(0, -1).reduce((o, k) => (o[k] ??= {}), this)[keys.at(-1)] = value;
      }
    },
    system: {
      abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(k => [k, { value: 10, mod: 0, save: 0 }])),
      attributes: { hp: { value: 7, max: 7, temp: 0 }, ac: { value: 15 }, movement: { walk: 30, units: "ft" }, senses: {}, death: {}, exhaustion },
      details: { cr: 0.25, type: { value: "humanoid" } },
      skills: Object.fromEntries(["slt", "ste", "prc", "ins", "per", "itm", "dec", "med", "ath"].map(k => [k, { total: 1, passive: 11 }])),
      traits: { size: "sm", languages: { value: new Set() }, di: {}, dr: {}, dv: {}, ci: {} },
      resources: {}, currency: {}, spells: {}
    }
  };
  return actor;
}

const adapter = new Dnd5eAdapter();
/** The engine's conditions on its sheet, as a live battle reads them each turn. */
const read = async actor => (await adapter.readLiveState({ id: "token", name: actor.name, actor })).conditions;
/** One turn's changes written onto it (final: its state after the turn). */
const commit = (actor, changes, final = {}) => commitDnd5eChanges({ uuid: "Token.t", actor }, { actions: [] }, changes, { status: "standing", conditions: {}, ...final });
const setting = (key, value = 1) => (key === "prone" ? { prone: { from: false, to: true } } : { conditions: { set: { [key]: value }, cleared: [] } });
const clearing = key => (key === "prone" ? { prone: { from: true, to: false } } : { conditions: { set: {}, cleared: [key] } });

beforeEach(() => {
  configure();
  globalThis.foundry = { utils: { getProperty } };
});
afterEach(() => {
  delete globalThis.CONFIG;
  delete globalThis.foundry;
});

describe("the conditions a dnd5e sheet carries", () => {
  test.each(Object.keys(CARRIED))("%s: set, it's on the sheet and read back as itself; cleared, it's gone", async key => {
    const actor = sheet();
    expect(sheetCarries(key)).toBe(true);
    expect(adapter.sheetCarries(key)).toBe(true);
    expect((await read(actor))[key]).toBeUndefined();
    const value = key === "exhaustion" ? 2 : 1;
    const on = await commit(actor, setting(key, value));
    expect((await read(actor))[key]).toBe(value);
    if ( CARRIED[key] ) {
      expect(actor.toggles[0]).toEqual({ id: CARRIED[key], active: true });
      expect(on.statuses).toEqual([{ id: CARRIED[key], active: false, overlay: false }]);
    } else expect(on.actorUpdate).toEqual({ "system.attributes.exhaustion": 0 });
    await commit(actor, clearing(key));
    expect((await read(actor))[key]).toBeUndefined();
  });

  test("they are the ones the table lists, and dnd5e's choices offer each (exhaustion counted), before the core's", () => {
    expect(Object.keys(CARRIED).filter(k => k !== "exhaustion").sort()).toEqual(Object.keys(SHEET_STATUSES).sort());
    for ( const [key, status] of Object.entries(SHEET_STATUSES) ) expect([key, status]).toEqual([key, CARRIED[key]]);
    const choices = adapter.conditionChoices();
    const own = choices.slice(0, Object.keys(CARRIED).length);
    expect(own.map(c => c.key).sort()).toEqual(Object.keys(CARRIED).sort());
    expect(own.filter(c => c.valued).map(c => c.key)).toEqual(["exhaustion"]);
    expect(choices.slice(own.length)).toEqual([...CORE_CONDITIONS]);
  });

  test("the engine's others it has no status for aren't carried, and nothing is written for them", async () => {
    const others = [...CORE_CONDITIONS.map(c => c.key), "controlled"].filter(k => !(k in CARRIED));
    expect(others).toEqual(expect.arrayContaining(["offGuard", "dazed", "immobilized", "controlled"]));
    for ( const key of others ) expect([key, adapter.sheetCarries(key)]).toEqual([key, false]);
    for ( const key of others.filter(k => k !== "controlled") ) {
      const actor = sheet();
      const undo = await commit(actor, setting(key));
      expect([key, actor.toggles, actor.updates, undo.statuses]).toEqual([key, [], [], []]);
      expect([key, (await read(actor))[key]]).toEqual([key, undefined]);
    }
  });

  test("a world whose dnd5e has no such status (an older one: no Hiding) doesn't carry it, nor offer it, nor write it", async () => {
    configure({ without: ["hiding"] });
    expect(adapter.sheetCarries("hidden")).toBe(false);
    const choices = adapter.conditionChoices();
    expect(choices.slice(0, choices.length - CORE_CONDITIONS.length).map(c => c.key)).not.toContain("hidden");
    const actor = sheet();
    await commit(actor, setting("hidden"));
    expect(actor.toggles).toEqual([]);
  });
});

describe("what else a status means", () => {
  test("read: Grappled and Restrained hold it in place; Stunned, Paralyzed, Unconscious and Sleeping leave it unable to act", async () => {
    expect(await read(sheet({ statuses: ["grappled"] }))).toEqual({ grabbed: 1, immobilized: 1 });
    expect(await read(sheet({ statuses: ["restrained"] }))).toEqual({ restrained: 1, immobilized: 1 });
    expect(await read(sheet({ statuses: ["stunned"] }))).toEqual({ stunned: 1, incapacitated: 1 });
    expect(await read(sheet({ statuses: ["paralyzed"] }))).toEqual({ paralyzed: 1, incapacitated: 1 });
    expect(await read(sheet({ statuses: ["unconscious"] }))).toEqual({ unconscious: 1, incapacitated: 1, prone: 1 });
    expect(await read(sheet({ statuses: ["sleeping"] }))).toEqual({ asleep: 1, unconscious: 1, incapacitated: 1, prone: 1 });
    expect(await read(sheet({ exhaustion: 3 }))).toEqual({ exhaustion: 3 });
  });

  test("set together, one that means the other goes on alone (Unconscious, not Incapacitated as well); cleared, it comes off", async () => {
    const actor = sheet();
    await commit(actor, { conditions: { set: { unconscious: 1, incapacitated: 1 }, cleared: [] } });
    expect(actor.toggles).toEqual([{ id: "unconscious", active: true }]);
    expect(await read(actor)).toEqual({ unconscious: 1, incapacitated: 1, prone: 1 });
    await commit(actor, { conditions: { set: {}, cleared: ["unconscious", "incapacitated"] } });
    expect(actor.toggles.slice(1)).toEqual([{ id: "unconscious", active: false }]);
    expect(await read(actor)).toEqual({ prone: 1 });
  });

  test("one only part of another's isn't taken off by itself: no toggle, nothing for the record to put on", async () => {
    const actor = sheet({ statuses: ["stunned"] });
    const undo = await commit(actor, clearing("incapacitated"));
    expect(actor.toggles).toEqual([]);
    expect(undo.statuses).toEqual([]);
    expect(await read(actor)).toEqual({ stunned: 1, incapacitated: 1 });
  });
});

describe("control, shown as Charmed", () => {
  test("controlled is written as Charmed, read back as charmed (the core keeps who holds it), and taken off when it ends", async () => {
    const actor = sheet();
    await commit(actor, setting("controlled"));
    expect(actor.toggles).toEqual([{ id: "charmed", active: true }]);
    expect(await read(actor)).toEqual({ charmed: 1 });
    // (The sheet's Charmed read back: still in the engine's conditions when control ends.)
    await commit(actor, clearing("controlled"), { conditions: { charmed: 1 } });
    expect(await read(actor)).toEqual({});
  });

  test("Charmed stays while control holds it, or when it's set as control ends", async () => {
    const actor = sheet({ statuses: ["charmed"] });
    await commit(actor, clearing("charmed"), { conditions: { controlled: 1 } });
    await commit(actor, { conditions: { set: { charmed: 1 }, cleared: ["controlled"] } }, { conditions: { charmed: 1 } });
    expect(actor.toggles).toEqual([]);
    expect(await read(actor)).toEqual({ charmed: 1 });
  });
});

describe("exhaustion, by its level", () => {
  test("set: its level on the sheet (at most dnd5e's last), the old one kept to undo; cleared: none", async () => {
    const actor = sheet({ exhaustion: 1 });
    const undo = await commit(actor, setting("exhaustion", 9));
    expect(actor.updates).toEqual([{ "system.attributes.exhaustion": 6 }]);
    expect(undo.actorUpdate).toEqual({ "system.attributes.exhaustion": 1 });
    await commit(actor, clearing("exhaustion"));
    expect(actor.system.attributes.exhaustion).toBe(0);
    expect(actor.toggles).toEqual([]);
  });
});

describe("falling, getting up, dying", () => {
  test("falling: Unconscious, with the Prone it brings, once; and up again, Unconscious off", async () => {
    const actor = sheet();
    await commit(actor, { fell: true, hp: { from: 3, to: 0 } }, { status: "down" });
    expect(actor.toggles).toEqual([{ id: "unconscious", active: true }]);
    expect(await read(actor)).toEqual({ unconscious: 1, incapacitated: 1, prone: 1 });
    await commit(actor, { revived: true, hp: { from: 0, to: 4 }, conditions: { set: {}, cleared: ["unconscious"] } });
    expect(actor.toggles.slice(1)).toEqual([{ id: "unconscious", active: false }]);
    expect(await read(actor)).toEqual({ prone: 1 });
  });

  test("dead: no conditions written, only the overlay", async () => {
    const actor = sheet();
    await commit(actor, { died: true, fell: true, conditions: { set: { frightened: 1 }, cleared: [] } }, { status: "dead" });
    expect(actor.toggles).toEqual([{ id: "dead", active: true }]);
  });
});

describe("dnd5e's names for its conditions", () => {
  test("the system's own (Grappled for the engine's grabbed, Sleeping for asleep); none for the engine's others", () => {
    expect(adapter.conditionLabel("grabbed")).toBe("Grappled");
    expect(adapter.conditionLabel("frightened")).toBe("Frightened");
    expect(adapter.conditionLabel("asleep")).toBe("Sleeping");
    expect(adapter.conditionLabel("exhaustion")).toBe("Exhaustion");
    expect(adapter.conditionLabel("offGuard")).toBeNull();
    expect(adapter.conditionLabel("immobilized")).toBeNull();
    expect(adapter.conditionLabel("controlled")).toBeNull();
  });

  test("none where the system isn't translated into the table's language: FastFighting's own word stands in", () => {
    // (A Spanish table; dnd5e has no Spanish of its own: none of its keys has words without falling back to English.)
    globalThis.game = { i18n: { ...globalThis.game.i18n, lang: "es", has: () => false } };
    expect(adapter.conditionLabel("grabbed")).toBeNull();
  });
});
