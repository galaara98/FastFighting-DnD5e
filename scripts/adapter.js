/**
 * D&D Fifth Edition adapter: reads dnd5e actors (through their items' activities) into CombatantSpecs and commits
 * outcomes back. Written against dnd5e 6 on Foundry v14; values are read defensively so older data still works.
 */
import { SystemAdapter, parseFormula, part } from "./core.js";
import { dnd5eRules, proficiency } from "./rules.js";
import { deriveDnd5eTraits, isMindless } from "./traits.js";
import { dnd5eHints, dnd5eTactics, alignmentKey, biographyOf, spokenLanguages, speaksAtAll, plainText as sheetText } from "./auto.js";
import { parseMultiattackOptions } from "./multiattack.js";
import { rankLeaders } from "./leadership.js";
import { commitDnd5eOutcome, commitDnd5eChanges, describeDnd5eOutcome, commitDnd5eConcession } from "./commit.js";
import { readDnd5eTurn } from "./read-turn.js";
import { modsFromChanges, fromWords, effectLabel, durationRounds, helps } from "./effects.js";
import { ON_HIT, HIT_WORDS, ridersFrom, namesFiends } from "./riders.js";
import { edgeActions, studyCheck } from "./edges.js";
import { loreBoost } from "./lore.js";
import { formulaNumber, plainDice } from "./arithmetic.js";
import { t, skillName, conditionName, coin, englishName, englishDescription, languageNames } from "./words.js";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const MODES = ["walk", "fly", "swim", "climb", "burrow"];
const PHYSICAL = new Set(["weapon", "equipment", "consumable", "tool", "loot"]);
/** The item properties that say what a thing is made of (adamantine, silvered). */
const MATERIALS = ["ada", "sil"];

/** Creature sizes, smallest first (dnd5e and PF2e use the same keys). */
const SIZES = ["tiny", "sm", "med", "lg", "huge", "grg"];
const sizeOf = key => { const i = SIZES.indexOf(String(key ?? "med")); return i < 0 ? 2 : i; };

/** What a legendary action costs from the pool: its activation's value, else "(Costs 2 Actions)" in its name. */
export function legendaryCost(activity, item) {
  const value = Number(activity?.activation?.value);
  if ( Number.isFinite(value) && value > 0 ) return value;
  const named = /costs?\s+(\d)\s+actions?/i.exec(item?.name ?? "");
  return named ? Number(named[1]) : 1;
}

/**
 * The attack a legendary action makes, by its words ("The dragon makes a tail attack", "makes one Rend attack"):
 * the name of one of the creature's own attacks, or null.
 */
export function legendaryAttack(text, attackNames) {
  const said = /\bmakes?\s+(?:a|an|one)\s+(.+?)\s+attack\b/i.exec(text ?? "")?.[1]?.toLowerCase();
  if ( !said ) return null;
  return attackNames.find(n => n.toLowerCase() === said) ?? attackNames.find(n => said.includes(n.toLowerCase()) || n.toLowerCase().includes(said)) ?? null;
}

const legendaryLabel = () => {
  const key = "DND5E.LegendaryResistance.Label";
  const text = globalThis.game?.i18n?.localize?.(key);
  return text && text !== key ? text : t("LegendaryResistance");
};

/** "Recharge 5–6": the use comes back on a d6 at or over the formula, at the start of the creature's turn. */
export function rechargeOf(uses) {
  const recovery = (uses?.recovery ?? []).find(r => r.period === "recharge");
  if ( !recovery ) return {};
  const on = parseInt(recovery.formula ?? "6");
  return { recharge: { on: Number.isFinite(on) ? Math.min(6, Math.max(2, on)) : 6, die: 6 } };
}

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
  charmed: { charmed: 1 },
  deafened: { deafened: 1 }
};
/** What a spell's effect does to its target: the same, except that a charm (or domination) turns it to its caster's side. */
const EFFECT_CONDITIONS = { ...STATUS_CONDITIONS, charmed: { controlled: 1 } };
/** Statuses that help their bearer, as bonuses: unseen, it attacks with advantage and is attacked at disadvantage. */
const STATUS_MODS = { invisible: { adv: 1, defAdv: -1 } };
/**
 * A creature's features by identifier (dnd5e's slug, the same in the SRD and every book, whatever the language) and,
 * failing that, by name.
 */
function featureKeys(actor) {
  const out = [];
  for ( const i of actor.items ) {
    if ( i.type !== "feat" ) continue;
    const id = i.identifier ?? i.system?.identifier;
    if ( id ) out.push(String(id));
    out.push(String(englishName(i)).toLowerCase());
  }
  return out;
}
const hasFeature = (features, id, name) => features.includes(id) || features.some(f => f.includes(name));
const featureItem = (actor, id, name) => actor.items.find(i => i.type === "feat" && ((i.identifier ?? i.system?.identifier) === id || String(englishName(i)).toLowerCase() === name));

/** The effects an item puts on its owner (not those it puts on a target), each with its changes and whether it's off. */
const ownEffects = item => [...(item.effects ?? [])].filter(e => e.transfer !== false)
  .map(e => ({ disabled: !!e.disabled, changes: [...(e.system?.changes ?? e.changes ?? [])].map(c => ({ key: c.key, value: c.value })) }));

/** The system's names for the alignments (CONFIG.DND5E.alignments), by key, in the table's language. */
const alignmentNames = () => Object.fromEntries(Object.entries(globalThis.CONFIG?.DND5E?.alignments ?? {}).map(([k, v]) => [k, game.i18n.localize(typeof v === "string" ? v : v?.label ?? "")]));

/** Is it in the world's party (dnd5e's primary party)? Undefined when there's none to be in. */
function inParty(actor) {
  const party = globalThis.game?.actors?.party;
  if ( !party ) return undefined;
  const members = party.system?.members;
  const ids = members?.ids instanceof Set ? members.ids : new Set([...(members ?? [])].map(m => m?.actor?.id ?? m?.id));
  return ids.has(actor.id);
}

/** How much of an embedded page a biography reads (a page can be a whole chapter). */
const EMBED_CAP = 5000;

/**
 * A biography's @Embed[...] of a page in this world (the 2024 books put a creature's lore there) as the start of that
 * page's text (EMBED_CAP characters), where Foundry has the page at hand and the actor's players could read it
 * themselves; else nothing. Only a link within Foundry is followed: an embed names a document here, never a web address.
 */
function embedded(html, actor = null) {
  // (Its players: the users besides the GM who own it. A creature of the GM's own, owned by none, may read any page.
  // A page that leaves its ownership to its journal is Foundry's to ask the journal about.)
  const players = [...(globalThis.game?.users ?? [])].filter(u => !u.isGM && actor?.testUserPermission?.(u, "OWNER"));
  const readable = page => !players.length || players.some(u => !!page.testUserPermission?.(u, "OBSERVER"));
  return String(html ?? "").replace(/@Embed\[([^\]\s]+)[^\]]*\](?:\{[^}]*\})?/g, (m, uuid) => {
    if ( uuid.includes("://") ) return " ";
    try {
      const page = globalThis.fromUuidSync?.(uuid, { strict: false });
      return typeof page?.text?.content === "string" && readable(page) ? ` ${page.text.content.slice(0, EMBED_CAP)} ` : " ";
    } catch ( err ) {
      return " ";
    }
  });
}

/**
 * One of its actions' names in English (the item it comes from by the English name Babele keeps, "Cimitarra" ->
 * "Scimitar"; "Cimitarra: Ataque" -> "Scimitar: Ataque"), to match what an English description says.
 */
function englishActionName(actor, name) {
  for ( const i of actor.items ?? [] ) {
    if ( name === i.name || String(name).startsWith(`${i.name}:`) || String(name).startsWith(`${i.name} `) ) return englishName(i) + String(name).slice(i.name.length);
  }
  return name;
}

const DAMAGE_WORDS = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
/** The damage types named in a phrase ("acid or fire damage", "Radiant damage or damage from holy water"). */
const damageWordsIn = text => DAMAGE_WORDS.filter(w => new RegExp(`\\b${w}\\b`, "i").test(text ?? ""));

/**
 * Regeneration, from its words: "regains 10 hit points at the start of its turn. If the troll takes acid or fire
 * damage, this trait doesn't function ..." -> {amount, stoppedBy}, or null.
 */
export function regenerationFrom(text, healed = null) {
  // (How much: in its words, or the trait's own healing when the words only point to it.)
  const words = /regains (\d+) hit points at the start of (?:its|each of its|their) turns?/i.exec(text ?? "");
  const amount = words ? Number(words[1]) : Number(healed) || 0;
  if ( !(amount > 0) || !/regains\b[^.]*\bat the start of/i.test(text ?? "") ) return null;
  const stop = /takes ([^.]*?) damage(?: or [^.]*?)?, this (?:trait|ability) doesn['’]t function/i.exec(text) ?? /if (?:it|the \w+) takes ([^.]*?) damage/i.exec(text);
  // "If it has at least 1 hit point": nothing keeps it from dying at 0.
  const needsHp = /if it has at least 1 hit point/i.test(text);
  return { amount, stoppedBy: stop ? damageWordsIn(stop[0]) : [], ...(needsHp ? { needsHp: true } : {}) };
}

/**
 * Undead Fortitude, from its words: "a Constitution saving throw with a DC of 5 + the damage taken, unless the
 * damage is radiant or from a critical hit" -> {save, base, except, notOnCrit}, or null.
 */
export function holdOnFrom(text, label) {
  const m = /(strength|dexterity|constitution|wisdom|intelligence|charisma) saving throw \(?(?:with a )?DC (?:of |equal to )?(\d+) (?:\+|plus) the damage/i.exec(text ?? "");
  if ( !m ) return null;
  const unless = /unless ([^.]*)/i.exec(text)?.[1] ?? "";
  const save = { strength: "str", dexterity: "dex", constitution: "con", wisdom: "wis", intelligence: "int", charisma: "cha" }[m[1].toLowerCase()];
  return { save, base: Number(m[2]), except: damageWordsIn(unless), notOnCrit: /critical/i.test(unless), label };
}
const meanOf = parts => parts.reduce((s, p) => s + (p.flat ?? 0) + (p.dice ?? []).reduce((t, d) => t + (d.n * (d.faces + 1)) / 2, 0), 0);

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
 * How many more darts, rays or beams a spell makes for each slot level above its own (Magic Missile, Scorching Ray:
 * "one more dart for each spell slot level above 1"): 0 when it doesn't say.
 */
export function moreProjectilesPerLevel(description) {
  const text = String(description ?? "").replace(/<[^>]+>/g, " ");
  const m = new RegExp(`\\b(one|an?|two)\\s+(?:more|additional|extra)\\s+(?:${PROJECTILES})\\s+for\\s+each\\s+(?:spell\\s+)?slot\\s+level\\s+above`, "i").exec(text);
  return m ? (/two/i.test(m[1]) ? 2 : 1) : 0;
}

/**
 * The words of an HTML description, with dnd5e's enrichers read: [[/item .id]]{label} (or the item's own name),
 * [[lookup @name]]{label}, @UUID[...]{label}.
 */
export function plainText(html, actor = null, english = false) {
  // (english: an item a description points to, by its English name, to read with an English description.)
  const itemName = item => (item ? (english ? englishName(item) : item.name) : null);
  return String(html ?? "")
    // &Reference[prone apply=false]{Prone} (the 2024 books' condition links): the label, else the name.
    .replace(/&(?:amp;)?Reference\[([^\]]+?)(?:\s+\w+=[^\]]*)?\](?:\{([^}]*)\})?/gi, (m, name, label) => label ?? name)
    .replace(/\[\[\/item\s+\.?([^\]\s]+)\]\](?:\{([^}]*)\})?/g, (m, ref, label) => label ?? itemName(actor?.items?.get(ref.split(".").pop())) ?? itemName(actor?.items?.getName?.(ref)) ?? "")
    .replace(/\[\[[^\]]*\]\](?:\{([^}]*)\})?/g, (m, label) => label ?? "")
    .replace(/@\w+\[[^\]]*\](?:\{([^}]*)\})?/g, (m, label) => label ?? "")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * An attack's "at Advantage" version (the 2024 Monster Manual writes "plus 1d4 damage if the attack roll had Advantage"
 * as a second activity, "Attack at Advantage"): not an attack of its own, only the extra damage when it has advantage.
 */
const ADVANTAGE_VARIANT = /\b(?:at|with) advantage\b|con ventaja/i;

/** Consumables nobody spends in a fight (torches, rations, candles ...). */
const IDLE_CONSUMABLES = new Set(["trinket", "food"]);

/** Things a summoning calls that aren't creatures at all: nobody attacks them, and they don't hold the field alone. */
const NOT_CREATURES = new Set(["spiritual-weapon", "flaming-sphere", "arcane-sword", "mordenkainens-sword", "bigbys-hand", "arcane-hand"]);
const CREATURE_CACHE = new Map();

/** A creature of this challenge rating and type from the installed books (the SRD's own first), for a summoning that names none. */
async function creatureByCr(cr, types = []) {
  const key = `${cr}|${types.join(",")}`;
  if ( !CREATURE_CACHE.has(key) ) CREATURE_CACHE.set(key, (async () => {
    const packs = [...game.packs].filter(p => p.documentName === "Actor").sort((a, b) => (a.collection.startsWith("dnd5e.") ? 0 : 1) - (b.collection.startsWith("dnd5e.") ? 0 : 1));
    for ( const pack of packs ) {
      const index = await pack.getIndex({ fields: ["type", "system.details.cr", "system.details.type.value"] });
      const found = index.filter(e => e.type === "npc" && Number(e.system?.details?.cr) === Number(cr) && (!types.length || types.includes(e.system?.details?.type?.value)))
        .sort((a, b) => a.name.localeCompare(b.name))[0];
      if ( found ) return pack.getDocument(found._id);
    }
    return null;
  })().catch(() => null));
  return CREATURE_CACHE.get(key);
}

/**
 * What dnd5e works a summoning's formulas out with when it summons (the activity's roll data): the caster's own numbers
 * (@attributes.spell.mod, @abilities.wis.mod, @classes.ranger.levels, @prof), the item's at the level it's cast at
 * (@item.level: here its own), the activity's ability modifier (@mod), and the casting's scaling (@scaling: 1 at the
 * item's own level, one more for each level above it; @scaling.increase: the levels above, so 0 here; a cantrip's by its
 * caster's level). Without an activity's own: the caster's, with the item's, and its scaling from its flags.
 */
export function summonData(actor, item, activity) {
  try {
    const data = activity?.getRollData?.({ deterministic: true });
    if ( data ) return data;
  } catch ( err ) { /* worked out below */ }
  let own = {};
  try {
    own = actor?.getRollData?.({ deterministic: true }) ?? {};
  } catch ( err ) { /* none to read */ }
  const increase = Number(item?.flags?.dnd5e?.scaling) || 0;
  return { ...own, item: { ...(item?.system ?? {}) }, scaling: { increase, value: increase + 1, toString: () => String(increase + 1) } };
}

/** A summoning's formula as a number, its @data filled in (Foundry's own substitution): arithmetic only, never run as code. */
export function summonNumber(formula, data, fallback = 1) {
  try {
    return formulaNumber(Roll.replaceFormulaData(String(formula || fallback), data, { missing: "0" }), fallback);
  } catch ( err ) {
    return fallback;
  }
}

/**
 * A summoning's damage bonus ("@mod + (@scaling)d12") as dice and a flat number, its @data filled in; null when it's
 * none, or anything but dice and numbers added up.
 */
export function summonDice(formula, data) {
  if ( !formula ) return null;
  try {
    const text = plainDice(Roll.replaceFormulaData(String(formula), data, { missing: "0" })).replace(/\[[^\]]*\]/g, "");
    if ( !/^[\d\s+\-d]*$/i.test(text) ) return null;
    const p = parseFormula(text);
    return p.dice.some(d => d.n > 0) || p.flat ? { ...p, dice: p.dice.filter(d => d.n > 0) } : null;
  } catch ( err ) {
    return null;
  }
}

/** Base weapons that show in the story as more than their damage (the core's story families), by identifier. */
const WEAPON_LOOKS = Object.freeze({
  pistol: "ballistic", revolver: "ballistic", musket: "ballistic", huntingrifle: "ballistic", automaticrifle: "ballistic", shotgun: "ballistic",
  laserpistol: "laser", laserrifle: "laser"
});

/** How a weapon looks in the story: its base weapon's, or gunfire for a firearm. Undefined: its damage says. */
export function weaponLook(item) {
  if ( item?.type !== "weapon" ) return undefined;
  return WEAPON_LOOKS[item.system?.type?.baseItem] ?? (item.system?.properties?.has?.("fir") ? "ballistic" : undefined);
}

export class Dnd5eAdapter extends SystemAdapter {
  static systemId = "dnd5e";

  /** Building a summoned creature (which doesn't summon in turn). */
  #summoning = false;

  get label() {
    return t("Label");
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
    const features = featureKeys(actor);

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

    const hits = { riders: [], pools: {}, names: {} };
    const actions = await this.#actions(actor, level, features, hits);
    const mending = this.#mending(actor, hits);
    const resources = { ...hits.pools };
    for ( const a of actions ) if ( a.resource && a.pool !== undefined ) resources[a.resource] = a.pool;
    for ( const a of actions ) delete a.pool;
    // (Heroic) Inspiration: a reroll, spent to keep someone from dying.
    if ( actor.type === "character" && sys.attributes?.inspiration ) resources.fate = 1;
    // Legendary Resistance: a failed save it simply makes, so many times a day; legendary actions, so many a round.
    const legres = sys.resources?.legres ?? {};
    const resistLeft = Math.max(0, Number(legres.value ?? ((Number(legres.max) || 0) - (Number(legres.spent) || 0))) || 0);
    if ( Number(legres.max) > 0 ) resources.legres = resistLeft;
    const legendaryPool = Number(sys.resources?.legact?.max) || 0;

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
      resourceNames: Object.keys(hits.names).length ? hits.names : undefined,
      riders: hits.riders.length ? hits.riders : undefined,
      reactions: this.#reactions(actor, level, resources) ?? undefined,
      legendary: legendaryPool && actions.some(a => a.legendary) ? { pool: legendaryPool } : undefined,
      standFirm: Number(legres.max) > 0 ? { pool: "legres", label: legendaryLabel() } : undefined,
      traits: Object.fromEntries(Object.entries(derived.traits).map(([k, v]) => [k, { base: v, fudge: 0 }])),
      traitReasons: derived.reasons,
      flags: { ...derived.flags },
      diesAtZero: actor.type !== "character",
      dying: sys.attributes?.death?.failure ?? 0,
      // At 0 HP a 5e creature is dying until it has three successes (or is stabilized).
      stable: (hp.value ?? 0) <= 0 ? (sys.attributes?.death?.success ?? 0) >= 3 : undefined,
      deathSaves: { success: sys.attributes?.death?.success ?? 0, failure: sys.attributes?.death?.failure ?? 0 },
      ...mending,
      ...this.#saveFeatures(actor, features, level),
      conditions: this.#conditions(actor),
      perception: skillMod("prc") ?? 0,
      senses: this.#senses(sys),
      mods: await this.#activeMods(actor),
      fateLabel: this.#fateLabel(),
      // Anyone can try to stabilize the dying with a DC 10 Wisdom (Medicine) check.
      firstAid: (actor.type === "character" || creature === "humanoid") && skillMod("med") !== null ? { mod: skillMod("med") } : null,
      // Lifting something off someone (Dexterity (Sleight of Hand)): a character, or a creature with the wits to; not a
      // beast, nor the mindless or one with an animal's mind (Intelligence 3 or less).
      theft: skillMod("slt") !== null && (actor.type === "character" || (creature !== "beast" && (sys.abilities?.int?.value ?? 10) > 3))
        ? { skill: skill("slt")?.label ?? skillName("slt"), mod: skillMod("slt") } : null,
      // A locked door: a Strength (Athletics) check to force it, or thieves' tools to pick it (proficiency, and the tools
      // themselves for a character).
      doorWork: {
        force: { mod: skillMod("ath") ?? sys.abilities?.str?.mod ?? 0 },
        pick: sys.tools?.thief && (actor.type !== "character" || actor.items.some(i => i.type === "tool" && i.system.type?.baseItem === "thief"))
          ? { mod: sys.tools.thief.total ?? sys.tools.thief.mod ?? 0 } : null
      },
      // Sizing a foe up (a Lore-Collector): the Study action, with its best knowledge skill (2024: Arcana, History,
      // Investigation, Nature, Religion).
      sizeUp: isMindless(sys.abilities?.int?.value, creature) ? undefined : studyCheck(sys, loreBoost()),
      creatureTraits: [creature],
      // What kind of creature (the planner groups neutrals by it): its type, narrowed by a subtype (humanoid (goblinoid)).
      creatureKind: [creature, String(sys.details?.type?.subtype ?? "").trim().toLowerCase()].filter(Boolean).join(":") || null,
      size: sizeOf(sys.traits?.size),
      social: {
        pitches: {
          persuade: skillMod("per") !== null ? { skill: skillName("per"), mod: skillMod("per") } : null,
          intimidate: skillMod("itm") !== null ? { skill: skillName("itm"), mod: skillMod("itm") } : null,
          deceive: skillMod("dec") !== null ? { skill: skillName("dec"), mod: skillMod("dec") } : null
        },
        // Insight sees through all three; Perception keeps hands off your purse.
        resist: {
          persuade: { dc: passive("ins"), label: t("Passive", { skill: skillName("ins") }) },
          intimidate: { dc: passive("ins"), label: t("Passive", { skill: skillName("ins") }) },
          deceive: { dc: passive("ins"), label: t("Passive", { skill: skillName("ins") }) },
          steal: { dc: passive("prc"), label: t("Passive", { skill: skillName("prc") }) }
        },
        resolve: (defenses.wis ?? 0) - (proficiency(level) + 1),
        // (Those it speaks: its sheet's, and those its custom languages name; none if it can't speak.)
        languages: spokenLanguages(sys.traits?.languages, languageNames()),
        mindless: isMindless(sys.abilities?.int?.value, creature)
      },
      valuables: this.#valuables(actor),
      leadership: this.#leadershipEntry(actor, tokenDoc.id, level)
    };
  }

  /* -------------------------------------------- */

  /**
   * Buffs and debuffs already on it when the fight starts (a Bless cast beforehand, a Faerie Fire outline). dnd5e's
   * own numbers already hold flat bonuses (Shield of Faith's AC, a Rage's damage) and dice on damage; what they leave
   * out is added here: dice on attack rolls and saves (Bless, Bane), helpful statuses (invisible), and what a spell's
   * words say (Faerie Fire's advantage, Haste's extra action). Null when there's nothing.
   */
  async #activeMods(actor) {
    const list = [];
    for ( const effect of actor.appliedEffects ?? [] ) {
      const { mods } = modsFromChanges(effect.changes ?? []);
      const dice = Object.fromEntries(Object.entries(mods).filter(([k]) => k === "attackDie" || k === "saveDie"));
      if ( Object.keys(dice).length ) list.push(dice);
      for ( const status of effect.statuses ?? [] ) if ( STATUS_MODS[status] ) list.push(STATUS_MODS[status]);
      let origin = null;
      try {
        origin = effect.origin ? await fromUuid(effect.origin) : null;
      } catch ( err ) { /* gone */ }
      if ( origin?.type === "spell" ) {
        const said = fromWords(plainText(englishDescription(origin)), mods);
        if ( said.endsOnAttack && (effect.statuses?.has?.("invisible") ?? false) ) list.pop(); // invisible until it attacks
        if ( Object.keys(said.mods).length ) list.push(said.mods);
      }
    }
    return list.length ? list : null;
  }

  /**
   * Its senses, sorted into the core's (spec.senses), the farthest of each in feet: darkvision and truesight see in
   * the dark (lowlight); blindsight and tremorsense are felt.
   */
  #senses(sys) {
    const s = sys.attributes?.senses ?? {};
    const ranges = s.ranges ?? s;
    const units = s.units ?? "ft";
    const out = {};
    for ( const [type, sense] of [["darkvision", "lowlight"], ["truesight", "lowlight"], ["blindsight", "feel"], ["tremorsense", "feel"]] ) {
      const feet = inFeet(ranges[type], units);
      if ( feet > 0 ) out[sense] = Math.max(out[sense] ?? 0, feet);
    }
    return out;
  }

  /** "Heroic Inspiration" under the 2024 rules, "Inspiration" under the 2014 ones. */
  #fateLabel() {
    let modern = true;
    try {
      modern = game.settings.get("dnd5e", "rulesVersion") !== "legacy";
    } catch ( err ) { /* an older dnd5e: no such setting */ }
    return game.i18n.localize(modern ? "FFDND5E.HeroicInspiration" : "FFDND5E.Inspiration");
  }

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
      // (What kind of thing it is, of what, how rare: for a character asking for something of a kind, itemCatalog.)
      const props = item.system.properties;
      const has = p => (props instanceof Set ? props.has(p) : Array.isArray(props) ? props.includes(p) : !!props?.[p]);
      const entry = {
        id: item.id, name: item.name, value: copperValue(item.system.price),
        category: item.type, material: MATERIALS.find(has) ?? "", rarity: item.system.rarity ?? ""
      };
      if ( !item.system.equipped ) stowed.push(entry);
      else if ( item.type === "weapon" || item.system.type?.value === "shield" ) wielded.push(entry);
    }
    return {
      money,
      denominations: [{ label: coin("pp"), value: 1000 }, { label: coin("gp"), value: 100 }, { label: coin("sp"), value: 10 }, { label: coin("cp"), value: 1 }],
      stowed,
      wielded
    };
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  async #actions(actor, level, features, hits = { riders: [], pools: {}, names: {} }) {
    const out = [];
    const legendaryItems = [];
    const legendaryDone = new Set();
    for ( const item of actor.items ) {
      // What rides on a hit (smites, Stunning Strike, maneuvers) isn't an action of its own.
      const onHit = this.#onHit(actor, item);
      if ( onHit ) {
        hits.riders.push(...onHit.riders);
        Object.assign(hits.pools, onHit.pools);
        Object.assign(hits.names, onHit.names);
        continue;
      }
      if ( item.type === "spell" && !this.#spellReady(actor, item) ) continue;
      // A character only fights with the weapons it has equipped.
      if ( actor.type === "character" && item.type === "weapon" && !item.system.equipped ) continue;
      if ( item.type === "consumable" && IDLE_CONSUMABLES.has(item.system.type?.value) ) continue;
      const riders = [];
      const mine = [];
      if ( (item.system.activities ?? []).some?.(a => a.activation?.type === "legendary") ) legendaryItems.push(item);
      const atAdvantage = [];
      for ( const activity of item.system.activities ?? [] ) {
        if ( activity.type === "summon" ) {
          const called = await this.#summonFrom(actor, item, activity);
          if ( called ) mine.push(called);
          continue;
        }
        if ( activity.type === "attack" && ADVANTAGE_VARIANT.test(activity.name ?? "") ) {
          atAdvantage.push(activity);
          continue;
        }
        const action = this.#fromActivity(actor, item, activity);
        if ( action?.riderFor ) riders.push(action.rider);
        else if ( action ) mine.push(action);
      }
      // (Its extra damage, on the plain attack, only with advantage.)
      for ( const activity of atAdvantage ) {
        const plain = mine.find(a => a.kind === "strike" || a.kind === "spell-attack");
        const more = plain ? this.#parts(activity).slice(plain.damage?.length ?? 0) : [];
        if ( more.length ) plain.bonusDamage = [...(plain.bonusDamage ?? []), { id: `advantage:${activity.id}`, when: "advantage", parts: more }];
      }
      if ( item.type === "spell" ) mine.splice(0, mine.length, ...this.#atSlotLevels(actor, item, mine));
      for ( const a of mine ) if ( riders.length && a.kind !== "heal" && a.kind !== "buff" ) a.effects = [...(a.effects ?? []), ...riders];
      // One mark per spell: "Move Mark" and "Curse New Creature" are the same spell moving on.
      const marks = mine.filter(a => a.outcome?.mark);
      const first = marks[0] ? String(marks[0].id).split("@")[0] : null;
      out.push(...mine.filter(a => !a.outcome?.mark || String(a.id).split("@")[0] === first));
      if ( mine.length ) legendaryDone.add(item.id);
    }
    // A legendary action that only says which of its attacks it makes ("The dragon makes a tail attack"): that attack,
    // at the legendary action's cost.
    for ( const item of legendaryItems ) {
      if ( legendaryDone.has(item.id) ) continue;
      const activity = (item.system.activities ?? []).find?.(a => a.activation?.type === "legendary");
      const attacks = out.filter(a => a.kind === "strike" && !a.legendary).map(a => a.name);
      const said = legendaryAttack(plainText(englishDescription(item), actor, true), attacks.map(n => englishActionName(actor, n)));
      const named = said ? attacks.find(n => englishActionName(actor, n) === said) : null;
      const base = named && out.find(a => a.name === named && !a.legendary);
      if ( base ) out.push({ ...base, id: `${actor.id}.${item.id}.legendary`, name: item.name, legendary: legendaryCost(activity, item), uses: undefined, resource: undefined, recharge: undefined });
    }
    // Anyone can Dodge (attacks against it have disadvantage until its next turn): a 5e shield is already in its AC,
    // so the shield answer says how readily it takes this turn to its own defense instead. Characters and humanoids can
    // Shove a foe prone (a Strength or Dexterity save against 8 + Strength + proficiency).
    out.push({ id: `${actor.id}.dodge`, name: t("Dodge"), kind: "buff", targets: "self", cost: 1, traits: [], tell: "dodge", guard: true, setup: true, outcome: { mods: { defAdv: -1 }, rounds: 1, label: t("Dodging") } });
    // Hide (anyone; a rogue's Cunning Action makes it a bonus action): Dexterity (Stealth) against DC 15, the SRD 5.2's.
    // Hidden, it's Invisible (its attacks with advantage, those against it at disadvantage) until it attacks. Not with a
    // foe beside it (rules.usable), the cover the rules want being the GM's to judge. One keeping a low profile goes for it.
    const stealth = Number(actor.system.skills?.ste?.total ?? actor.system.skills?.ste?.mod);
    if ( Number.isFinite(stealth) && !isMindless(actor.system.abilities?.int?.value, String(actor.system.details?.type?.value ?? "").toLowerCase()) ) {
      const cunning = featureItem(actor, "cunning-action", "cunning action");
      out.push({ id: `${actor.id}.hide`, name: t("Hide"), kind: "buff", targets: "self", cost: 1, economy: cunning ? "bonus" : undefined, traits: [], hide: true, setup: true, leans: ["lowProfile"],
        check: { mod: stealth, dc: 15, label: skillName("ste") }, onDegree: [null, null, { conditions: { hidden: 1 }, rounds: 10, label: conditionName("invisible") }, { conditions: { hidden: 1 }, rounds: 10, label: conditionName("invisible") }] });
    }
    // Help, and Insight before talking (edges.js).
    out.push(...edgeActions({ id: actor.id, sys: actor.system, mindless: isMindless(actor.system.abilities?.int?.value, String(actor.system.details?.type?.value ?? "").toLowerCase()) }));
    // Reckless Attack (barbarians): advantage on its attacks, and against it, until its next turn; no action at all.
    const reckless = featureItem(actor, "reckless-attack", "reckless attack");
    if ( reckless ) out.push({ id: `${actor.id}.reckless`, name: reckless.name, kind: "buff", targets: "self", economy: "free", oncePerTurn: true, traits: [], itemId: reckless.id, tell: "reckless", special: true,
      outcome: { mods: { adv: 1, defAdv: 1 }, rounds: 1, label: t("Reckless") } });
    // Action Surge (fighters): one more action, this turn, once a rest.
    const surge = featureItem(actor, "action-surge", "action surge");
    if ( surge ) out.push({ id: `${actor.id}.action-surge`, name: surge.name, kind: "buff", targets: "self", economy: "free", oncePerTurn: true, traits: [], itemId: surge.id, tell: "surge", special: true,
      ...this.#resource(actor, surge), outcome: { actionsNow: 1, rounds: 1, label: t("Surging") } });
    const creatureType = String(actor.system.details?.type?.value ?? "").toLowerCase();
    if ( actor.type === "character" || creatureType === "humanoid" ) {
      const dc = 8 + (actor.system.abilities?.str?.mod ?? 0) + proficiency(level);
      const prone = { conditions: { prone: 1 }, rounds: 1, label: t("KnockedProne") };
      // (Only a creature at most one size larger.)
      out.push({ id: `${actor.id}.shove`, name: t("Shove"), kind: "control", cost: 1, traits: [], melee: true, reach: 5, maxSize: sizeOf(actor.system.traits?.size) + 1,
        save: { type: ["str", "dex"], dc, basic: false }, onSave: [prone, prone, null, null] });
      // Grapple (an Unarmed Strike, the SRD 5.2's): the same save, or Grappled (it can't move) until it breaks free,
      // the save again at the end of each of its turns.
      const held = { conditions: { immobilized: 1 }, rounds: 10, repeatSave: { type: ["str", "dex"], dc }, label: conditionName("grappled") };
      out.push({ id: `${actor.id}.grapple`, name: t("Grapple"), kind: "control", cost: 1, traits: [], melee: true, reach: 5, maxSize: sizeOf(actor.system.traits?.size) + 1,
        save: { type: ["str", "dex"], dc, basic: false }, onSave: [held, held, null, null] });
    }
    this.#sneakAttack(actor, level, features, out);
    // Improved Divine Smite (2014) and Radiant Strikes (2024): a die of radiant on every melee weapon hit.
    if ( hasFeature(features, "radiant-strikes", "improved divine smite") ) {
      for ( const a of out ) if ( a.kind === "strike" && a.weapon && a.melee ) a.bonusDamage = [...(a.bonusDamage ?? []), { id: "radiant-strikes", when: "always", parts: [part([{ n: 1, faces: 8 }], 0, "radiant")] }];
    }
    // Characters with Extra Attack make several weapon attacks with the Attack action.
    if ( actor.type === "character" ) {
      const extra = hasFeature(features, "three-extra-attacks", "three extra attacks") ? 4
        : hasFeature(features, "two-extra-attacks", "two extra attacks") || features.some(f => f.includes("extra attack (2)")) ? 3
          // (A warlock's Thirsting Blade: the same, with its pact weapon. Extra Attack from two classes doesn't add up.)
          : hasFeature(features, "extra-attack", "extra attack") || hasFeature(features, "thirsting-blade", "thirsting blade") ? 2 : 1;
      if ( extra > 1 ) {
        for ( const a of out.filter(x => x.kind === "strike" && x.weapon && x.economy !== "bonus") ) {
          out.push({ ...a, id: `${a.id}.extra`, name: `${a.name} ×${extra}`, sequence: Array.from({ length: extra }, (_, i) => ({ ...a, id: `${a.id}.${i}` })) });
        }
      }
    }
    if ( actor.type === "character" ) this.#bonusStrikes(actor, level, features, hits, out);
    // NPCs' Multiattack: the strikes it makes in one action.
    const multi = actor.items.find(i => i.type === "feat" && ((i.identifier ?? i.system?.identifier) === "multiattack" || /multiattack/i.test(englishName(i))));
    if ( multi ) {
      // Its everyday attacks, best first (limited uses such as a breath weapon aren't part of a Multiattack).
      const mean = a => (a.damage ?? []).reduce((s, p) => s + p.flat + p.dice.reduce((t, d) => t + d.n * (d.faces + 1) / 2, 0), 0);
      const strikes = out.filter(a => ["strike", "spell-attack", "save"].includes(a.kind) && a.economy !== "bonus" && a.uses === undefined && !a.resource && !a.legendary)
        .sort((a, b) => ((b.bonus ?? 0) + mean(b)) - ((a.bonus ?? 0) + mean(a)));
      // (Read in English, its attacks by their English names; told by the names they go by here.)
      const english = new Map(strikes.map(s => [englishActionName(actor, s.name), s.name]));
      const options = parseMultiattackOptions(plainText(englishDescription(multi), actor, true), strikes.map(s => ({ name: englishActionName(actor, s.name), melee: !!s.melee })))
        .filter(names => names.length > 1)
        .map(names => names.map(n => english.get(n) ?? n));
      // Several ways to make it ("Scimitar or Pistol in any combination"): one action each, and the simulation picks.
      options.forEach((names, k) => {
        const sequence = names.map((n, i) => ({ ...strikes.find(s => s.name === n), id: `${multi.id}.${k}.${i}` }));
        const label = options.length > 1 ? `${multi.name} (${[...new Set(names)].join(", ")})` : multi.name;
        out.push({ ...sequence[0], id: `${actor.id}.multiattack${k ? `.${k}` : ""}`, name: label, sequence, uses: undefined, resource: undefined });
      });
    }
    return out;
  }

  /**
   * What helps its saves, by identifier or name: Magic Resistance (advantage against spells), Evasion (nothing from a
   * Dexterity save for half on a success, half on a failure), and a paladin's Aura of Protection (Charisma, at least +1,
   * to its own and its friends' saves within 10 feet; 30 from 18th level).
   */
  #saveFeatures(actor, features, level) {
    const out = {};
    if ( hasFeature(features, "magic-resistance", "magic resistance") ) out.magicResistance = true;
    if ( hasFeature(features, "evasion", "evasion") ) out.evasion = "dex";
    if ( hasFeature(features, "aura-of-protection", "aura of protection") ) {
      const cha = Number(actor.system.abilities?.cha?.mod) || 0;
      out.saveAura = { bonus: Math.max(1, cha), range: actor.type === "character" && level >= 18 ? 30 : 10 };
    }
    return out;
  }

  /**
   * Regeneration (a troll's, a vampire's) and Undead Fortitude, by identifier or name, read from their words; and
   * Relentless Endurance (an orc's), whose use goes in `hits` as a pool of its own.
   */
  #mending(actor, hits) {
    const out = {};
    const regen = featureItem(actor, "regeneration", "regeneration");
    if ( regen ) {
      const heal = (regen.system.activities ?? []).find?.(a => a.type === "heal");
      const healed = heal ? this.#parts(heal, true).reduce((s, p) => s + p.flat + p.dice.reduce((t, d) => t + d.n * (d.faces + 1) / 2, 0), 0) : null;
      const r = regenerationFrom(plainText(englishDescription(regen), actor, true), healed);
      if ( r ) out.regen = r;
    }
    const fortitude = featureItem(actor, "undead-fortitude", "undead fortitude");
    if ( fortitude ) {
      const h = holdOnFrom(plainText(englishDescription(fortitude), actor, true), fortitude.name);
      if ( h ) out.holdOn = h;
    }
    // Relentless Endurance: 1 hit point instead of 0, with no save to make (any roll meets it), once a long rest, and
    // not when the blow kills it outright (rules.adjustRoll). While it has the use: a pool, for Make it So to spend.
    const relentless = out.holdOn ? null : featureItem(actor, "relentless-endurance", "relentless endurance");
    const left = relentless ? Math.max(0, (Number(relentless.system.uses?.max) || 1) - (Number(relentless.system.uses?.spent) || 0)) : 0;
    if ( left ) {
      const pool = `feature:${relentless.id}`;
      out.holdOn = { save: "con", base: -Infinity, except: [], notOnCrit: false, label: relentless.name, pool };
      hits.pools[pool] = left;
      hits.names[pool] = relentless.name;
    }
    return out;
  }

  /**
   * A character's bonus-action strikes: with a light weapon in each hand, one with the second (without its ability
   * modifier, unless it has the Two-Weapon Fighting style); a monk's Martial Arts (an unarmed strike) and Flurry of
   * Blows (two unarmed strikes, three with Heightened Focus, for a point of Focus or ki).
   */
  #bonusStrikes(actor, level, features, hits, out) {
    const abilities = actor.system.abilities ?? {};
    const props = a => new Set(asArray(actor.items.get(a.itemId)?.system.properties));
    const everyday = out.filter(a => a.kind === "strike" && a.weapon && a.melee && !a.sequence && a.economy !== "bonus" && !a.legendary);
    const light = everyday.filter(a => props(a).has("lig"));
    const lightItems = [...new Set(light.map(a => a.itemId))];
    if ( lightItems.length >= 2 ) {
      const mean = a => (a.damage ?? []).reduce((s, p) => s + p.flat + p.dice.reduce((t, d) => t + d.n * (d.faces + 1) / 2, 0), 0);
      const [, second] = lightItems.map(id => light.filter(a => a.itemId === id).sort((x, y) => mean(y) - mean(x))[0]).sort((x, y) => mean(y) - mean(x));
      const style = hasFeature(features, "two-weapon-fighting", "two-weapon fighting");
      const str = Number(abilities.str?.mod) || 0;
      const mod = Math.max(0, props(second).has("fin") ? Math.max(str, Number(abilities.dex?.mod) || 0) : str);
      const damage = style || !mod ? second.damage : second.damage.map((p, i) => (i === 0 ? { ...p, flat: p.flat - mod } : p));
      out.push({ ...second, id: `${second.id}.off-hand`, name: t("OffHand", { name: second.name }), economy: "bonus", damage });
    }
    // (In a Spanish world: "Ataque sin armas", "desarmado".)
    const unarmed = out.filter(a => a.kind === "strike" && a.melee && !a.sequence && a.economy !== "bonus" && /unarmed|sin armas|desarmad/i.test(a.name))
      .sort((x, y) => (y.bonus ?? 0) - (x.bonus ?? 0))[0];
    if ( !unarmed ) return;
    if ( hasFeature(features, "martial-arts", "martial arts") ) {
      out.push({ ...unarmed, id: `${unarmed.id}.martial-arts`, name: t("MartialArts", { name: unarmed.name }), economy: "bonus" });
    }
    if ( hasFeature(features, "flurry-of-blows", "flurry of blows") ) {
      const ident = i => String(i.identifier ?? i.system?.identifier ?? "");
      const pool = actor.items.find(i => ["monks-focus", "ki", "focus-points", "ki-points"].includes(ident(i)) || /^(?:monk'?s focus|ki)\b/i.test(englishName(i)));
      const price = pool && Number(pool.system.uses?.max) ? this.#usesCost(pool, {}) : null;
      const count = hasFeature(features, "heightened-focus", "heightened focus") ? 3 : 2;
      Object.assign(hits.pools, price?.pools ?? {});
      Object.assign(hits.names, price?.names ?? {});
      out.push({ ...unarmed, id: `${unarmed.id}.flurry`, name: featureItem(actor, "flurry-of-blows", "flurry of blows")?.name ?? t("Flurry"), economy: "bonus", resource: price?.cost.resource,
        sequence: Array.from({ length: count }, (_, i) => ({ ...unarmed, id: `${unarmed.id}.flurry.${i}` })) });
    }
  }

  /** Is this spell castable now: cantrips, prepared or always-prepared spells, pact magic, innate and at-will. */
  #spellReady(actor, item) {
    const s = item.system;
    if ( (s.level ?? 0) === 0 || actor.type === "npc" ) return true;
    const method = s.method ?? s.preparation?.mode;
    if ( ["pact", "innate", "atwill", "always"].includes(method) ) return true;
    return !!(s.prepared ?? s.preparation?.prepared);
  }

  /**
   * A feature or spell that rides on a hit (see riders.js): {riders, pools, names}, or null if it isn't one. Known by
   * identifier, or by its words when it has no attack of its own ("immediately after you hit").
   */
  #onHit(actor, item) {
    const id = String(item.identifier ?? item.system?.identifier ?? "");
    if ( !["feat", "spell"].includes(item.type) || ["sneak-attack", "radiant-strikes"].includes(id) ) return null;
    const activities = [...(item.system.activities ?? [])];
    const text = plainText(englishDescription(item), actor, true);
    const said = HIT_WORDS.test(text) && activities.some(a => ["damage", "save"].includes(a.type)) && !activities.some(a => ["attack", "heal", "summon"].includes(a.type));
    if ( !ON_HIT.has(id) && !said ) return null;
    if ( item.type === "spell" && !this.#spellReady(actor, item) ) return { riders: [], pools: {}, names: {} };
    const damage = [];
    let save = null;
    for ( const a of activities ) {
      if ( a.type === "damage" ) {
        const parts = this.#parts(a);
        if ( !parts.length ) continue;
        let perLevel = this.#perLevel(a);
        // (2014 Divine Smite: a d8 more for each slot level above the first.)
        if ( !perLevel.length && id === "divine-smite" && item.type === "feat" ) perLevel = [part([{ n: 1, faces: 8 }], 0, parts[0].type)];
        damage.push({ parts, perLevel, vs: namesFiends(a.name) });
      } else if ( a.type === "save" ) {
        const s = { type: asArray(a.save?.ability)[0] ?? "con", dc: a.save?.dc?.value ?? (8 + proficiency(actor.system.details?.level ?? 1) + 3) };
        const outcome = this.#outcome(this.#effects(item, a, { words: true }), s);
        if ( outcome ) save = { ...s, outcome };
      }
    }
    // Against fiends and undead: an extra die (2014) or all it deals then (2024: 3d8 rather than 2d8).
    const mean = list => list.reduce((s, x) => s + meanOf(x.parts), 0);
    const versus = damage.filter(x => x.vs);
    if ( versus.length && mean(versus) > mean(damage.filter(x => !x.vs)) ) for ( const x of versus ) x.total = true;
    const cost = this.#hitCost(actor, item, id, activities);
    const key = `${actor.id}.${item.id}`;
    const riders = id === "precision-attack"
      ? ridersFrom({ id: key, name: item.name, text, damage: [], save: null, cost: cost.cost, attackDie: this.#superiorityDie(actor) })
      : ridersFrom({ id: key, name: item.name, text, damage, save, cost: cost.cost });
    return { riders, pools: cost.pools, names: cost.names };
  }

  /**
   * Reactions that answer what's done to it (see the core's responses.js), by identifier: Shield, Uncanny Dodge,
   * Hellish Rebuke, Counterspell, a Battle Master's Parry and Riposte, a monk's Deflect Attacks (or Missiles); and any
   * reaction spell whose effect raises AC (a Shield by another name). A spell gets one entry per slot level it can be
   * cast at, lowest first, so it spends the cheapest slot it has. Null when it has none.
   */
  #reactions(actor, level, resources) {
    const out = [];
    const ident = i => String(i.identifier ?? i.system?.identifier ?? "");
    const sp = actor.system.spells ?? {};
    const slotLevels = min => {
      const list = [];
      for ( let l = min; l <= 9; l++ ) if ( Number(sp[`spell${l}`]?.max) > 0 ) list.push({ key: `slots:${l}`, level: l, pool: Number(sp[`spell${l}`].value) || 0 });
      if ( Number(sp.pact?.max) > 0 && (Number(sp.pact.level) || 0) >= min ) list.push({ key: "pact", level: Number(sp.pact.level), pool: Number(sp.pact.value) || 0 });
      return list;
    };
    const dex = Number(actor.system.abilities?.dex?.mod) || 0;
    for ( const item of actor.items ) {
      const id = ident(item);
      const activities = [...(item.system.activities ?? [])];
      const activation = item.system.activation?.type ?? activities[0]?.activation?.type;
      if ( item.type === "spell" ) {
        if ( activation !== "reaction" || !this.#spellReady(actor, item) ) continue;
        const base = Number(item.system.level) || 1;
        const levels = slotLevels(base);
        const label = item.name;
        for ( const s of levels ) resources[s.key] ??= s.pool;
        if ( id === "counterspell" ) {
          // 2024: the caster saves (Constitution) against your spell DC; 2014: a spell of the slot's level or lower
          // simply fails, a higher one on a check with your spellcasting ability.
          const save = activities.find(a => a.type === "save");
          const ability = actor.system.attributes?.spellcasting ?? "int";
          for ( const s of levels ) {
            const counter = save ? { level: s.level, save: { type: asArray(save.save?.ability)[0] ?? "con", dc: save.save?.dc?.value ?? actor.system.attributes?.spell?.dc ?? 13 } }
              : { level: s.level, mod: Number(actor.system.abilities?.[ability]?.mod) || 0 };
            out.push({ id: `${actor.id}.${item.id}@${s.key}`, label, on: "spell", resource: s.key, range: 60, counter });
          }
          continue;
        }
        const harm = activities.find(a => a.type === "save" && a.damage?.parts?.length);
        if ( id === "hellish-rebuke" || (harm && /\b(?:damaged|damages you|deals damage to you)\b/i.test(plainText(englishDescription(item)))) ) {
          const act = harm ?? activities.find(a => a.type === "save");
          if ( !act ) continue;
          const parts = this.#parts(act);
          const per = this.#perLevel(act);
          const save = { type: asArray(act.save?.ability)[0] ?? "dex", dc: act.save?.dc?.value ?? actor.system.attributes?.spell?.dc ?? 13, basic: act.damage?.onSave !== "none" };
          for ( const s of levels ) {
            const more = per.map(p => ({ ...p, dice: p.dice.map(x => ({ ...x, n: x.n * (s.level - base) })), flat: p.flat * (s.level - base) })).filter(p => p.dice.some(x => x.n > 0) || p.flat);
            out.push({ id: `${actor.id}.${item.id}@${s.key}`, label, on: "damaged", resource: s.key, range: 60, damage: [...parts, ...more], save });
          }
          continue;
        }
        // A reaction spell that raises AC: Shield, or one like it.
        const fx = activities.map(a => this.#effects(item, a)).find(x => x?.mods?.ac > 0);
        if ( id === "shield" || fx ) {
          const ac = fx?.mods?.ac ?? 5;
          for ( const s of levels ) out.push({ id: `${actor.id}.${item.id}@${s.key}`, label, on: "hit", resource: s.key, ac });
        }
        continue;
      }
      if ( item.type !== "feat" ) continue;
      if ( id === "uncanny-dodge" ) out.push({ id: `${actor.id}.${item.id}`, label: item.name, on: "hit", halve: true });
      else if ( id === "deflect-attacks" || id === "deflect-missiles" ) {
        out.push({ id: `${actor.id}.${item.id}`, label: item.name, on: "hit", reduce: part([{ n: 1, faces: 10 }], dex + level, "untyped"), physical: true, ranged: id === "deflect-missiles" || undefined });
      } else if ( id === "parry" || id === "riposte" ) {
        const sup = this.#usesItem(actor, item, null, "trip-attack");
        if ( !sup ) continue;
        const key = `feature:${sup.id}`;
        resources[key] ??= Math.max(0, (Number(sup.system.uses?.max) || 0) - (Number(sup.system.uses?.spent) || 0));
        const die = this.#superiorityDie(actor);
        if ( id === "parry" ) out.push({ id: `${actor.id}.${item.id}`, label: item.name, on: "hit", melee: true, resource: key, reduce: part([{ n: 1, faces: die }], dex, "untyped") });
        else out.push({ id: `${actor.id}.${item.id}`, label: item.name, on: "missed", melee: true, resource: key, strike: true });
      } else if ( id === "death-burst" ) {
        // A mephit's or a magmin's Death Burst: as it dies, a save against what bursts from it, for everyone near (no
        // reaction spent: it's its nature). One that does no damage (a dust mephit's blinding) isn't played yet.
        const act = activities.find(a => a.type === "save" && a.damage?.parts?.length);
        if ( !act ) continue;
        const save = { type: asArray(act.save?.ability)[0] ?? "dex", dc: act.save?.dc?.value ?? 10, basic: act.damage?.onSave !== "none" };
        out.push({ id: `${actor.id}.${item.id}`, label: item.name, on: "slain", free: true, areaBurst: { damage: this.#parts(act), save, range: Number(act.target?.template?.size) || 5 } });
      } else if ( id === "protection" || id === "fighting-style-protection" ) {
        // The Protection fighting style: with a shield, Disadvantage on an attack at a friend within 5 feet (about 5
        // off the roll, as a bonus to the friend's AC against it).
        if ( !actor.items.some(i => i.system?.type?.value === "shield" && i.system?.equipped) ) continue;
        out.push({ id: `${actor.id}.${item.id}`, label: item.name, on: "allyTargeted", range: 5, ac: 5 });
      }
    }
    return out.length ? out : null;
  }

  /**
   * A summoning (Spiritual Weapon, Conjure Animals, Animate Objects ...) as the engine's: the creatures its first
   * usable profile calls, read like any creature (a profile that names a challenge rating and type instead gets one
   * from the installed books), matched to the caster where it says (its spell attack, the save DC, more damage for a
   * higher slot). Things that aren't creatures (a spiritual weapon, a flaming sphere) can't be attacked, and act only
   * when the caster spends its bonus action on them.
   */
  async #summonFrom(actor, item, activity) {
    if ( this.#summoning ) return null;
    if ( item.type === "spell" && !this.#spellReady(actor, item) ) return null;
    // Only what can be called in the middle of a fight (Find Familiar takes an hour).
    const activation = item.system.activation?.type ?? activity.activation?.type ?? "action";
    if ( !["action", "bonus"].includes(activation) ) return null;
    // (The level dnd5e calls it at: a spell's own, a feature's by its class or character level.)
    const level = Number(activity.relevantLevel ?? item.system.level) || 0;
    // A player's item holds these formulas: worked out as arithmetic only, never run as code, with what dnd5e works them
    // out with (summonData).
    const data = summonData(actor, item, activity);
    const value = (formula, fallback = 1, more = data) => summonNumber(formula, more, fallback);
    const id = String(item.identifier ?? item.system?.identifier ?? "");
    const text = plainText(englishDescription(item), actor, true);
    const spellAttack = Number(actor.system.attributes?.spell?.attack ?? actor.system.attributes?.spellattack ?? NaN);
    const prof = Number(data.attributes?.prof) || proficiency(actor.system.details?.level ?? 1);
    const castingMod = Number(actor.system.abilities?.[actor.system.attributes?.spellcasting ?? "int"]?.mod) || 0;
    const fallbackAttack = castingMod + prof;
    for ( const p of activity.profiles ?? [] ) {
      if ( (Number.isFinite(p.level?.min) && level < p.level.min) || (Number.isFinite(p.level?.max) && level > p.level.max) ) continue;
      const count = Math.max(0, p.count ? value(p.count, 1) : 1);
      if ( !count ) continue;
      let src = null;
      try {
        src = p.uuid ? await fromUuid(p.uuid) : await creatureByCr(value(p.cr, 0), [...(p.types ?? [])]);
      } catch ( err ) { /* not installed */ }
      if ( !src ) continue;
      // As dnd5e summons it: a temporary copy (never saved) that knows the casting's level, the caster's modifier and
      // proficiency, so formulas such as "(4 + 2 * (@flags.dnd5e.summon.level - 5))d8" come out right.
      let creature = src;
      try {
        const copy = src.toObject();
        foundry.utils.setProperty(copy, "flags.dnd5e.summon", { level, mod: Number(data.mod ?? castingMod) || 0, prof, origin: item.uuid });
        creature = new CONFIG.Actor.documentClass(copy);
      } catch ( err ) { /* read it as it is */ }
      // (Its bonuses may count the creature's own numbers, as dnd5e's do: "- (@summon.attributes.hp.value / 2)".)
      let own = {};
      try {
        own = creature.getRollData?.({ deterministic: true }) ?? {};
      } catch ( err ) { /* none to read */ }
      const withSummon = { ...data, summon: own };
      this.#summoning = true;
      let spec = null;
      try {
        spec = await this.toCombatantSpec({ actor: creature, id: `summon-${src.id}`, name: src.name, texture: { src: src.img } });
      } finally {
        this.#summoning = false;
      }
      // Something that can't fight (Mage Hand) is no help in one.
      if ( !spec || !spec.actions.some(a => a.damage?.length || a.kind === "control") ) continue;
      const extraAttack = summonDice(activity.bonuses?.attackDamage, withSummon);
      const extraSave = summonDice(activity.bonuses?.saveDamage, withSummon);
      for ( const a of spec.actions ) {
        const attacks = a.kind === "strike" || a.kind === "spell-attack";
        if ( activity.match?.attacks && attacks ) a.bonus = Number.isFinite(spellAttack) ? spellAttack : fallbackAttack;
        if ( activity.match?.saves && a.save ) a.save = { ...a.save, dc: actor.system.attributes?.spell?.dc ?? a.save.dc };
        if ( extraAttack && attacks && a.damage?.length ) a.damage = [...a.damage, { ...extraAttack, type: a.damage[0].type }];
        if ( extraSave && a.kind === "save" && a.damage?.length ) a.damage = [...a.damage, { ...extraSave, type: a.damage[0].type }];
      }
      if ( activity.bonuses?.hp ) {
        const hp = value(activity.bonuses.hp, 0, withSummon);
        spec.hp = { ...spec.hp, value: Math.max(1, spec.hp.value + hp), max: Math.max(1, spec.hp.max + hp) };
      }
      if ( activity.bonuses?.ac ) spec.defenses = { ...spec.defenses, ac: spec.defenses.ac + value(activity.bonuses.ac, 0, withSummon) };
      const thing = NOT_CREATURES.has(id);
      if ( thing ) spec.untargetable = true;
      const concentration = !!(item.system.properties?.has?.("concentration") || item.system.duration?.concentration) || undefined;
      // "As a Bonus Action on your later turns, you can move the weapon and attack": it acts only when told to.
      const told = thing || /\bbonus action\b[^.]*\b(?:move|attack|command|direct)/i.test(text);
      return {
        id: `${actor.id}.${item.id}.${activity.id}`, name: item.name, kind: "summon", cost: 1, economy: activation === "bonus" ? "bonus" : undefined,
        itemId: item.id, traits: [], rank: item.type === "spell" ? level : undefined, concentration, ...this.#resource(actor, item),
        creatures: Array.from({ length: Math.min(count, 8) }, () => spec),
        rounds: durationRounds(item.system.duration) ?? 10,
        sustain: told ? { bonus: 1 } : undefined
      };
    }
    return null;
  }

  /**
   * A spell cast from a slot can be cast from a higher one too, and (the multiclassing rules) from a warlock's pact slot,
   * as a warlock's spell can from the others' slots: one entry per slot it could use, lowest first so it spends the
   * cheapest it has, a higher slot adding its damage for each level up. A spell that doesn't grow gets only the
   * cheapest higher slot (and the pact slot), for when its own level runs out.
   */
  #atSlotLevels(actor, item, actions) {
    const base = Number(item.system.level) || 0;
    if ( !base ) return actions;
    const sp = actor.system.spells ?? {};
    const slots = [];
    for ( let l = base; l <= 9; l++ ) if ( Number(sp[`spell${l}`]?.max) > 0 ) slots.push({ key: `slots:${l}`, level: l, pool: Number(sp[`spell${l}`].value) || 0 });
    const pactLevel = Number(sp.pact?.level) || 0;
    if ( Number(sp.pact?.max) > 0 && pactLevel >= base ) slots.push({ key: "pact", level: pactLevel, pool: Number(sp.pact.value) || 0 });
    if ( slots.length <= 1 ) return actions;
    const out = [];
    for ( const a of actions ) {
      if ( a.resource !== `slots:${base}` && a.resource !== "pact" ) {
        out.push(a);
        continue;
      }
      const activity = item.system.activities?.get?.(String(a.id).split(".").at(-1));
      const per = activity ? this.#perLevel(activity) : [];
      // (Darts and rays: one more for each level up. Magic Missile's darts are all in its damage; a ray is an attack.)
      const shots = moreProjectilesPerLevel(englishDescription(item));
      const darts = a.sequence?.length || projectileCount(englishDescription(item), 1);
      const grows = (per.length > 0 || shots > 0) && a.damage?.length;
      const used = new Set();
      for ( const s of slots ) {
        const higher = s.level > base;
        // (Without growth, one higher slot is enough: the cheapest.)
        if ( higher && !grows && s.key !== "pact" && [...used].some(k => k !== `slots:${base}` && k !== "pact") ) continue;
        used.add(s.key);
        const up = s.level - base;
        const more = grows && up > 0 ? per.map(p => ({ ...p, dice: p.dice.map(d => ({ ...d, n: d.n * up })), flat: p.flat * up })) : [];
        const entry = { ...a, id: s.key === a.resource ? a.id : `${a.id}@${s.key}`, resource: s.key, pool: s.pool, rank: s.level,
          ...(more.length ? { damage: [...a.damage, ...more] } : {}) };
        if ( shots && up > 0 ) {
          const extra = shots * up;
          if ( a.sequence?.length ) entry.sequence = [...a.sequence, ...Array.from({ length: extra }, (_, i) => ({ ...a.sequence[0], id: `${entry.id}.more${i}` }))];
          else if ( darts > 0 ) entry.damage = entry.damage.map(p => ({ ...p, dice: p.dice.map(d => ({ ...d, n: Math.round(d.n * (darts + extra) / darts) })), flat: Math.round(p.flat * (darts + extra) / darts) }));
        }
        out.push(entry);
      }
    }
    return out;
  }

  /** Dice a damage activity adds for each spell slot level above its own. */
  #perLevel(activity) {
    const out = [];
    for ( const p of activity.damage?.parts ?? [] ) {
      const s = p.scaling ?? {};
      const type = asArray(p.types)[0] ?? "untyped";
      if ( s.mode === "whole" && Number(s.number) > 0 && Number(p.denomination) > 0 ) out.push(part([{ n: Number(s.number), faces: Number(p.denomination) }], 0, type));
      else if ( s.formula ) {
        const q = parseFormula(s.formula, type);
        if ( q.dice.length || q.flat ) out.push(q);
      }
    }
    return out;
  }

  /**
   * What a rider costs: spell slots (each level it can be cast at), a pact slot, another feature's uses (Focus, ki,
   * superiority dice) or its own; and what it takes from the turn (a bonus action, the turn's one spell slot).
   * @returns {{cost, pools: Record<string, number>, names: Record<string, string>}}
   */
  #hitCost(actor, item, id, activities) {
    const sp = actor.system.spells ?? {};
    const slots = (min, max = 9) => {
      const out = [];
      for ( let l = min; l <= max; l++ ) {
        const s = sp[`spell${l}`];
        if ( Number(s?.max) > 0 ) out.push({ key: `slots:${l}`, level: l, pool: Number(s.value) || 0 });
      }
      if ( Number(sp.pact?.max) > 0 && (Number(sp.pact.level) || 0) >= min && (Number(sp.pact.level) || 0) <= max ) out.push({ key: "pact", level: Number(sp.pact.level), pool: Number(sp.pact.value) || 0 });
      return out;
    };
    const fromSlots = (list, extra) => ({ cost: { slots: list, ...extra }, pools: Object.fromEntries(list.map(s => [s.key, s.pool])), names: {} });
    const activation = item.system.activation?.type ?? activities[0]?.activation?.type ?? "";
    const turn = activation === "bonus" ? { bonus: 1 } : {};
    if ( item.type === "spell" ) {
      const level = Number(item.system.level) || 1;
      return fromSlots(slots(level), { baseLevel: level, turn: { ...turn, slot: 1 } });
    }
    // 2014 Divine Smite: any slot, up to 5d8.
    if ( id === "divine-smite" ) return fromSlots(slots(1), { baseLevel: 1, maxLevel: 4, turn });
    for ( const a of activities ) {
      for ( const t of a.consumption?.targets ?? [] ) {
        // Eldritch Smite: a pact slot (its damage already counts the slot's level).
        if ( t.type === "attribute" && /spells\.pact/.test(String(t.target ?? "")) ) {
          const pact = slots(1).filter(s => s.key === "pact").map(s => ({ ...s, level: 1 }));
          return fromSlots(pact, { baseLevel: 1, turn });
        }
        if ( t.type === "itemUses" ) {
          const pool = this.#usesItem(actor, item, t.target, id);
          if ( pool ) return this.#usesCost(pool, turn);
        }
      }
    }
    const fallback = this.#usesItem(actor, item, null, id);
    if ( fallback && fallback !== item ) return this.#usesCost(fallback, turn);
    const max = Number(item.system.uses?.max) || 0;
    if ( max ) return { cost: { uses: Math.max(0, max - (item.system.uses?.spent ?? 0)), turn }, pools: {}, names: {} };
    return { cost: { turn }, pools: {}, names: {} };
  }

  #usesCost(pool, turn) {
    const key = `feature:${pool.id}`;
    const left = Math.max(0, (Number(pool.system.uses?.max) || 0) - (Number(pool.system.uses?.spent) || 0));
    return { cost: { resource: key, turn }, pools: { [key]: left }, names: { [key]: pool.name } };
  }

  /**
   * The feature whose uses a rider spends: the one its consumption names (an id on the actor, or a compendium
   * reference to the feature it came from), else what it plainly draws on (Focus or ki for Stunning Strike,
   * superiority dice for maneuvers).
   */
  #usesItem(actor, item, ref, id) {
    const r = String(ref ?? "");
    if ( r ) {
      const found = actor.items.get(r) ?? actor.items.find(i => i.uuid === r || i._stats?.compendiumSource === r || i.flags?.core?.sourceId === r || (r.length > 16 && r.endsWith(i.id)));
      if ( found ) return found;
      const tail = r.split(".").pop();
      const byTail = actor.items.find(i => i._stats?.compendiumSource?.endsWith(tail));
      if ( byTail ) return byTail;
    } else if ( Number(item.system.uses?.max) ) return item;
    const ident = i => String(i.identifier ?? i.system?.identifier ?? "");
    if ( id === "stunning-strike" ) return actor.items.find(i => ["monks-focus", "ki", "focus-points", "ki-points"].includes(ident(i)) || /^(?:monk'?s focus|ki)\b/i.test(englishName(i))) ?? null;
    if ( ON_HIT.has(id) ) return actor.items.find(i => ["combat-superiority", "superiority-dice"].includes(ident(i)) || /superiority/i.test(englishName(i))) ?? null;
    return null;
  }

  /** A Battle Master's superiority die (d8, d10 at 10th level, d12 at 18th), from the character's scale values. */
  #superiorityDie(actor) {
    for ( const [cls, values] of Object.entries(actor.system.scale ?? {}) ) {
      if ( !/battle|master|fighter/.test(cls) ) continue;
      for ( const [k, v] of Object.entries(values ?? {}) ) if ( /superiority|die/.test(k) && Number(v?.faces) > 0 ) return Number(v.faces);
    }
    return 8;
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
   * What an activity does to whoever it lands on, and for how long: conditions from its effects' statuses (or failing
   * that from the words of a save: "... or be knocked prone"), bonuses and penalties from its effects' changes
   * (Bless, Bane, Shield of Faith), and with `words`, what the spell's description adds (Faerie Fire's advantage,
   * Haste's extra action, Hold Person's repeated save). Grappled becomes the engine's grab.
   */
  #effects(item, activity, { words = false } = {}) {
    const statuses = new Set();
    const names = [];
    const changes = [];
    const helpful = [];
    const refs = [];
    let rounds = 0;
    const finite = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
    const base = item.type === "spell" ? Number(item.system.level) || 0 : null;
    const data = item.getRollData?.() ?? item.actor?.getRollData?.() ?? {};
    for ( const ref of activity.effects ?? [] ) {
      // Upcast versions (Aid's +10, +15 ...) only count at their own slot levels.
      const lv = ref.level ?? {};
      if ( base !== null && ((Number.isFinite(lv.min) && base < lv.min) || (Number.isFinite(lv.max) && base > lv.max)) ) continue;
      const effect = ref.effect ?? item.effects?.get(ref._id ?? ref.id);
      if ( !effect ) continue;
      names.push(effect.name);
      refs.push(effect.id);
      for ( const status of effect.statuses ?? [] ) {
        if ( EFFECT_CONDITIONS[status] ) statuses.add(status);
        else if ( STATUS_MODS[status] ) helpful.push(STATUS_MODS[status]);
      }
      // (A Rage's "@scale.barbarian.rage-damage" is the character's own number.)
      for ( const c of effect.changes ?? [] ) {
        let value = c.value;
        try {
          if ( /@/.test(String(value)) ) value = Roll.replaceFormulaData(String(value), data, { missing: "0" });
        } catch ( err ) { /* left as it is */ }
        changes.push({ key: c.key, mode: c.mode, value });
      }
      const d = effect.duration ?? {};
      const byUnits = finite(d.value) ? ({ rounds: 1, turns: 1, seconds: 1 / 6, minutes: 10, hours: 600 }[d.units] ?? 0) * finite(d.value) : 0;
      rounds = finite(d.rounds) || Math.ceil(finite(d.seconds) / 6) || finite(d.turns) || Math.ceil(byUnits) || rounds;
    }
    if ( !statuses.size && !changes.length && activity.type === "save" ) {
      const text = plainText(englishDescription(item)).toLowerCase();
      const known = Object.keys(EFFECT_CONDITIONS).join("|");
      const m = new RegExp(`saving throw[^.]*?\\bor (?:be(?:come)? |be knocked |is knocked |have the |has the |fall |falls )?(${known})\\b`).exec(text)
        ?? new RegExp(`\\b(${known})\\b`).exec(String(activity.name ?? "").toLowerCase());
      if ( m ) {
        statuses.add(m[1]);
        const minutes = /for 1 minute|for one minute/.test(text) ? 10 : 0;
        rounds = minutes || (/until the end of (?:its|your|the \w+'s) next turn/.test(text) ? 1 : 0) || rounds;
      }
    }
    const { mods, tempHp, iwr } = modsFromChanges(changes);
    const said = words ? fromWords(plainText(englishDescription(item)), mods) : null;
    if ( !said?.endsOnAttack ) for ( const m of helpful ) for ( const [k, v] of Object.entries(m) ) mods[k] ??= v;
    if ( said ) Object.assign(mods, said.mods);
    const grab = statuses.delete("grappled");
    const conditions = {};
    for ( const s of statuses ) Object.assign(conditions, EFFECT_CONDITIONS[s]);
    if ( said ) Object.assign(conditions, said.conditions);
    const hasMods = Object.keys(mods).length > 0;
    if ( !Object.keys(conditions).length && !hasMods && !tempHp && !grab && !said?.mark && !iwr ) return null;
    const label = statuses.size || hasMods || tempHp || Object.keys(conditions).length ? effectLabel({ statuses: [...statuses], names, mods, tempHp, conditions }) : "grappled";
    return {
      conditions: Object.keys(conditions).length ? conditions : null, mods: hasMods ? mods : null, tempHp, grab, names, iwr, refs,
      // The effect's own duration first; the words only when it has none ("the next attack roll it makes").
      rounds: rounds || said?.rounds || durationRounds(item.system.duration) || 10, label, words: said
    };
  }

  /** The outcome an effect makes for the engine (null when it does nothing the engine plays out). */
  #outcome(fx, save = null) {
    if ( !fx || (!fx.conditions && !fx.mods && !fx.tempHp && !fx.iwr) ) return null;
    return {
      iwr: fx.iwr ?? undefined,
      conditions: fx.conditions ?? undefined, mods: fx.mods ?? undefined, tempHp: fx.tempHp || undefined, rounds: fx.rounds, label: fx.label,
      // Good for one roll (Guidance, Bardic Inspiration), against whoever it's set on (True Strike).
      uses: fx.words?.uses || undefined, vsFocus: fx.words?.vsFocus || undefined,
      repeatSave: fx.words?.repeatSave && save ? { type: save.type, dc: save.dc } : undefined,
      endsOnHarm: fx.words?.endsOnHarm || undefined
    };
  }

  /**
   * A spell or feature that works on whoever it touches without an attack or a save: a buff for friends (Bless, Shield
   * of Faith, Haste, Aid, Blur), a mark on a foe that adds to your hits (Hunter's Mark, Hex), or a curse.
   */
  #support(item, activity, base, { units, rangeFeet, targets, tempHp = 0 }) {
    const fx = this.#effects(item, activity, { words: item.type === "spell" || item.type === "feat" });
    const others = item.system.activities?.contents ?? [];
    // The mark's own damage: an activity with no activation of its own (the 2014 SRD calls it "special").
    const markAct = fx?.words?.mark ? others.find(a => a.type === "damage" && [undefined, "", "special"].includes(a.activation?.type)) : null;
    const mark = markAct ? this.#parts(markAct) : null;
    const temp = Math.max(tempHp, fx?.tempHp ?? 0);
    const outcome = this.#outcome(fx) ?? (temp ? { rounds: durationRounds(item.system.duration) ?? 10, label: t("Bolstered") } : null);
    // (Rage: its resistances count as much as its damage.)
    if ( outcome && fx?.iwr ) outcome.iwr = fx.iwr;
    if ( !outcome && !mark?.length ) return null;
    if ( temp ) outcome.tempHp = temp;
    const affects = String(activity.target?.affects?.type ?? item.system.target?.affects?.type ?? "").toLowerCase();
    const self = units === "self" || affects === "self" || !!fx?.words?.self;
    // Bardic Inspiration's die: the bard's own (d8 at 5th level, d10 at 10th, d12 at 15th).
    if ( fx?.words?.inspiration && outcome?.mods ) {
      const scale = item.actor?.system?.scale?.bard?.["bardic-inspiration"];
      const faces = Number(scale?.faces) || Number(/d(\d+)/.exec(String(scale?.die ?? scale?.formula ?? scale ?? ""))?.[1]) || 6;
      for ( const k of ["attackDie", "checkDie", "saveDie"] ) if ( outcome.mods[k] ) outcome.mods[k] = faces;
    }
    const reach = units === "touch" ? { reach: 5 } : rangeFeet && !self ? { range: { increment: rangeFeet, max: rangeFeet, noPenalty: true } } : {};
    // (The spell's own effects, to leave on a creature still under them when the fight ends.)
    if ( fx?.refs?.length ) base.effectRef = { uuid: item.uuid, ids: fx.refs };
    if ( mark?.length ) {
      return { ...base, kind: "control", auto: true, melee: false, ...reach, freeWhileHeld: true,
        outcome: { ...(outcome ?? {}), rounds: outcome?.rounds ?? durationRounds(item.system.duration) ?? 600, mark, label: /hex/i.test(englishName(item)) ? t("Hexed") : t("Marked") } };
    }
    const friendly = self || ["ally", "willing"].includes(affects) || (affects !== "enemy" && (helps(outcome.mods ?? {}, outcome.conditions ?? {}) || outcome.iwr || (temp > 0 && !outcome.mods && !outcome.conditions)));
    if ( !friendly ) return { ...base, kind: "control", auto: true, melee: false, ...reach, outcome };
    return { ...base, kind: "buff", outcome, targets: self ? "self" : undefined, area: !self && targets > 1 ? { targets } : undefined, ...reach };
  }

  /** The riders an attack carries: its conditions, a grab, and a save its target must make on a hit. */
  #riders(control) {
    if ( !control ) return [];
    const out = [];
    if ( control.grab ) out.push({ kind: "grabbed" });
    // (Guiding Bolt: the next attack at it, from anyone, has advantage.)
    if ( control.conditions || control.mods ) out.push({ kind: "condition", conditions: control.conditions ?? undefined, mods: control.mods ?? undefined, rounds: control.rounds, label: control.label, critOnly: false, uses: control.words?.uses || undefined });
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
    if ( max ) return { uses: Math.max(0, max - (s.uses?.spent ?? 0)), ...rechargeOf(s.uses) };
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
    if ( !damage.length && !control?.conditions && !control?.mods ) return null;
    return {
      riderFor: item.id,
      rider: { kind: "save", save, damage: damage.length ? damage : undefined, conditions: control?.conditions ?? undefined, mods: control?.mods ?? undefined, rounds: control?.rounds, label: control?.label ?? item.name }
    };
  }

  #fromActivity(actor, item, activity) {
    if ( activity.type === "save" && (item.system.activities?.contents ?? []).some(a => a.type === "attack") ) return this.#saveRider(actor, item, activity);
    const activation = activity.activation?.type ?? "action";
    if ( !["action", "bonus", "legendary"].includes(activation) ) return null;
    // A legendary action: taken between other creatures' turns, for what it costs from the pool.
    const legendary = activation === "legendary" ? legendaryCost(activity, item) : undefined;
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
    // Concentration: one such spell at a time, and a hard knock may end it.
    const concentration = !!(item.system.properties?.has?.("concentration") || item.system.duration?.concentration) || undefined;
    const base = {
      id: `${actor.id}.${item.id}.${activity.id}`, name: several && activity.name && activity.name !== item.name ? `${item.name}: ${activity.name}` : item.name,
      cost: 1, economy, itemId: item.id, traits: [], rank: item.type === "spell" ? item.system.level : undefined, concentration, ...this.#resource(actor, item),
      storyType: weaponLook(item),
      legendary,
      // (A feature's: a class's, a species', a creature's own. What "magic and specialties" means, with spells.)
      feature: item.type === "feat" || undefined
    };
    const reachOf = () => inFeet(range.reach, range.units) || 5;
    const casterLevel = actor.type === "character" ? (actor.system.details?.level ?? 1) : (actor.system.attributes?.spell?.level ?? actor.system.details?.spellLevel ?? 1);
    const projectiles = item.type === "spell" ? projectileCount(englishDescription(item), casterLevel) : 1;
    const targets = areaTargets(activity.target ?? item.system.target);

    if ( activity.type === "attack" ) {
      const damage = this.#parts(activity);
      if ( !damage.length ) return null;
      const melee = activity.attack?.type?.value !== "ranged";
      const bonus = numberOf(activity.labels?.modifier) ?? numberOf(activity.labels?.toHit) ?? 0;
      const riders = this.#riders(this.#effects(item, activity, { words: item.type === "spell" }));
      // (A ranged weapon that isn't thrown, a bow, a crossbow, a sling, sends a shot; a dart, a rock, a javelin flies itself.)
      const shoots = /R$/.test(String(item.system?.type?.value ?? "")) && !asArray(item.system?.properties).includes("thr");
      const attack = {
        ...base, kind: item.type === "spell" ? "spell-attack" : "strike", weapon: item.type === "weapon", bonus, melee, thrown: !melee && !shoots,
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
      const control = this.#effects(item, activity, { words: item.type === "spell" || item.type === "feat" });
      // (Charm Person: "with Advantage if you or your allies are fighting it", and this is a fight.)
      const save = { type, dc, basic: activity.damage?.onSave !== "none", ...(control?.words?.saveAdvantage ? { advantage: 1 } : {}) };
      const common = {
        ...base, melee: false, range: { increment: rangeFeet ?? 30, max: rangeFeet ?? 30, noPenalty: true },
        area: targets > 1 ? { targets } : undefined
      };
      const outcome = this.#outcome(control, save);
      if ( damage.length ) {
        const riders = outcome ? [{ kind: "condition", ...outcome, critOnly: false }] : [];
        return { ...common, kind: "save", damage, save, effects: riders.length ? riders : undefined };
      }
      // No damage: crowd control or a debuff on a failed save (Hold Person, Bane, Slow, Faerie Fire).
      if ( !outcome ) return null;
      if ( control?.refs?.length ) common.effectRef = { uuid: item.uuid, ids: control.refs };
      return { ...common, kind: "control", save: { ...save, basic: false }, onSave: [outcome, outcome, null, null] };
    }

    if ( activity.type === "damage" ) {
      // Magic Missile's darts all land: three darts deal three times a dart's damage.
      const damage = this.#parts(activity).map(p => projectiles > 1 ? { ...p, dice: p.dice.map(d => ({ ...d, n: d.n * projectiles })), flat: p.flat * projectiles } : p);
      return damage.length ? {
        ...base, kind: "auto", damage, melee: false, range: { increment: rangeFeet ?? 120, max: rangeFeet ?? 120, noPenalty: true },
        area: targets > 1 ? { targets } : undefined
      } : null;
    }

    // Utility spells and features (Bless, Shield of Faith), and enchantments of a weapon (Magic Weapon).
    if ( activity.type === "utility" || activity.type === "enchant" ) return this.#support(item, activity, base, { units, rangeFeet, targets });

    if ( activity.type === "heal" ) {
      const parts = this.#parts(activity, true);
      // Temporary hit points (False Life, Heroism) or a bigger maximum (Aid): a buff, not a heal.
      const temp = parts.length > 0 && parts.every(p => /^temp/i.test(p.type ?? ""));
      const raised = activity.effects?.length ? this.#effects(item, activity)?.tempHp ?? 0 : 0;
      if ( temp || raised || !parts.length ) return this.#support(item, activity, base, { units, rangeFeet, targets, tempHp: Math.max(raised, temp ? Math.round(meanOf(parts)) : 0) });
      const heal = parts.map(p => ({ ...p, type: "healing" }));
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
    if ( actor.type !== "character" || !hasFeature(features, "sneak-attack", "sneak attack") ) return;
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

  /**
   * What a character's system says for setting it up by itself (auto.js): its classes and species by identifier, its
   * kind of creature, its alignment (by the system's own names for them), a shield or heavy armor worn.
   */
  #facts(actor) {
    const sys = actor.system ?? {};
    const equipped = kind => actor.items.some(i => i.type === "equipment" && i.system.equipped && i.system.type?.value === kind);
    const creature = String(sys.details?.type?.value ?? "").toLowerCase();
    return {
      classes: Object.keys(actor.classes ?? {}),
      species: actor.items.find(i => i.type === "race")?.system?.identifier ?? null,
      creature,
      alignment: alignmentKey(sys.details?.alignment, alignmentNames()),
      shield: equipped("shield"),
      heavy: equipped("heavy"),
      mindless: isMindless(sys.abilities?.int?.value, creature)
    };
  }

  /** The playstyles D&D 5e says fit it (auto.js). */
  playstyleHints(actor) {
    return dnd5eHints(this.#facts(actor));
  }

  /**
   * Its own answers to the tactics questions, and what it offers and expects (auto.js dnd5eTactics), each with the
   * system's name for what decided it: its classes and subclasses, features, spells, attacks, potions, skills,
   * languages, alignment, kind of creature and money.
   */
  tacticHints(actor, spec = null, calc = null) {
    return dnd5eTactics(this.#tacticFacts(actor, spec, calc));
  }

  /** What dnd5eTactics reads (see there). */
  #tacticFacts(actor, spec, calc) {
    const sys = actor.system ?? {};
    const pc = actor.type === "character";
    const creature = String(sys.details?.type?.value ?? (pc ? "humanoid" : "")).toLowerCase();
    const id = item => String(item.identifier ?? item.system?.identifier ?? "");
    const activities = item => [...(item.system?.activities ?? [])];
    const healing = a => a.type === "heal" && asArray(a.healing?.types).includes("healing");
    // (Only itself: a heal on its own turn that reaches no one else, Second Wind.)
    const onlySelf = a => (a.target?.affects?.type ? a.target.affects.type === "self" : a.range?.units === "self");
    const feats = actor.items.filter(i => i.type === "feat");
    const background = actor.items.find(i => i.type === "background");
    const languages = sys.traits?.languages ?? {};
    const names = languageNames();
    const valuables = spec?.valuables ?? this.#valuables(actor);
    return {
      pc,
      level: pc ? (sys.details?.level ?? 1) : Math.max(0, Number(sys.details?.cr) || 0),
      classes: Object.values(actor.classes ?? {}).map(c => ({
        id: id(c), name: c.name, levels: Number(c.system?.levels) || 0,
        hd: String(c.system?.hd?.denomination ?? c.system?.hitDice ?? ""), progression: c.system?.spellcasting?.progression ?? "none",
        subclass: c.subclass ? { id: id(c.subclass), name: c.subclass.name, progression: c.subclass.system?.spellcasting?.progression ?? "none" } : null
      })),
      creature,
      subtype: String(sys.details?.type?.subtype ?? ""),
      alignment: alignmentKey(sys.details?.alignment, alignmentNames()),
      mindless: isMindless(sys.abilities?.int?.value, creature),
      int: Number(sys.abilities?.int?.value ?? 10),
      speaks: speaksAtAll(languages, names),
      summoned: !!actor.flags?.dnd5e?.summon?.origin,
      legendary: Number(sys.resources?.legact?.max) > 0,
      features: feats.map(i => ({ id: id(i), name: i.name, en: String(englishName(i)).toLowerCase() })),
      recharge: actor.items.filter(i => (i.system?.uses?.recovery ?? []).some(r => r.period === "recharge")).map(i => i.name),
      heals: this.#healsOthers(actor),
      selfHeals: feats.filter(i => activities(i).some(a => healing(a) && ["action", "bonus"].includes(a.activation?.type) && onlySelf(a))).map(i => i.name),
      spells: actor.items.filter(i => i.type === "spell" && this.#spellReady(actor, i)).map(i => ({ id: id(i), name: i.name })),
      potions: actor.items.filter(i => i.type === "consumable" && i.system.type?.value === "potion" && activities(i).some(healing))
        .reduce((n, i) => n + Math.max(0, Number(i.system.quantity ?? 1) || 0), 0),
      skills: Object.fromEntries(["per", "dec", "itm", "med"].map(k => [k, Number(sys.skills?.[k]?.proficient ?? sys.skills?.[k]?.value) || 0])),
      ci: asArray(sys.traits?.ci?.value),
      background: background ? { id: id(background), name: background.name } : null,
      money: Number(valuables?.money) || 0,
      coins: (valuables?.denominations ?? []).map(d => d.value),
      languages: spokenLanguages(languages, names),
      coreStyle: calc?.style ?? null,
      attacks: this.#attackFacts(actor, spec?.actions ?? [])
    };
  }

  /**
   * Its attacks as dnd5eTactics reads them, from its CombatantSpec's actions (those that take its action): each by its
   * item's identifier, a weapon's as a melee attack or a bow's or crossbow's shot (with Extra Attack, the attacks it
   * makes with it), a consumable's, and its Multiattack.
   */
  #attackFacts(actor, actions) {
    const offense = actions.filter(a => ["strike", "spell-attack", "save", "auto", "control"].includes(a.kind) && a.economy !== "bonus" && !a.legendary);
    const ids = new Set(offense.map(a => a.id));
    const out = [];
    for ( const a of offense ) {
      // (Its Attack action with Extra Attack stands for its single attack.)
      if ( ids.has(`${a.id}.extra`) ) continue;
      const multiattack = String(a.id).startsWith(`${actor.id}.multiattack`);
      const item = multiattack ? null : actor.items.get?.(a.itemId);
      const props = new Set(asArray(item?.system?.properties));
      const shot = /R$/.test(String(item?.system?.type?.value ?? ""));
      out.push({
        id: a.id, name: a.name, multiattack, item: String(item?.identifier ?? item?.system?.identifier ?? ""),
        weapon: !multiattack && a.kind === "strike" && a.weapon ? (a.melee ? "melee" : shot ? "ranged" : "") : "",
        twoHanded: props.has("two"),
        consumable: !multiattack && /^item:/.test(a.resource ?? "")
      });
    }
    return out;
  }

  /**
   * Its biography, as text: a character's appearance and its personality traits, ideals and flaws are said of it (in
   * full); its biography is its story (a backstory: its words may be about anyone in it); its bonds, being about others,
   * are left out. A creature's biography is its lore, said of it. (A lore page it embeds is read where Foundry has it at
   * hand and its players could read it themselves.)
   */
  biography(actor) {
    return biographyOf(actor.type, actor.system?.details, html => sheetText(plainText(embedded(html, actor), actor)));
  }

  deriveTraits(actor) {
    const sys = actor.system;
    const pc = actor.type === "character";
    const level = pc ? (sys.details?.level ?? 1) : Math.max(0, Number(sys.details?.cr) || 0);
    const save = sys.abilities?.wis?.save;
    // (Each feature once, by identifier, with the effects it puts on its owner: what they do says something of who has it.)
    const seen = new Set();
    const items = actor.items.filter(i => i.type === "feat").map(i => ({ id: String(i.identifier ?? i.system?.identifier ?? ""), name: i.name, effects: ownEffects(i) }))
      .filter(i => !seen.has(i.id || i.name) && seen.add(i.id || i.name));
    const background = actor.items.find(i => i.type === "background");
    const loyalty = sys.attributes?.loyalty?.value;
    return deriveDnd5eTraits({
      type: actor.type,
      creature: String(sys.details?.type?.value ?? "").toLowerCase(),
      subtype: String(sys.details?.type?.subtype ?? ""),
      int: sys.abilities?.int?.value ?? 10,
      wis: sys.abilities?.wis?.mod ?? 0,
      level,
      wisSave: typeof save === "number" ? save : (save?.value ?? sys.abilities?.wis?.mod ?? 0),
      // (One dnd5e summoned serves its summoner.)
      hasMaster: !!actor.flags?.dnd5e?.summon?.origin,
      features: featureKeys(actor),
      items,
      // Its own condition immunities, as its sheet has them (a feature's are in its effects).
      ci: asArray(actor._source?.system?.traits?.ci?.value ?? sys.traits?.ci?.value),
      alignment: alignmentKey(sys.details?.alignment, alignmentNames()),
      exhaustion: Number(sys.attributes?.exhaustion) || 0,
      heals: this.#healsOthers(actor),
      ...(pc ? {
        scores: Object.fromEntries(ABILITIES.map(k => [k, Number(sys.abilities?.[k]?.value) || 10])),
        classes: Object.values(actor.classes ?? {}).map(c => ({
          id: String(c.identifier ?? c.system?.identifier ?? ""), name: c.name, levels: Number(c.system?.levels) || 0,
          subclass: c.subclass ? { id: String(c.subclass.identifier ?? c.subclass.system?.identifier ?? ""), name: c.subclass.name } : null
        })),
        background: background ? { id: String(background.identifier ?? background.system?.identifier ?? ""), name: background.name } : null,
        skills: Object.fromEntries(Object.entries(sys.skills ?? {}).map(([k, s]) => [k, Number(s?.proficient ?? s?.value) || 0])),
        inParty: inParty(actor)
      } : { loyalty: Number.isFinite(loyalty) ? loyalty : null })
    });
  }

  /** The features and spells (ready to cast) it heals others with, by name: healing that reaches someone besides itself. */
  #healsOthers(actor) {
    const out = [];
    for ( const item of actor.items ) {
      if ( item.type !== "feat" && !(item.type === "spell" && this.#spellReady(actor, item)) ) continue;
      const others = a => {
        const affects = a.target?.affects?.type;
        return affects ? affects !== "self" : (a.range?.units ?? item.system.range?.units) !== "self";
      };
      const heals = [...(item.system.activities ?? [])].some(a => a.type === "heal" && asArray(a.healing?.types).includes("healing") && others(a));
      if ( heals && !out.includes(item.name) ) out.push(item.name);
    }
    return out;
  }

  #leadershipEntry(actor, id, level) {
    // One entry per feature: its identifier to match on, its name to show.
    // (Matched by identifier, else by its English name; shown by the name it goes by here.)
    const features = actor.items.filter(i => i.type === "feat").map(i => ({ key: String(i.identifier ?? i.system?.identifier ?? "") || englishName(i), name: i.name }));
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
   * The kinds of thing a character can ask for in a standoff: dnd5e's physical item types, the materials its item
   * properties name, and its rarities, in its own words.
   */
  itemCatalog() {
    const label = v => game.i18n.localize(typeof v === "string" ? v : v?.label ?? "");
    return {
      categories: [...PHYSICAL].filter(k => CONFIG.Item.typeLabels?.[k]).map(key => ({ key, label: label(CONFIG.Item.typeLabels[key]) })),
      materials: MATERIALS.filter(k => CONFIG.DND5E?.itemProperties?.[k]).map(key => ({ key, label: label(CONFIG.DND5E.itemProperties[key]) })),
      rarities: Object.entries(CONFIG.DND5E?.itemRarity ?? {}).map(([key, v]) => ({ key, label: label(v) }))
    };
  }

  /** dnd5e regions: its own difficult terrain (Spike Growth's, Plant Growth's, or one the GM draws). */
  describeRegionBehavior(behavior) {
    return behavior?.type === "dnd5e.difficultTerrain" ? { difficult: true } : null;
  }

  /** The dnd5e system's own words for armor class and hit points (in the client's language). */
  term(key) {
    const own = { ac: "DND5E.AC", hp: "DND5E.HP" }[key];
    return own && game.i18n.has(own) ? game.i18n.localize(own) : null;
  }

  /* -------------------------------------------- */

  resourceLabel(key, spec) {
    if ( spec?.resourceNames?.[key] ) return spec.resourceNames[key];
    if ( key === "fate" ) return this.#fateLabel();
    if ( key === "pact" ) return game.i18n.localize("FFDND5E.PactSlot");
    if ( key.startsWith("slots:") ) return game.i18n.format("FFDND5E.SpellSlot", { level: key.split(":")[1] });
    return null;
  }

  async commitOutcome(tokenDoc, spec, final, options) {
    return commitDnd5eOutcome(tokenDoc, spec, final, options);
  }

  get supportsLive() {
    return true;
  }

  /** A live battle: one turn's changes, and only those (commit.js commitDnd5eChanges). */
  async commitChanges(tokenDoc, spec, changes, final, options) {
    return commitDnd5eChanges(tokenDoc, spec, changes, final, options);
  }

  /** A player's turn in a live battle, read from the cards dnd5e made for it (read-turn.js). */
  readTurn(messages, context) {
    return readDnd5eTurn(messages, context);
  }

  /** Its reactions, for its player to say always / ask / never: its own, and the Opportunity Attack everyone has. */
  reactionsOf(spec) {
    return [...(spec?.reactions ?? []).map(r => ({ id: r.id, label: r.label ?? r.id })), { id: "opportunity", label: t("OpportunityAttack") }];
  }

  /** Heroic Inspiration (or, under the 2014 rules, Inspiration) buys a reroll. */
  rerollResource() {
    return this.#fateLabel();
  }

  describeOutcome(spec, final) {
    return describeDnd5eOutcome(spec, final);
  }

  async commitConcession(giverDoc, receiverDoc, concession) {
    return commitDnd5eConcession(giverDoc, receiverDoc, concession);
  }
}
