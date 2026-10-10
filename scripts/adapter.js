/**
 * D&D Fifth Edition adapter: reads dnd5e actors (through their items' activities) into CombatantSpecs and commits
 * outcomes back. Written against dnd5e 6 on Foundry v14; values are read defensively so older data still works.
 */
import { SystemAdapter, parseFormula } from "./core.js";
import { dnd5eRules, proficiency } from "./rules.js";
import { deriveDnd5eTraits } from "./traits.js";
import { parseMultiattack } from "./multiattack.js";
import { rankLeaders } from "./leadership.js";
import { commitDnd5eOutcome, describeDnd5eOutcome, commitDnd5eConcession } from "./commit.js";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const MODES = ["walk", "fly", "swim", "climb", "burrow"];
const PHYSICAL = new Set(["weapon", "equipment", "consumable", "tool", "loot"]);

/** dnd5e statuses -> engine conditions (the engine's own: prone, immobilized, incapacitated). */
const STATUS_CONDITIONS = {
  prone: { prone: 1 },
  frightened: { frightened: 1 },
  poisoned: { poisoned: 1 },
  blinded: { blinded: 1 },
  restrained: { restrained: 1, immobilized: 1 },
  grappled: { immobilized: 1 },
  paralyzed: { paralyzed: 1 },
  stunned: { stunned: 1 },
  petrified: { petrified: 1 },
  unconscious: { unconscious: 1, incapacitated: 1 },
  incapacitated: { incapacitated: 1 },
  charmed: { charmed: 1 }
};

const asArray = v => (v instanceof Set ? [...v] : Array.isArray(v) ? v : v ? [v] : []);
const numberOf = v => {
  const n = Number(String(v ?? "").replace(/\s+/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Copper value of an item's price (dnd5e prices are {value, denomination}). */
function copperValue(price) {
  const per = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };
  return Math.round((Number(price?.value) || 0) * (per[price?.denomination ?? "gp"] ?? 100));
}

/** Rough number of enemies an area catches. */
function areaTargets(item) {
  const t = item.system.target ?? {};
  const count = Number(t.affects?.count);
  if ( count > 1 ) return count;
  const size = Number(t.template?.size) || 0;
  if ( !t.template?.type ) return 1;
  if ( t.template.type === "line" ) return size >= 60 ? 3 : 2;
  if ( t.template.type === "cone" ) return size >= 30 ? 3 : 2;
  return size >= 20 ? 4 : size >= 10 ? 3 : 2;
}

export class Dnd5eAdapter extends SystemAdapter {
  static systemId = "dnd5e";

  get label() {
    return "D&D 5e";
  }

  get rules() {
    return dnd5eRules;
  }

  canHandle(actor) {
    return !!actor && ["character", "npc"].includes(actor.type);
  }

  /* -------------------------------------------- */

  async toCombatantSpec(tokenDoc) {
    const actor = tokenDoc.actor;
    if ( !this.canHandle(actor) ) return null;
    const sys = actor.system;
    const level = actor.type === "character" ? (sys.details?.level ?? 1) : Math.max(0, Number(sys.details?.cr) || 0);
    const hp = sys.attributes?.hp ?? {};
    const creature = String(sys.details?.type?.value ?? (actor.type === "character" ? "humanoid" : "")).toLowerCase();
    const features = actor.items.filter(i => i.type === "feat").map(i => i.name.toLowerCase());

    const speeds = {};
    for ( const mode of MODES ) {
      const v = Number(sys.attributes?.movement?.[mode]);
      if ( v > 0 ) speeds[mode] = v;
    }
    if ( !Object.keys(speeds).length ) speeds.walk = 30;

    const defenses = { ac: sys.attributes?.ac?.value ?? 10 };
    for ( const a of ABILITIES ) {
      const s = sys.abilities?.[a]?.save;
      defenses[a] = typeof s === "number" ? s : (s?.value ?? sys.abilities?.[a]?.mod ?? 0);
    }

    const actions = await this.#actions(actor, level, features);
    const resources = {};
    for ( const a of actions ) if ( a.resource && a.pool !== undefined ) resources[a.resource] = a.pool;
    for ( const a of actions ) delete a.pool;

    const derived = this.deriveTraits(actor);
    const skill = key => sys.skills?.[key];
    const skillMod = key => skill(key)?.total ?? skill(key)?.mod ?? null;
    const passive = key => skill(key)?.passive ?? (10 + (skillMod(key) ?? 0));
    return {
      id: tokenDoc.id,
      tokenId: tokenDoc.id,
      actorId: actor.id,
      actorUuid: actor.uuid,
      name: tokenDoc.name ?? actor.name,
      img: tokenDoc.texture?.src ?? actor.img,
      kind: actor.type === "character" ? "pc" : "npc",
      level,
      hp: { value: hp.value ?? 0, max: hp.max ?? 1, temp: hp.temp ?? 0 },
      defenses,
      shield: null, // a 5e shield is already in the AC
      initiative: { mod: sys.attributes?.init?.total ?? sys.attributes?.init?.mod ?? 0, stealth: skillMod("ste") ?? 0 },
      speeds,
      actions,
      iwr: this.#iwr(sys),
      resources,
      traits: Object.fromEntries(Object.entries(derived.traits).map(([k, v]) => [k, { base: v, fudge: 0 }])),
      traitReasons: derived.reasons,
      flags: { ...derived.flags },
      diesAtZero: actor.type !== "character",
      dying: sys.attributes?.death?.failure ?? 0,
      // At 0 HP a 5e creature is dying until it has three successes (or is stabilized).
      stable: (hp.value ?? 0) <= 0 ? (sys.attributes?.death?.success ?? 0) >= 3 : undefined,
      deathSaves: { success: sys.attributes?.death?.success ?? 0, failure: sys.attributes?.death?.failure ?? 0 },
      conditions: this.#conditions(actor),
      perception: skillMod("prc") ?? 0,
      darkvision: Number(sys.attributes?.senses?.ranges?.darkvision ?? sys.attributes?.senses?.darkvision) > 0,
      // Anyone can try to stabilize the dying with a DC 10 Wisdom (Medicine) check.
      firstAid: (actor.type === "character" || creature === "humanoid") && skillMod("med") !== null ? { mod: skillMod("med") } : null,
      theft: skillMod("slt") !== null ? { skill: skill("slt")?.label ?? "Sleight of Hand", mod: skillMod("slt") } : null,
      creatureTraits: [creature],
      social: {
        pitches: {
          persuade: skillMod("per") !== null ? { skill: "Persuasion", mod: skillMod("per") } : null,
          intimidate: skillMod("itm") !== null ? { skill: "Intimidation", mod: skillMod("itm") } : null,
          deceive: skillMod("dec") !== null ? { skill: "Deception", mod: skillMod("dec") } : null
        },
        // Insight sees through all three; Perception keeps hands off your purse.
        resist: {
          persuade: { dc: passive("ins"), label: "passive Insight" },
          intimidate: { dc: passive("ins"), label: "passive Insight" },
          deceive: { dc: passive("ins"), label: "passive Insight" },
          steal: { dc: passive("prc"), label: "passive Perception" }
        },
        resolve: (defenses.wis ?? 0) - (proficiency(level) + 1),
        languages: asArray(sys.traits?.languages?.value),
        mindless: (sys.abilities?.int?.value ?? 10) <= 3
      },
      valuables: this.#valuables(actor),
      leadership: this.#leadershipEntry(actor, tokenDoc.id, level, features)
    };
  }

  /* -------------------------------------------- */

  #iwr(sys) {
    const t = sys.traits ?? {};
    const iwr = { immune: [...asArray(t.di?.value), ...asArray(t.ci?.value)], weak: {}, resist: {} };
    for ( const type of asArray(t.dv?.value) ) iwr.weak[type] = 1;
    for ( const type of asArray(t.dr?.value) ) iwr.resist[type] = 1;
    return iwr;
  }

  #conditions(actor) {
    const out = {};
    for ( const status of actor.statuses ?? [] ) Object.assign(out, STATUS_CONDITIONS[status] ?? {});
    const exhaustion = Number(actor.system.attributes?.exhaustion) || 0;
    if ( exhaustion ) out.exhaustion = exhaustion;
    return out;
  }

  #valuables(actor) {
    const c = actor.system.currency ?? {};
    const money = (c.pp ?? 0) * 1000 + (c.gp ?? 0) * 100 + (c.ep ?? 0) * 50 + (c.sp ?? 0) * 10 + (c.cp ?? 0);
    const stowed = [];
    const wielded = [];
    for ( const item of actor.items ) {
      if ( !PHYSICAL.has(item.type) || !(Number(item.system.quantity ?? 1) > 0) || item.type === "container" ) continue;
      const entry = { id: item.id, name: item.name, value: copperValue(item.system.price) };
      if ( !item.system.equipped ) stowed.push(entry);
      else if ( item.type === "weapon" || item.system.type?.value === "shield" ) wielded.push(entry);
    }
    return {
      money,
      denominations: [{ label: "pp", value: 1000 }, { label: "gp", value: 100 }, { label: "sp", value: 10 }, { label: "cp", value: 1 }],
      stowed,
      wielded
    };
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  async #actions(actor, level, features) {
    const out = [];
    for ( const item of actor.items ) {
      if ( item.type === "spell" && !this.#spellReady(actor, item) ) continue;
      // A character only fights with the weapons it has equipped.
      if ( actor.type === "character" && item.type === "weapon" && !item.system.equipped ) continue;
      for ( const activity of item.system.activities ?? [] ) {
        const action = this.#fromActivity(actor, item, activity);
        if ( action ) out.push(action);
      }
    }
    this.#sneakAttack(actor, level, features, out);
    // Characters with Extra Attack make several weapon attacks with the Attack action.
    if ( actor.type === "character" ) {
      const extra = features.some(f => f.includes("three extra attacks")) ? 4 : features.some(f => f.includes("two extra attacks") || f.includes("extra attack (2)")) ? 3 : features.some(f => f.includes("extra attack")) ? 2 : 1;
      if ( extra > 1 ) {
        for ( const a of out.filter(x => x.kind === "strike" && x.weapon && x.economy !== "bonus") ) {
          out.push({ ...a, id: `${a.id}.extra`, name: `${a.name} ×${extra}`, sequence: Array.from({ length: extra }, (_, i) => ({ ...a, id: `${a.id}.${i}` })) });
        }
      }
    }
    // NPCs' Multiattack: the strikes it makes in one action.
    const multi = actor.items.find(i => i.type === "feat" && /multiattack/i.test(i.name));
    if ( multi ) {
      const strikes = out.filter(a => a.kind === "strike" && a.economy !== "bonus").sort((a, b) => (b.bonus ?? 0) - (a.bonus ?? 0));
      const names = parseMultiattack(multi.system.description?.value, strikes.map(s => s.name));
      if ( names?.length > 1 ) {
        const sequence = names.map((n, i) => ({ ...strikes.find(s => s.name === n), id: `${multi.id}.${i}` }));
        const first = sequence[0];
        out.push({ ...first, id: `${actor.id}.multiattack`, name: multi.name, sequence, uses: undefined, resource: undefined });
      }
    }
    return out;
  }

  /** Is this spell castable now: cantrips, prepared or always-prepared spells, pact magic, innate and at-will. */
  #spellReady(actor, item) {
    const s = item.system;
    if ( (s.level ?? 0) === 0 || actor.type === "npc" ) return true;
    const method = s.method ?? s.preparation?.mode;
    if ( ["pact", "innate", "atwill", "always"].includes(method) ) return true;
    return !!(s.prepared ?? s.preparation?.prepared);
  }

  /** Damage parts an activity deals (or heals), with the actor's numbers filled in. */
  #parts(activity, healing = false) {
    let config;
    try {
      config = activity.getDamageConfig?.({}, { formulaOptions: { modifiers: false } }) ?? null;
    } catch ( err ) {
      config = null;
    }
    const parts = [];
    for ( const roll of config?.rolls ?? [] ) {
      const formula = Roll.replaceFormulaData((roll.parts ?? []).join(" + "), roll.data ?? activity.getRollData?.() ?? {}, { missing: "0" });
      const type = asArray(roll.options?.types ?? roll.options?.type)[0] ?? (healing ? "healing" : "untyped");
      const part = parseFormula(formula, type);
      if ( part.dice.length || part.flat ) parts.push(part);
    }
    return parts;
  }

  /** Conditions an activity's effects impose, and for how long. */
  #effects(item, activity) {
    const conditions = {};
    let rounds = 10;
    for ( const ref of activity.effects ?? [] ) {
      const effect = ref.effect ?? item.effects?.get(ref._id ?? ref.id);
      if ( !effect ) continue;
      for ( const status of effect.statuses ?? [] ) Object.assign(conditions, STATUS_CONDITIONS[status] ?? {});
      const d = effect.duration ?? {};
      rounds = d.rounds || (d.seconds ? Math.ceil(d.seconds / 6) : 0) || d.turns || rounds;
    }
    return Object.keys(conditions).length ? { conditions, rounds, label: Object.keys(conditions).filter(k => k !== "immobilized" || !conditions.restrained).join(", ") } : null;
  }

  /** What one use of an item costs from the creature's pools. */
  #resource(actor, item) {
    const s = item.system;
    if ( item.type === "spell" ) {
      const lvl = s.level ?? 0;
      const method = s.method ?? s.preparation?.mode;
      if ( lvl === 0 || method === "atwill" ) return {};
      if ( method === "pact" ) return { resource: "pact", pool: actor.system.spells?.pact?.value ?? 0 };
      if ( method === "innate" ) return { uses: Math.max(0, (s.uses?.max ?? 1) - (s.uses?.spent ?? 0)) };
      return { resource: `slots:${lvl}`, pool: actor.system.spells?.[`spell${lvl}`]?.value ?? 0 };
    }
    const max = Number(s.uses?.max) || 0;
    if ( item.type === "consumable" ) return { resource: `item:${item.id}`, pool: Math.max(0, Number(s.quantity ?? 1)) * Math.max(1, max ? max - (s.uses?.spent ?? 0) : 1) };
    if ( max ) return { uses: Math.max(0, max - (s.uses?.spent ?? 0)) };
    return {};
  }

  #fromActivity(actor, item, activity) {
    const activation = activity.activation?.type ?? "action";
    if ( !["action", "bonus"].includes(activation) ) return null;
    const economy = activation === "bonus" ? "bonus" : undefined;
    const range = item.system.range ?? {};
    const rangeFeet = Number(range.value) || null;
    const base = {
      id: `${actor.id}.${item.id}.${activity.id}`, name: activity.name && activity.name !== item.name && activity.type !== "attack" ? `${item.name}: ${activity.name}` : item.name,
      cost: 1, economy, itemId: item.id, traits: [], rank: item.type === "spell" ? item.system.level : undefined, ...this.#resource(actor, item)
    };
    const reachOf = () => Number(range.reach) || 5;

    if ( activity.type === "attack" ) {
      const damage = this.#parts(activity);
      if ( !damage.length ) return null;
      const melee = activity.attack?.type?.value !== "ranged";
      const bonus = numberOf(activity.labels?.modifier) ?? numberOf(activity.labels?.toHit) ?? 0;
      const control = this.#effects(item, activity);
      return {
        ...base, kind: item.type === "spell" ? "spell-attack" : "strike", weapon: item.type === "weapon", bonus, melee,
        reach: melee ? reachOf() : undefined,
        range: melee ? null : { increment: rangeFeet ?? 30, max: Number(range.long) || rangeFeet || 30 },
        damage, effects: control ? [{ kind: "condition", ...control, critOnly: false }] : undefined
      };
    }

    if ( activity.type === "save" ) {
      const type = asArray(activity.save?.ability)[0] ?? "dex";
      const dc = activity.save?.dc?.value ?? (8 + proficiency(actor.system.details?.level ?? 1) + 3);
      const damage = this.#parts(activity);
      const control = this.#effects(item, activity);
      const common = {
        ...base, melee: false, range: { increment: rangeFeet ?? 30, max: rangeFeet ?? 30, noPenalty: true },
        area: areaTargets(item) > 1 ? { targets: areaTargets(item) } : undefined
      };
      if ( damage.length ) {
        return {
          ...common, kind: "save", damage, save: { type, dc, basic: activity.damage?.onSave !== "none" },
          effects: control ? [{ kind: "condition", ...control, critOnly: false }] : undefined
        };
      }
      // No damage: crowd control on a failed save.
      if ( !control ) return null;
      return { ...common, kind: "control", save: { type, dc, basic: false }, onSave: [control, control, null, null] };
    }

    if ( activity.type === "damage" ) {
      const damage = this.#parts(activity);
      return damage.length ? { ...base, kind: "auto", damage, melee: false, range: { increment: rangeFeet ?? 120, max: rangeFeet ?? 120, noPenalty: true } } : null;
    }

    if ( activity.type === "heal" ) {
      const heal = this.#parts(activity, true).map(p => ({ ...p, type: "healing" }));
      if ( !heal.length ) return null;
      const self = item.type === "consumable" || range.units === "self";
      return { ...base, kind: "heal", heal, selfOnly: self };
    }
    return null;
  }

  /** Rogues: Sneak Attack, once a turn, with advantage or an ally beside the target, on a finesse or ranged weapon. */
  #sneakAttack(actor, level, features, actions) {
    if ( actor.type !== "character" || !features.some(f => f.includes("sneak attack")) ) return;
    const scaled = actor.system.scale?.rogue?.["sneak-attack"];
    const formula = scaled?.formula ?? (typeof scaled === "string" ? scaled : `${Math.ceil(level / 2)}d6`);
    for ( const a of actions ) {
      if ( a.kind !== "strike" || !a.weapon ) continue;
      const props = asArray(actor.items.get(a.itemId)?.system.properties);
      if ( !props.includes("fin") && a.melee ) continue;
      a.bonusDamage = [...(a.bonusDamage ?? []), { id: "sneak-attack", when: ["advantage", "allyAdjacent"], oncePerTurn: true, parts: [{ ...parseFormula(formula, a.damage[0]?.type ?? "untyped"), category: "precision" }] }];
    }
  }

  /* -------------------------------------------- */

  deriveTraits(actor) {
    const sys = actor.system;
    const level = actor.type === "character" ? (sys.details?.level ?? 1) : Math.max(0, Number(sys.details?.cr) || 0);
    const save = sys.abilities?.wis?.save;
    return deriveDnd5eTraits({
      type: actor.type,
      creature: String(sys.details?.type?.value ?? "").toLowerCase(),
      int: sys.abilities?.int?.value ?? 10,
      wis: sys.abilities?.wis?.mod ?? 0,
      level,
      wisSave: typeof save === "number" ? save : (save?.value ?? sys.abilities?.wis?.mod ?? 0),
      hasMaster: false,
      features: actor.items.filter(i => i.type === "feat").map(i => i.name.toLowerCase())
    });
  }

  #leadershipEntry(actor, id, level, features) {
    const skills = actor.system.skills ?? {};
    return {
      id,
      level,
      skills: { persuasion: skills.per?.total, intimidation: skills.itm?.total },
      features
    };
  }

  detectLeaders(specs) {
    return rankLeaders(specs.map(s => s.leadership).filter(Boolean));
  }

  /** The 2014 encounter thresholds: easy, medium, hard, deadly, for the party's levels against the foes' XP. */
  difficultyCrossCheck(friendly, hostile) {
    const pcs = friendly.filter(s => s.kind === "pc");
    if ( !pcs.length || !hostile.length ) return null;
    const THRESHOLDS = [[25, 50, 75, 100], [50, 100, 150, 200], [75, 150, 225, 400], [125, 250, 375, 500], [250, 500, 750, 1100],
      [300, 600, 900, 1400], [350, 750, 1100, 1700], [450, 900, 1400, 2100], [550, 1100, 1600, 2400], [600, 1200, 1900, 2800],
      [800, 1600, 2400, 3600], [1000, 2000, 3000, 4500], [1100, 2200, 3400, 5100], [1250, 2500, 3800, 5700], [1400, 2800, 4300, 6400],
      [1600, 3200, 4800, 7200], [2000, 3900, 5900, 8800], [2100, 4200, 6300, 9500], [2400, 4900, 7300, 10900], [2800, 5700, 8500, 12700]];
    const XP = { 0: 10, 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900,
      11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000, 21: 33000, 22: 41000,
      23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000, 28: 120000, 29: 135000, 30: 155000 };
    const budget = [0, 0, 0, 0];
    for ( const pc of pcs ) THRESHOLDS[Math.min(19, Math.max(0, (pc.level ?? 1) - 1))].forEach((v, i) => { budget[i] += v; });
    const foes = hostile.filter(h => h.kind !== "hazard");
    const raw = foes.reduce((s, h) => s + (XP[h.level] ?? XP[Math.round(h.level)] ?? 0), 0);
    const n = foes.length;
    const mult = n <= 1 ? 1 : n === 2 ? 1.5 : n <= 6 ? 2 : n <= 10 ? 2.5 : n <= 14 ? 3 : 4;
    const adjusted = raw * mult;
    const label = adjusted >= budget[3] ? "extreme" : adjusted >= budget[2] ? "severe" : adjusted >= budget[1] ? "moderate" : adjusted >= budget[0] ? "low" : "trivial";
    return { label, xp: raw, adjustedXp: adjusted, budgets: budget };
  }

  /* -------------------------------------------- */

  resourceLabel(key) {
    if ( key === "pact" ) return game.i18n.localize("FFDND5E.PactSlot");
    if ( key.startsWith("slots:") ) return game.i18n.format("FFDND5E.SpellSlot", { level: key.split(":")[1] });
    return null;
  }

  async commitOutcome(tokenDoc, spec, final, options) {
    return commitDnd5eOutcome(tokenDoc, spec, final, options);
  }

  describeOutcome(spec, final) {
    return describeDnd5eOutcome(spec, final);
  }

  async commitConcession(giverDoc, receiverDoc, concession) {
    return commitDnd5eConcession(giverDoc, receiverDoc, concession);
  }
}
