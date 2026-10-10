/**
 * D&D Fifth Edition adapter: reads dnd5e actors (through their items' activities) into CombatantSpecs and commits
 * outcomes back. Written against dnd5e 6 on Foundry v14; values are read defensively so older data still works.
 */
import { SystemAdapter, parseFormula } from "./core.js";
import { dnd5eRules, proficiency } from "./rules.js";
import { deriveDnd5eTraits, isMindless } from "./traits.js";
import { parseMultiattackOptions } from "./multiattack.js";
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

/**
 * The engine counts in feet. dnd5e can be set to metric, and ranges can be in miles: convert (a metre the table
 * way, 1.5 m to a 5-foot square).
 */
const FEET = { ft: 1, m: 10 / 3, mi: 5280, km: 10000 / 3 };
const inFeet = (value, units) => (Number(value) || 0) * (FEET[units] ?? 1);

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
function areaTargets(target) {
  const t = target ?? {};
  const count = Number(t.affects?.count);
  if ( count > 1 ) return count;
  const size = inFeet(t.template?.size, t.template?.units ?? "ft");
  if ( !t.template?.type ) return 1;
  if ( t.template.type === "line" ) return size >= 60 ? 3 : 2;
  if ( t.template.type === "cone" ) return size >= 30 ? 3 : 2;
  return size >= 20 ? 4 : size >= 10 ? 3 : 2;
}

const COUNT_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6 };
const PROJECTILES = "darts?|rays?|beams?|bolts?|motes?|missiles?";

/**
 * How many darts, rays or beams a spell makes: Magic Missile's three darts, Scorching Ray's three rays, and
 * Eldritch Blast's extra beams at levels 5, 11 and 17.
 */
export function projectileCount(description, level) {
  const text = String(description ?? "").replace(/<[^>]+>/g, " ");
  let count = 0;
  const byLevel = new RegExp(`\\b(${Object.keys(COUNT_WORDS).join("|")})\\s+(?:${PROJECTILES})\\s+(?:at|when you reach)\\s+(?:level\\s+)?(\\d+)`, "gi");
  for ( const m of text.matchAll(byLevel) ) {
    count ||= 1;
    if ( level >= Number(m[2]) ) count = Math.max(count, COUNT_WORDS[m[1].toLowerCase()]);
  }
  if ( count ) return count;
  const base = new RegExp(`\\b(${Object.keys(COUNT_WORDS).join("|")})\\s+(?:[a-z-]+\\s+){0,2}?(?:${PROJECTILES})\\b(?!\\s+at\\b)`, "i");
  const m = text.match(base);
  return m ? COUNT_WORDS[m[1].toLowerCase()] : 1;
}

/**
 * The words of an HTML description, with dnd5e's enrichers read: [[/item .id]]{label} (or the item's own name),
 * [[lookup @name]]{label}, @UUID[...]{label}.
 */
export function plainText(html, actor = null) {
  return String(html ?? "")
    .replace(/\[\[\/item\s+\.?([^\]\s]+)\]\](?:\{([^}]*)\})?/g, (m, ref, label) => label ?? actor?.items?.get(ref.split(".").pop())?.name ?? actor?.items?.getName?.(ref)?.name ?? "")
    .replace(/\[\[[^\]]*\]\](?:\{([^}]*)\})?/g, (m, label) => label ?? "")
    .replace(/@\w+\[[^\]]*\](?:\{([^}]*)\})?/g, (m, label) => label ?? "")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** Consumables nobody spends in a fight (torches, rations, candles ...). */
const IDLE_CONSUMABLES = new Set(["trinket", "food"]);

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
      const v = inFeet(sys.attributes?.movement?.[mode], sys.attributes?.movement?.units);
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
      // What it's worth in an encounter budget (the system works it out from the challenge rating).
      xp: actor.type === "npc" ? (Number(sys.details?.xp?.value) || CONFIG.DND5E?.CR_EXP_LEVELS?.[Math.max(0, Math.floor(level))] || 0) : 0,
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
      darkvision: Number(sys.attributes?.senses?.ranges?.darkvision ?? sys.attributes?.senses?.darkvision) > 0, // any range will do
      // Anyone can try to stabilize the dying with a DC 10 Wisdom (Medicine) check.
      firstAid: (actor.type === "character" || creature === "humanoid") && skillMod("med") !== null ? { mod: skillMod("med") } : null,
      theft: skillMod("slt") !== null ? { skill: skill("slt")?.label ?? "Sleight of Hand", mod: skillMod("slt") } : null,
      // A locked door: a Strength (Athletics) check to force it, or thieves' tools to pick it (proficiency, and the tools
      // themselves for a character).
      doorWork: {
        force: { mod: skillMod("ath") ?? sys.abilities?.str?.mod ?? 0 },
        pick: sys.tools?.thief && (actor.type !== "character" || actor.items.some(i => i.type === "tool" && i.system.type?.baseItem === "thief"))
          ? { mod: sys.tools.thief.total ?? sys.tools.thief.mod ?? 0 } : null
      },
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
        mindless: isMindless(sys.abilities?.int?.value, creature)
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
      if ( item.type === "consumable" && IDLE_CONSUMABLES.has(item.system.type?.value) ) continue;
      const riders = [];
      const mine = [];
      for ( const activity of item.system.activities ?? [] ) {
        const action = this.#fromActivity(actor, item, activity);
        if ( action?.riderFor ) riders.push(action.rider);
        else if ( action ) mine.push(action);
      }
      for ( const a of mine ) if ( riders.length && a.kind !== "heal" ) a.effects = [...(a.effects ?? []), ...riders];
      out.push(...mine);
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
      // Its everyday attacks, best first (limited uses such as a breath weapon aren't part of a Multiattack).
      const mean = a => (a.damage ?? []).reduce((s, p) => s + p.flat + p.dice.reduce((t, d) => t + d.n * (d.faces + 1) / 2, 0), 0);
      const strikes = out.filter(a => ["strike", "spell-attack", "save"].includes(a.kind) && a.economy !== "bonus" && a.uses === undefined && !a.resource)
        .sort((a, b) => ((b.bonus ?? 0) + mean(b)) - ((a.bonus ?? 0) + mean(a)));
      const options = parseMultiattackOptions(plainText(multi.system.description?.value, actor), strikes.map(s => ({ name: s.name, melee: !!s.melee })))
        .filter(names => names.length > 1);
      // Several ways to make it ("Scimitar or Pistol in any combination"): one action each, and the simulation picks.
      options.forEach((names, k) => {
        const sequence = names.map((n, i) => ({ ...strikes.find(s => s.name === n), id: `${multi.id}.${k}.${i}` }));
        const label = options.length > 1 ? `${multi.name} (${[...new Set(names)].join(", ")})` : multi.name;
        out.push({ ...sequence[0], id: `${actor.id}.multiattack${k ? `.${k}` : ""}`, name: label, sequence, uses: undefined, resource: undefined });
      });
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

  /**
   * Conditions an activity imposes, and for how long: from its effects' statuses, or failing that from the words of a
   * save ("... or be knocked prone", "... or have the Frightened condition"). Grappled becomes the engine's grab.
   */
  #effects(item, activity) {
    const statuses = new Set();
    let rounds = 0;
    const finite = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
    for ( const ref of activity.effects ?? [] ) {
      const effect = ref.effect ?? item.effects?.get(ref._id ?? ref.id);
      if ( !effect ) continue;
      for ( const status of effect.statuses ?? [] ) if ( STATUS_CONDITIONS[status] ) statuses.add(status);
      const d = effect.duration ?? {};
      const byUnits = finite(d.value) ? ({ rounds: 1, turns: 1, seconds: 1 / 6, minutes: 10, hours: 600 }[d.units] ?? 0) * finite(d.value) : 0;
      rounds = finite(d.rounds) || Math.ceil(finite(d.seconds) / 6) || finite(d.turns) || Math.ceil(byUnits) || rounds;
    }
    if ( !statuses.size && activity.type === "save" ) {
      const text = plainText(item.system.description?.value).toLowerCase();
      const words = Object.keys(STATUS_CONDITIONS).join("|");
      const m = new RegExp(`saving throw[^.]*?\\bor (?:be(?:come)? |be knocked |is knocked |have the |has the )?(${words})\\b`).exec(text)
        ?? new RegExp(`\\b(${words})\\b`).exec(String(activity.name ?? "").toLowerCase());
      if ( m ) {
        statuses.add(m[1]);
        const minutes = /for 1 minute|for one minute/.test(text) ? 10 : 0;
        rounds = minutes || (/until the end of (?:its|your|the \w+'s) next turn/.test(text) ? 1 : 0) || rounds;
      }
    }
    if ( !statuses.size ) return null;
    const grab = statuses.delete("grappled");
    const conditions = {};
    for ( const s of statuses ) Object.assign(conditions, STATUS_CONDITIONS[s]);
    const label = [...statuses].join(", ");
    return { conditions: Object.keys(conditions).length ? conditions : null, grab, rounds: rounds || 10, label: label || "grappled" };
  }

  /** The riders an attack carries: its conditions, a grab, and a save its target must make on a hit. */
  #riders(control) {
    if ( !control ) return [];
    const out = [];
    if ( control.grab ) out.push({ kind: "grabbed" });
    if ( control.conditions ) out.push({ kind: "condition", conditions: control.conditions, rounds: control.rounds, label: control.label, critOnly: false });
    return out;
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

  /** A save beside an attack on the same item (a wolf's bite, a spider's venom) happens on a hit: a rider. */
  #saveRider(actor, item, activity) {
    const save = {
      type: asArray(activity.save?.ability)[0] ?? "con",
      dc: activity.save?.dc?.value ?? (8 + proficiency(actor.system.details?.level ?? 1) + 3),
      basic: activity.damage?.onSave !== "none"
    };
    const damage = this.#parts(activity);
    const control = this.#effects(item, activity);
    if ( !damage.length && !control?.conditions ) return null;
    return {
      riderFor: item.id,
      rider: { kind: "save", save, damage: damage.length ? damage : undefined, conditions: control?.conditions ?? undefined, rounds: control?.rounds, label: control?.label ?? item.name }
    };
  }

  #fromActivity(actor, item, activity) {
    if ( activity.type === "save" && (item.system.activities?.contents ?? []).some(a => a.type === "attack") ) return this.#saveRider(actor, item, activity);
    const activation = activity.activation?.type ?? "action";
    if ( !["action", "bonus"].includes(activation) ) return null;
    const economy = activation === "bonus" ? "bonus" : undefined;
    // The activity's own range (dnd5e 4+), else the item's; a cone or line from yourself reaches as far as it is long.
    const range = item.system.range ?? {};
    const own = activity.range ?? {};
    const units = own.units ?? range.units;
    const template = activity.target?.template ?? item.system.target?.template ?? {};
    // (A weapon's activity range is its long range; the item keeps the normal one.)
    const rangeFeet = (own.override && inFeet(own.value, own.units)) || inFeet(range.value, range.units) || inFeet(own.value, own.units)
      || (units === "self" && inFeet(template.size, template.units ?? "ft")) || (units === "touch" ? 5 : null);
    const longFeet = inFeet(range.long, range.units) || inFeet(own.long, own.units);
    const several = (item.system.activities?.size ?? 1) > 1 && activity.type !== "attack";
    const base = {
      id: `${actor.id}.${item.id}.${activity.id}`, name: several && activity.name && activity.name !== item.name ? `${item.name}: ${activity.name}` : item.name,
      cost: 1, economy, itemId: item.id, traits: [], rank: item.type === "spell" ? item.system.level : undefined, ...this.#resource(actor, item)
    };
    const reachOf = () => inFeet(range.reach, range.units) || 5;
    const casterLevel = actor.type === "character" ? (actor.system.details?.level ?? 1) : (actor.system.attributes?.spell?.level ?? actor.system.details?.spellLevel ?? 1);
    const projectiles = item.type === "spell" ? projectileCount(item.system.description?.value, casterLevel) : 1;
    const targets = areaTargets(activity.target ?? item.system.target);

    if ( activity.type === "attack" ) {
      const damage = this.#parts(activity);
      if ( !damage.length ) return null;
      const melee = activity.attack?.type?.value !== "ranged";
      const bonus = numberOf(activity.labels?.modifier) ?? numberOf(activity.labels?.toHit) ?? 0;
      const riders = this.#riders(this.#effects(item, activity));
      const attack = {
        ...base, kind: item.type === "spell" ? "spell-attack" : "strike", weapon: item.type === "weapon", bonus, melee,
        reach: melee ? reachOf() : undefined,
        range: melee ? null : { increment: rangeFeet ?? 30, max: longFeet || rangeFeet || 30 },
        damage, effects: riders.length ? riders : undefined
      };
      // Scorching Ray, Eldritch Blast at higher levels: one attack roll per ray, all with the one action.
      if ( projectiles > 1 ) attack.sequence = Array.from({ length: projectiles }, (_, i) => ({ ...attack, id: `${attack.id}.${i}` }));
      return attack;
    }

    if ( activity.type === "save" ) {
      const type = asArray(activity.save?.ability)[0] ?? "dex";
      const dc = activity.save?.dc?.value ?? (8 + proficiency(actor.system.details?.level ?? 1) + 3);
      const damage = this.#parts(activity);
      const control = this.#effects(item, activity);
      const save = { type, dc, basic: activity.damage?.onSave !== "none" };
      const common = {
        ...base, melee: false, range: { increment: rangeFeet ?? 30, max: rangeFeet ?? 30, noPenalty: true },
        area: targets > 1 ? { targets } : undefined
      };
      if ( damage.length ) {
        const riders = control?.conditions ? [{ kind: "condition", conditions: control.conditions, rounds: control.rounds, label: control.label, critOnly: false }] : [];
        return { ...common, kind: "save", damage, save, effects: riders.length ? riders : undefined };
      }
      // No damage: crowd control on a failed save.
      if ( !control?.conditions ) return null;
      const outcome = { conditions: control.conditions, rounds: control.rounds, label: control.label };
      return { ...common, kind: "control", save: { type, dc, basic: false }, onSave: [outcome, outcome, null, null] };
    }

    if ( activity.type === "damage" ) {
      // Magic Missile's darts all land: three darts deal three times a dart's damage.
      const damage = this.#parts(activity).map(p => projectiles > 1 ? { ...p, dice: p.dice.map(d => ({ ...d, n: d.n * projectiles })), flat: p.flat * projectiles } : p);
      return damage.length ? {
        ...base, kind: "auto", damage, melee: false, range: { increment: rangeFeet ?? 120, max: rangeFeet ?? 120, noPenalty: true },
        area: targets > 1 ? { targets } : undefined
      } : null;
    }

    if ( activity.type === "heal" ) {
      const heal = this.#parts(activity, true).map(p => ({ ...p, type: "healing" }));
      if ( !heal.length ) return null;
      const self = item.type === "consumable" || units === "self";
      // Cure Wounds is a touch; Healing Word reaches 60 feet.
      const reach = units === "touch" ? { reach: 5 } : rangeFeet ? { range: { increment: rangeFeet, max: rangeFeet, noPenalty: true } } : {};
      return { ...base, kind: "heal", heal, selfOnly: self, ...(self ? {} : reach) };
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
    // Animals and the mindless follow; they don't lead.
    if ( (actor.system.abilities?.int?.value ?? 10) <= 3 ) return null;
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

  /**
   * The system's own encounter budget (dnd5e ships the free rules' XP budget per character: low, moderate, high),
   * for the party's levels against the foes' XP. Well past high is beyond what the budget plans for.
   */
  difficultyCrossCheck(friendly, hostile) {
    const pcs = friendly.filter(s => s.kind === "pc");
    const foes = hostile.filter(h => h.kind !== "hazard");
    const table = CONFIG.DND5E?.ENCOUNTER_DIFFICULTY;
    if ( !pcs.length || !foes.length || !table?.length ) return null;
    const budget = [0, 0, 0];
    for ( const pc of pcs ) (table[Math.min(table.length - 1, Math.max(1, Math.round(pc.level ?? 1)))] ?? []).forEach((v, i) => { budget[i] += v; });
    const xp = foes.reduce((s, h) => s + (h.xp ?? 0), 0);
    const [low, moderate, high] = budget;
    const [label, key] = xp >= high * 2 ? ["extreme", "BeyondHigh"] : xp >= high ? ["severe", "High"] : xp >= moderate ? ["moderate", "Moderate"]
      : xp >= low ? ["low", "Low"] : ["trivial", "BelowLow"];
    return { label, text: game.i18n.localize(`FFDND5E.Difficulty.${key}`), xp, budgets: budget };
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
