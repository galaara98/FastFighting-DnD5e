/**
 * A strike rolled with dnd5e's own rolls in a live battle (core API 19 rollStrike): the attack activity the engine's
 * strike came from, found by its id; rolled at the target (its AC and the cards' targets given to the roll, the user's
 * own targets left alone), with no dialog, in the mode it's made in (in hand, thrown, a shot), with the engine's
 * advantage, for the GMs only when secret; its degree (critical, hit, miss, fumble) with the natural d20 and the total;
 * on a hit its damage by type as rolled, a critical's rolled as one; and null where it can't be.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Dnd5eAdapter, attackActivityOf, rollDnd5eStrike } from "../scripts/adapter.js";

const was = { dnd5e: globalThis.dnd5e, ChatMessage: globalThis.ChatMessage, Roll: globalThis.Roll };
afterEach(() => {
  for ( const [k, v] of Object.entries(was) ) {
    if ( v === undefined ) delete globalThis[k];
    else globalThis[k] = v;
  }
});

/** Foundry's Roll.replaceFormulaData, as far as these tests need it. */
const replaceFormulaData = (formula, data) => String(formula).replace(/@([a-z.0-9_-]+)/gi, (m, term) => String(term.split(".").reduce((o, k) => o?.[k], data) ?? 0));
beforeEach(() => { globalThis.Roll = { replaceFormulaData }; });

const listOf = list => Object.assign(list, { get: id => list.find(i => i.id === id), getName: name => list.find(i => i.name === name) });

/** An attack roll as dnd5e's D20Roll gives it back: its total, its kept d20, and whether it's a critical or a fumble. */
const d20 = (natural, total, { crit = natural === 20, fumble = natural === 1, options = {} } = {}) => ({
  total, d20: { total: natural }, isCritical: crit, isFumble: fumble, options: { ability: "str", attackMode: "oneHanded", ...options }
});
const damageRoll = (total, type) => ({ total, options: { type } });

/**
 * An attack activity as dnd5e prepares one, with only what the spec and the roll look at: a hit for 1d8 + 3; its
 * rollAttack and rollDamage keep what they're asked, and give back the rolls a test sets.
 */
function attack(id = "atk", { name = "", type = "attack" } = {}) {
  const a = {
    id, type, name, activation: { type: "action" }, attack: { type: { value: "melee" } }, labels: { modifier: "+5" }, range: {}, target: {},
    getDamageConfig: () => ({ rolls: [{ parts: ["1d8 + 3"], options: { types: ["slashing"] } }] }),
    next: { attack: null, damage: [] }
  };
  a.rollAttack = vi.fn(async () => (a.next.attack ? [a.next.attack] : null));
  a.rollDamage = vi.fn(async () => a.next.damage);
  return a;
}

/** A weapon with these activities and attack modes; `last` is the attack mode last used with it (dnd5e's flag). */
function weapon(id, activities, { modes = ["oneHanded"], last = null, type = "weapon" } = {}) {
  const item = {
    id, type, name: id, identifier: id, flags: {}, effects: [],
    getFlag: (scope, key) => (scope === "dnd5e" && last && key.endsWith(".attackMode") ? last : undefined),
    system: { identifier: id, activities: listOf(activities), attackModes: modes.map(value => ({ value })), type: { value: "martialM" }, properties: new Set(), equipped: true, range: {} }
  };
  for ( const a of activities ) a.item = item;
  return item;
}

/** An actor as dnd5e prepares one, with only what these tests look at. */
function actorOf(items = []) {
  return {
    id: "orc", uuid: "Actor.orc", type: "npc", name: "Orc", img: "", flags: {}, statuses: new Set(), appliedEffects: [], classes: {},
    items: listOf(items), getRollData: () => ({}), toObject() { return { name: this.name }; },
    system: {
      abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(k => [k, { value: 10, mod: 0, save: 0 }])),
      attributes: { hp: { value: 15, max: 15, temp: 0 }, ac: { value: 13 }, movement: { walk: 30, units: "ft" }, senses: {}, death: {}, spell: { dc: 12 } },
      details: { cr: 1, level: 1, type: { value: "humanoid" } },
      skills: { ath: { total: 3, passive: 13 }, acr: { total: 0, passive: 10 }, ste: { total: 1 }, prc: { total: 1, passive: 11 }, ins: { total: 1, passive: 11 } },
      traits: { size: "med", languages: { value: new Set() }, di: {}, dr: {}, dv: {}, ci: {} },
      resources: {}, currency: {}, spells: {}
    }
  };
}

/** The goblin it strikes at: AC 15 (none it can be hit at, behind total cover). */
function goblin({ ac = 15, cover = false } = {}) {
  return {
    uuid: "Scene.s.Token.tokB", name: "Goblin", texture: { src: "goblin.webp" },
    actor: { uuid: "Scene.s.Token.tokB.Actor.gob", statuses: new Set(cover ? ["coverTotal"] : []), system: { attributes: { ac: { value: ac } } } }
  };
}
const GOBLIN = { actor: "Scene.s.Token.tokB.Actor.gob", ac: 15, img: "goblin.webp", name: "Goblin", token: "Scene.s.Token.tokB" };

/** An orc with a greataxe (and a dagger) on its token. */
function orc({ last = null } = {}) {
  const axe = attack("atk");
  const stab = attack("stab");
  const actor = actorOf([weapon("greataxe", [axe], { modes: ["twoHanded"] }), weapon("dagger", [stab], { modes: ["oneHanded", "offhand", "thrown"], last })]);
  return { token: { uuid: "Scene.s.Token.tokA", name: "Orc", actor }, actor, axe, stab };
}

describe("the attack the engine's strike came from, found by its id", () => {
  test("the spec's own strike ids name their weapon's attack: rolled with that one, not another's", async () => {
    const { token, actor, axe, stab } = orc();
    const spec = await new Dnd5eAdapter().toCombatantSpec({ id: "tokA", name: "Orc", actor });
    const strike = spec.actions.find(a => a.kind === "strike" && a.itemId === "dagger");
    expect(attackActivityOf(actor, strike.id)).toBe(stab);
    stab.next.attack = d20(9, 12);
    await new Dnd5eAdapter().rollStrike(token, { action: { id: strike.id, name: strike.name }, target: goblin() });
    expect(stab.rollAttack).toHaveBeenCalledTimes(1);
    expect(axe.rollAttack).not.toHaveBeenCalled();
  });

  test("whatever the actions add after it (Extra Attack, the off hand, a projectile, a slot), and a legendary copy's", () => {
    const plain = attack("atk");
    const advantage = attack("adv", { name: "Attack at Advantage" });
    const bite = attack("bite");
    const save = attack("breath", { type: "save" });
    const actor = actorOf([weapon("claw", [advantage, plain], { type: "feat", modes: [] }), weapon("jaws", [bite, save], { type: "feat", modes: [] })]);
    for ( const id of ["orc.jaws.bite", "orc.jaws.bite.extra", "orc.jaws.bite.off-hand", "orc.jaws.bite.martial-arts", "orc.jaws.bite.0", "orc.jaws.bite@slots:2"] ) {
      expect([id, attackActivityOf(actor, id)]).toEqual([id, bite]);
    }
    // (A legendary copy names the item only: its attack, not the "at Advantage" variant.)
    expect(attackActivityOf(actor, "orc.claw.legendary")).toBe(plain);
  });

  test("none: an activity that isn't an attack, an item or activity it doesn't have, no id", () => {
    const actor = actorOf([weapon("jaws", [attack("bite"), attack("breath", { type: "save" })], { type: "feat", modes: [] })]);
    expect(attackActivityOf(actor, "orc.jaws.breath")).toBeNull();
    expect(attackActivityOf(actor, "orc.tail.lash")).toBeNull();
    expect(attackActivityOf(actor, "orc.dodge")).toBeNull();
    expect(attackActivityOf(actor, undefined)).toBeNull();
  });
});

describe("rolled the dnd5e way, at the target", () => {
  test("no dialog; the target's AC is the roll's, and the target is the cards' (the user's own targets untouched)", async () => {
    const { token, axe } = orc();
    globalThis.game.user = { targets: new Set(["someone else"]) };
    axe.next.attack = d20(14, 19);
    axe.next.damage = [damageRoll(9, "slashing")];
    await rollDnd5eStrike(token, { action: { id: "orc.greataxe.atk" }, target: goblin() });
    expect(axe.rollAttack).toHaveBeenCalledWith({ target: 15, attackMode: "twoHanded" }, { configure: false }, { data: { system: { targets: [GOBLIN] } } });
    expect(axe.rollDamage.mock.calls[0][1]).toEqual({ configure: false });
    expect(axe.rollDamage.mock.calls[0][2]).toEqual({ data: { system: { targets: [GOBLIN] } } });
    expect([...globalThis.game.user.targets]).toEqual(["someone else"]);
  });

  test("with dnd5e loaded: its own descriptor of the target, and the reacting token as the cards' speaker", async () => {
    const { token, axe } = orc();
    const getDescriptors = vi.fn(tokens => tokens.map(() => ({ ...GOBLIN, ac: 16 })));
    globalThis.dnd5e = { dataModels: { chatMessage: { fields: { TargetsField: { getDescriptors } } } } };
    const getSpeaker = vi.fn(({ token: t }) => ({ scene: "s", token: "tokA", actor: t.actor.id, alias: t.name }));
    globalThis.ChatMessage = { implementation: { getSpeaker } };
    const target = goblin();
    axe.next.attack = d20(9, 15);
    await rollDnd5eStrike(token, { action: { id: "orc.greataxe.atk" }, target });
    expect(getDescriptors).toHaveBeenCalledWith([target]);
    expect(getSpeaker).toHaveBeenCalledWith({ token });
    expect(axe.rollAttack).toHaveBeenCalledWith({ target: 16, attackMode: "twoHanded" }, { configure: false },
      { data: { speaker: { scene: "s", token: "tokA", actor: "orc", alias: "Orc" }, system: { targets: [{ ...GOBLIN, ac: 16 }] } } });
  });

  test("in a melee mode: a dagger last thrown strikes in hand; one last used two-handed stays so; a feature's attack, dnd5e's own", async () => {
    const thrown = orc({ last: "thrown" });
    thrown.stab.next.attack = d20(9, 12);
    await rollDnd5eStrike(thrown.token, { action: { id: "orc.dagger.stab" }, target: goblin() });
    expect(thrown.stab.rollAttack.mock.calls[0][0]).toEqual({ target: 15, attackMode: "oneHanded" });
    const bite = attack("bite");
    const sword = attack("cut");
    const actor = actorOf([weapon("jaws", [bite], { type: "feat", modes: [] }), weapon("longsword", [sword], { modes: ["oneHanded", "twoHanded"], last: "twoHanded" })]);
    bite.next.attack = d20(9, 12);
    sword.next.attack = d20(9, 12);
    await rollDnd5eStrike({ actor }, { action: { id: "orc.jaws.bite" }, target: goblin() });
    await rollDnd5eStrike({ actor }, { action: { id: "orc.longsword.cut" }, target: goblin() });
    expect(bite.rollAttack.mock.calls[0][0]).toEqual({ target: 15 });
    expect(sword.rollAttack.mock.calls[0][0]).toEqual({ target: 15, attackMode: "twoHanded" });
  });

  test("a throw in a throw's mode; a shot in dnd5e's own", async () => {
    const thrown = orc();
    thrown.stab.next.attack = d20(9, 12);
    await rollDnd5eStrike(thrown.token, { action: { id: "orc.dagger.stab", ranged: true, thrown: true }, target: goblin() });
    expect(thrown.stab.rollAttack.mock.calls[0][0]).toEqual({ target: 15, attackMode: "thrown" });
    const shot = orc();
    shot.stab.next.attack = d20(9, 12);
    await rollDnd5eStrike(shot.token, { action: { id: "orc.dagger.stab", ranged: true }, target: goblin() });
    expect(shot.stab.rollAttack.mock.calls[0][0]).toEqual({ target: 15 });
  });

  test("with the engine's advantage or disadvantage; secret, for the GMs only, the attack and its damage", async () => {
    for ( const [advantage, edge] of [[1, { advantage: true }], [-2, { disadvantage: true }], [0, {}]] ) {
      const { token, axe } = orc();
      axe.next.attack = d20(14, 19);
      await rollDnd5eStrike(token, { action: { id: "orc.greataxe.atk" }, target: goblin(), advantage });
      expect(axe.rollAttack.mock.calls[0][0]).toEqual({ target: 15, attackMode: "twoHanded", ...edge });
    }
    const { token, axe } = orc();
    axe.next.attack = d20(14, 19);
    axe.next.damage = [damageRoll(9, "slashing")];
    await rollDnd5eStrike(token, { action: { id: "orc.greataxe.atk" }, target: goblin(), secret: true });
    expect(axe.rollAttack.mock.calls[0][2]).toMatchObject({ rollMode: "gm" });
    expect(axe.rollDamage.mock.calls[0][2]).toMatchObject({ rollMode: "gm" });
  });
});

describe("what the roll came to", () => {
  const rolled = async (attackRoll, damage = [damageRoll(9, "slashing")]) => {
    const { token, axe } = orc();
    axe.next.attack = attackRoll;
    axe.next.damage = damage;
    const out = await rollDnd5eStrike(token, { action: { id: "orc.greataxe.atk" }, target: goblin() });
    return { out, axe };
  };

  test("a critical (a natural 20, or the weapon's lower threshold): degree 3, its damage rolled as a critical", async () => {
    const { out, axe } = await rolled(d20(20, 25), [damageRoll(18, "slashing")]);
    expect(out).toEqual({ attack: { degree: 3, natural: 20, total: 25 }, damage: { byType: { slashing: 18 } } });
    expect(axe.rollDamage.mock.calls[0][0]).toMatchObject({ isCritical: true });
    // (A Champion's 19, dnd5e's critical: even below the AC.)
    expect((await rolled(d20(19, 14, { crit: true }))).out.attack).toEqual({ degree: 3, natural: 19, total: 14 });
  });

  test("a hit (the AC met): degree 2, its damage not a critical's", async () => {
    const { out, axe } = await rolled(d20(12, 15));
    expect(out).toEqual({ attack: { degree: 2, natural: 12, total: 15 }, damage: { byType: { slashing: 9 } } });
    expect(axe.rollDamage.mock.calls[0][0]).toMatchObject({ isCritical: false });
  });

  test("a miss: degree 1, and no damage rolled", async () => {
    const { out, axe } = await rolled(d20(9, 14));
    expect(out).toEqual({ attack: { degree: 1, natural: 9, total: 14 }, damage: null });
    expect(axe.rollDamage).not.toHaveBeenCalled();
  });

  test("a natural 1: degree 0 (a fumble), whatever the total, and no damage rolled", async () => {
    const { out, axe } = await rolled(d20(1, 16));
    expect(out).toEqual({ attack: { degree: 0, natural: 1, total: 16 }, damage: null });
    expect(axe.rollDamage).not.toHaveBeenCalled();
  });

  test("damage by type as rolled (none below 0), rolled as dnd5e's own Damage button would after that attack", async () => {
    const { token, actor, stab } = orc();
    const arrow = { id: "arrow", name: "Arrow" };
    actor.items.push(arrow);
    stab.next.attack = d20(15, 20, { options: { ability: "dex", attackMode: "oneHanded", ammunition: "arrow" } });
    stab.next.damage = [damageRoll(4, "piercing"), damageRoll(3, "fire"), damageRoll(2, "piercing"), damageRoll(-1, "cold")];
    const out = await rollDnd5eStrike(token, { action: { id: "orc.dagger.stab" }, target: goblin() });
    expect(out.damage).toEqual({ byType: { piercing: 6, fire: 3, cold: 0 } });
    expect(stab.rollDamage.mock.calls[0][0]).toEqual({ isCritical: false, ability: "dex", attackMode: "oneHanded", ammunition: arrow });
  });

  test("a hit whose damage dnd5e didn't roll (cancelled, or it failed): the attack stands, the damage is the engine's", async () => {
    expect((await rolled(d20(12, 15), null)).out).toEqual({ attack: { degree: 2, natural: 12, total: 15 }, damage: null });
    const { token, axe } = orc();
    axe.next.attack = d20(12, 15);
    axe.rollDamage.mockRejectedValueOnce(new Error("no"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await rollDnd5eStrike(token, { action: { id: "orc.greataxe.atk" }, target: goblin() })).toEqual({ attack: { degree: 2, natural: 12, total: 15 }, damage: null });
    quiet.mockRestore();
  });
});

describe("null, for the engine's own dice", () => {
  test("no such attack: nothing is rolled", async () => {
    const { token, axe, stab } = orc();
    expect(await new Dnd5eAdapter().rollStrike(token, { action: { id: "orc.club.atk", name: "Club" }, target: goblin() })).toBeNull();
    expect(await rollDnd5eStrike(token, { action: null, target: goblin() })).toBeNull();
    expect(axe.rollAttack).not.toHaveBeenCalled();
    expect(stab.rollAttack).not.toHaveBeenCalled();
  });

  test("no target, or one with no AC to hit (total cover): nothing is rolled", async () => {
    const { token, axe } = orc();
    expect(await rollDnd5eStrike(token, { action: { id: "orc.greataxe.atk" }, target: null })).toBeNull();
    expect(await rollDnd5eStrike(token, { action: { id: "orc.greataxe.atk" }, target: goblin({ cover: true }) })).toBeNull();
    expect(axe.rollAttack).not.toHaveBeenCalled();
  });

  test("an attack dnd5e didn't roll (a module cancelled it)", async () => {
    const { token, axe } = orc();
    axe.next.attack = null;
    expect(await rollDnd5eStrike(token, { action: { id: "orc.greataxe.atk" }, target: goblin() })).toBeNull();
    expect(axe.rollDamage).not.toHaveBeenCalled();
  });
});
