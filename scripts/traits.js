/**
 * D&D 5e personality defaults. Every number here is a starting point the GM can fudge.
 * Pure: takes plain values, so it's testable without Foundry.
 *
 * A player character starts as the usual hero (the core's PC_BASELINE) and everything on its sheet moves it a little,
 * each part shown in the trait's reason: its Intelligence and Wisdom and its level, its Wisdom save for its level and
 * its Constitution, its classes (and subclasses) and background, its alignment, its features (by what their effects
 * do: an immunity to being frightened, advantage on Wisdom saves; the rest by identifier, Brave, Aura of Courage,
 * Relentless Endurance ...), its condition immunities, healing others, its skills, exhaustion, and whether it's in
 * the party. A species speaks through its traits (a halfling's Brave, an orc's Relentless Endurance).
 * Anyone else is read from what it is: its Intelligence, Wisdom save and creature type, then moved by its alignment
 * (more than a hero's), its kind's loyalty, its condition immunities, its features, healing others and a loyalty score.
 */
import { clamp, listItems, listJoin, signedNumber, traitsFromParts, partsOf, PC_BASELINE } from "./core.js";
import { proficiency } from "./rules.js";
import { t, abilityName, alignmentName, conditionName, creatureTypeName, skillName } from "./words.js";

/** Too simple to reason with: barely-thinking undead, constructs, oozes and plants. Beasts are animals, not mindless. */
export function isMindless(int, creature) {
  return (int ?? 10) <= 3 && !["beast", "monstrosity", "dragon"].includes(creature);
}

/**
 * Does it fight as an animal (the core's spec.animalistic)? A beast that doesn't speak; else animal wits, very low to
 * middling (Intelligence 11 or less), with no language. Never a mindless one (isMindless: a zombie, a golem, an ooze).
 */
export function isAnimalistic(int, creature, speaks) {
  if ( speaks || isMindless(int, creature) ) return false;
  return creature === "beast" || (int ?? 10) <= 11;
}

/** What a class leans toward (the SRD's twelve, and the artificer), by identifier. Several classes count by their share of levels. */
const CLASS_LEANS = Object.freeze({
  barbarian: { brave: 5, tactical: -4 }, bard: { loyal: 2 }, cleric: { selfish: -4, loyal: 2 }, fighter: { brave: 2 },
  monk: { brave: 2, selfish: -2 }, paladin: { brave: 4, selfish: -6, loyal: 5 }, ranger: { tactical: 2 }, rogue: { selfish: 3 },
  warlock: { selfish: 2, loyal: -1 }, wizard: { tactical: 2 }, artificer: { tactical: 2 }
});

/** What a subclass leans toward, by identifier: the SRD's (2014's and 2024's identifiers), then a few from other books. */
const SUBCLASS_LEANS = Object.freeze({
  "path-of-the-berserker": { brave: 3, tactical: -3 }, berserker: { brave: 3, tactical: -3 }, champion: { brave: 2 },
  "oath-of-devotion": { loyal: 3, selfish: -2 }, devotion: { loyal: 3, selfish: -2 }, thief: { selfish: 3 },
  "life-domain": { selfish: -3 }, life: { selfish: -3 }, "college-of-lore": { tactical: 2 }, lore: { tactical: 2 },
  hunter: { tactical: 1 }, "the-fiend": { selfish: 3, loyal: -2 }, fiend: { selfish: 3, loyal: -2 },
  "battle-master": { tactical: 4 }, assassin: { selfish: 3, loyal: -2 }, vengeance: { brave: 2, selfish: 2 }, zealot: { brave: 3 },
  war: { brave: 2 }, mercy: { selfish: -3 }, trickery: { loyal: -2 }, glory: { brave: 2 }
});

/**
 * What a background leans toward, by identifier: the SRD's (acolyte, criminal, sage, soldier), the system's premade
 * heroes' own, and some from other books.
 */
const BACKGROUND_LEANS = Object.freeze({
  acolyte: { selfish: -4, loyal: 3 }, criminal: { selfish: 6, loyal: -4 }, sage: { tactical: 4 }, soldier: { brave: 3, loyal: 4 },
  priest: { selfish: -4, loyal: 3 }, scholar: { tactical: 4 }, burglar: { selfish: 6, loyal: -4 }, watchman: { loyal: 4, brave: 2 },
  recluse: { loyal: -4 }, "local-champion": { brave: 3, selfish: -3 }, "monster-hunter": { brave: 2, tactical: 2 }, vigilante: { brave: 3, loyal: -2 },
  charlatan: { selfish: 6, loyal: -5 }, guard: { loyal: 5, brave: 2 }, guide: { tactical: 2 }, hermit: { loyal: -4 }, merchant: { selfish: 4 },
  noble: { selfish: 3 }, scribe: { tactical: 2 }, wayfarer: { selfish: 3, loyal: -2 }, urchin: { selfish: 4, loyal: -2 }, "folk-hero": { brave: 3, selfish: -3 }
});

/** Skills that say something of who it is (proficient; more with expertise), by the system's key. */
const SKILL_LEANS = Object.freeze({
  slt: { selfish: 2 }, dec: { selfish: 1, loyal: -1 }, med: { selfish: -2 }, inv: { tactical: 2 }, his: { tactical: 1 }, ins: { tactical: 1 },
  prc: { tactical: 1 }, itm: { brave: 1 }, per: { loyal: 1 }
});

/**
 * Features that say something, by identifier, where their effects don't (most have none): a character's (2014's and
 * 2024's identifiers) and a creature's. What their effects say comes first (effectLeans); these fill in the rest.
 */
const ITEM_LEANS = Object.freeze({
  // Fear holds less: advantage on saves against being frightened, or none to make.
  brave: { brave: 6 }, "steel-will": { brave: 6 }, "aura-of-courage": { brave: 6 }, "mindless-rage": { brave: 6 }, "aura-of-devotion": { brave: 2 },
  "gnome-cunning": { brave: 3 }, indomitable: { brave: 2 },
  // Hard to put down.
  "relentless-endurance": { brave: 3 }, relentless: { brave: 3 }, "relentless-rage": { brave: 2 },
  // A watchful head.
  "danger-sense": { tactical: 2 }, "tactical-mind": { tactical: 2 }, "tactical-master": { tactical: 2 }, alert: { tactical: 1 },
  // A creature's: steadfast beside its allies, devoted, many-headed; reckless, frenzied, slipping away; fighting together.
  steadfast: { brave: 5, loyal: 3 }, "dark-devotion": { brave: 3, loyal: 4 }, "multiple-heads": { brave: 2 }, "two-headed": { brave: 2 }, "two-heads": { brave: 2 },
  aggressive: { brave: 4, tactical: -3 }, reckless: { brave: 3, tactical: -3 }, berserk: { tactical: -4, loyal: -3 }, rampage: { brave: 2 },
  "blood-frenzy": { brave: 3, tactical: -2 }, "bloodied-frenzy": { brave: 3, tactical: -2 }, "bloodied-fury": { brave: 3, tactical: -2 },
  "nimble-escape": { brave: -2 }, "martial-advantage": { tactical: 3, loyal: 2 }, "pack-tactics": { loyal: 3 }
});

/** What each side of an alignment does to a creature (a player character's half as much: it's more than its alignment). */
const ALIGNMENT_LEANS = Object.freeze({ g: { selfish: -10 }, e: { selfish: 12 }, l: { loyal: 8 }, c: { loyal: -8 } });

/** A creature's kind, and its loyalty: a devil's hierarchy, a demon's chaos, a celestial's devotion. The strongest one counts. */
const LOYAL_BY_KIND = Object.freeze({ devil: 12, demon: -15, yugoloth: -10, celestial: 8, fey: -6, dragon: -8, aberration: -6 });

/**
 * What an item's effects say of who has it (its changes, the dnd5e way): immune to being frightened (a fearless one) or
 * charmed, advantage (or disadvantage) on Wisdom saves. An effect that's off until something turns it on (Mindless
 * Rage's, while raging) counts half.
 * @param {{changes: {key: string, value: *}[], disabled?: boolean}[]} effects   the item's effects that act on its owner
 * @returns {{brave?: number}}
 */
export function effectLeans(effects = []) {
  const out = {};
  const add = (k, n) => { out[k] = (out[k] ?? 0) + n; };
  for ( const e of effects ?? [] ) {
    const w = e?.disabled ? 0.5 : 1;
    for ( const c of e?.changes ?? [] ) {
      const value = String(c?.value ?? "").trim().toLowerCase();
      if ( c?.key === "system.traits.ci.value" ) {
        if ( value === "frightened" ) add("brave", 10 * w);
        else if ( value === "charmed" ) add("brave", 2 * w);
      } else if ( c?.key === "system.abilities.wis.save.roll.mode" && Number(value) ) add("brave", 3 * Math.sign(Number(value)) * w);
    }
  }
  for ( const k of Object.keys(out) ) out[k] = clamp(out[k], -10, 10);
  return out;
}

/** Does one of its items always make it immune to being frightened (an effect that's on)? */
const fearlessByItem = items => (items ?? []).some(i => (i.effects ?? []).some(e => !e?.disabled && (e.changes ?? []).some(c => c?.key === "system.traits.ci.value" && String(c.value).trim().toLowerCase() === "frightened")));

/** The usual player character's Wisdom save at a level: Wisdom +1, and proficient about half the time. */
const usualWisSave = level => 1 + Math.floor(proficiency(level) / 2);

/** An ability score's modifier. */
const modOf = score => Math.floor(((Number(score) || 10) - 10) / 2);

/** An item's leaning: what its effects say, then (for what they don't) what its identifier says. */
function itemLean(item) {
  const lean = effectLeans(item.effects);
  for ( const [k, n] of Object.entries(ITEM_LEANS[item.id] ?? {}) ) if ( lean[k] === undefined ) lean[k] = n;
  return lean;
}

/** The parts everyone has: its alignment, its condition immunities, its features, healing others, exhaustion. */
function sharedParts(d, { pc }) {
  const parts = [];
  const mindless = !pc && isMindless(d.int, d.creature);
  // (Fear can't touch it: a fearless one. Nor can a charm.)
  const ci = new Set(d.ci ?? []);
  if ( ci.has("frightened") ) parts.push({ trait: "brave", n: 10, why: t("Reason.Immune", { condition: conditionName("frightened") }) });
  if ( ci.has("charmed") ) parts.push({ trait: "brave", n: 2, why: t("Reason.Immune", { condition: conditionName("charmed") }) });
  // Worn out: less heart for a fight.
  const exhaustion = Math.max(0, Number(d.exhaustion) || 0);
  if ( exhaustion ) parts.push({ trait: "brave", n: -Math.min(8, 2 * exhaustion), why: t("Reason.Exhaustion", { name: conditionName("exhaustion"), n: exhaustion }) });
  // (What it is has nothing more to say of the mindless.)
  if ( mindless ) return parts;
  const alignment = String(d.alignment ?? "");
  if ( alignment.length === 2 ) {
    const why = alignmentName(alignment);
    for ( const side of new Set(alignment) ) parts.push(...partsOf(ALIGNMENT_LEANS[side], why, pc ? 0.5 : 1));
  }
  for ( const item of d.items ?? [] ) parts.push(...partsOf(itemLean(item), item.name ?? item.id));
  // Healing others: one who looks after the rest.
  const heals = (d.heals ?? []).filter(Boolean);
  if ( heals.length ) parts.push({ trait: "selfish", n: -Math.min(4, 1 + heals.length), why: listJoin(heals.slice(0, 3)) });
  return parts;
}

/**
 * A player character's parts: everything on its sheet that moves it from the usual hero.
 * @param {object} d   see deriveDnd5eTraits
 */
export function pcParts(d) {
  const level = Math.max(1, Number(d.level) || 1);
  const score = k => Number(d.scores?.[k]) || (k === "int" ? Number(d.int) || 10 : 10);
  const ability = k => t("Reason.Ability", { name: abilityName(k), n: score(k) });
  const parts = [];
  const add = (trait, n, why) => parts.push({ trait, n, why });

  // A good head: Intelligence above all, Wisdom (awareness) too; and experience. (The usual hero: 12 and 12, level 5.)
  add("tactical", (modOf(score("int")) - 1) * 3, ability("int"));
  add("tactical", (modOf(score("wis")) - 1) * 2, ability("wis"));
  add("tactical", (level - 5) * 0.5, t("Reason.Level", { n: level }));

  // Nerve: its Wisdom save against the usual hero's at its level, and its toughness (the usual hero's Constitution: 14).
  if ( Number.isFinite(Number(d.wisSave)) ) {
    const delta = Number(d.wisSave) - usualWisSave(level);
    add("brave", clamp(delta * 2, -10, 10), t("Reason.SaveVsLevel", { name: abilityName("wis"), n: signedNumber(delta) }));
  }
  add("brave", (modOf(score("con")) - 2) * 1.5, ability("con"));

  // Who it is: its classes (by their share of its levels) and subclasses, its background.
  const classes = (d.classes ?? []).filter(c => c?.id);
  const total = classes.reduce((sum, c) => sum + (Number(c.levels) || 0), 0);
  for ( const c of classes ) {
    const share = total > 0 ? (Number(c.levels) || 0) / total : 1 / classes.length;
    parts.push(...partsOf(CLASS_LEANS[c.id], c.name ?? c.id, share));
    if ( c.subclass?.id ) parts.push(...partsOf(SUBCLASS_LEANS[c.subclass.id], c.subclass.name ?? c.subclass.id, share));
  }
  if ( d.background?.id ) parts.push(...partsOf(BACKGROUND_LEANS[d.background.id], d.background.name ?? d.background.id));

  // What it's learned to do: its skills (proficient; expertise counts more).
  for ( const [key, rank] of Object.entries(d.skills ?? {}) ) {
    if ( !(Number(rank) >= 1) || !SKILL_LEANS[key] ) continue;
    parts.push(...partsOf(SKILL_LEANS[key], skillName(key), Number(rank) >= 2 ? 1.5 : 1));
  }

  // Its outlook, its features, what it can't be made to feel ...
  parts.push(...sharedParts(d, { pc: true }));

  // Its friends: one who isn't in the party is less bound to the others.
  if ( d.inParty === false ) add("loyal", -10, t("Reason.NoParty"));
  return parts;
}

/**
 * D&D 5e personality defaults from an actor's data.
 *
 * @param {object} d
 * @param {string} d.type        "character" | "npc"
 * @param {string} d.creature    Creature type: humanoid, beast, undead, construct, fiend ...
 * @param {string} [d.subtype]   its subtype as written (Devil, Demon, Goblinoid ...)
 * @param {number} d.int         Intelligence score
 * @param {number} d.wis         Wisdom modifier
 * @param {number} d.level       Level or challenge rating
 * @param {number} d.wisSave     Wisdom save bonus
 * @param {boolean} d.hasMaster  A familiar, steed, companion or summoned creature
 * @param {string[]} d.features  Feature identifiers and names (lower case)
 * @param {{id: string, name: string, effects: object[]}[]} [d.items]  its features (and species, background, class),
 *        by identifier, with the effects they put on it ({changes, disabled})
 * @param {string[]} [d.ci]      its own condition immunities (the sheet's)
 * @param {string} [d.alignment] lg, ng, cg, ln, tn, cn, le, ne, ce
 * @param {number} [d.exhaustion]
 * @param {string[]} [d.heals]   the features and spells it heals others with, by name
 * @param {number} [d.loyalty]   a creature's loyalty score (0-20), where the world keeps one
 * A player character's own:
 * @param {Record<string, number>} [d.scores]   ability scores
 * @param {{id, name, levels, subclass: {id, name}}[]} [d.classes]
 * @param {{id, name}} [d.background]
 * @param {Record<string, number>} [d.skills]   skill key: proficiency (0, 0.5, 1, 2)
 * @param {boolean} [d.inParty]   in the party (undefined: no party to be in)
 * @returns {{traits, flags, reasons}}
 */
export function deriveDnd5eTraits(d) {
  const reasons = {};
  const flags = {};
  const features = d.features ?? [];
  // By identifier first (the same in every book and language), then by name.
  const has = (id, name) => features.includes(id) || features.some(f => f.includes(name));
  if ( has("pack-tactics", "pack tactics") ) flags.packTactics = true;
  if ( has("sneak-attack", "sneak attack") ) flags.sneakAttack = true;
  // Disengage as a bonus action.
  if ( has("cunning-action", "cunning action") || has("nimble-escape", "nimble escape") ) flags.nimble = true;
  // Nothing can frighten it: its own immunity, or a feature's that's always on.
  if ( (d.ci ?? []).includes("frightened") || fearlessByItem(d.items) ) flags.fearless = true;

  if ( d.type === "character" ) {
    const built = traitsFromParts(PC_BASELINE, pcParts(d), { from: t("Reason.Pc") });
    return { traits: built.traits, flags, reasons: built.reasons };
  }

  const intMod = modOf(d.int ?? 10);
  const mindless = isMindless(d.int, d.creature);
  let tactical = clamp(35 + intMod * 8 + (d.wis ?? 0) * 2, 5, 95);
  reasons.tactical = t("Reason.Ability", { name: abilityName("int"), n: d.int ?? 10 });
  if ( d.creature === "beast" ) {
    tactical = clamp(15 + (d.wis ?? 0) * 3, 5, 35);
    reasons.tactical = t("Reason.Beast");
  }
  if ( mindless ) {
    tactical = Math.min(tactical, 10);
    reasons.tactical = t("Reason.BarelyThinks");
  }
  if ( flags.packTactics ) {
    tactical = Math.max(tactical, 25);
    reasons.tactical = listItems([reasons.tactical, t("Reason.Pack")]);
  }

  const typicalSave = 3 + Math.floor((d.level ?? 0) / 4);
  const saveDelta = (d.wisSave ?? 0) - typicalSave;
  let brave = clamp(50 + saveDelta * 5, 10, 90);
  reasons.brave = t("Reason.SaveVsLevel", { name: abilityName("wis"), n: signedNumber(saveDelta) });
  if ( ["undead", "construct"].includes(d.creature) && mindless ) {
    brave = 100;
    flags.fearless = true;
    reasons.brave = t("Reason.NeverFlees");
  } else if ( d.creature === "construct" ) {
    brave = 95;
    reasons.brave = t("Reason.Construct");
  } else if ( d.creature === "beast" ) {
    brave = Math.min(brave, 45);
    reasons.brave = t("Reason.BeastFlees");
  }
  if ( mindless ) flags.mindless = true;

  let selfish = 50;
  reasons.selfish = t("Reason.Typical");
  if ( d.creature === "fiend" ) { selfish = 75; reasons.selfish = t("Reason.Fiend"); }
  else if ( d.creature === "celestial" ) { selfish = 20; reasons.selfish = t("Reason.Celestial"); }
  else if ( d.creature === "beast" ) { selfish = 55; reasons.selfish = t("Reason.Beast"); }

  let loyal = 50;
  reasons.loyal = t("Reason.Typical");
  const bound = d.hasMaster || (["construct", "undead"].includes(d.creature) && mindless);
  if ( d.hasMaster ) { loyal = 85; reasons.loyal = t("Reason.Master"); }
  else if ( ["construct", "undead"].includes(d.creature) && mindless ) { loyal = 90; reasons.loyal = t("Reason.BoundToObey"); }

  // What moves it from there: its alignment, its kind's loyalty (the strongest), what it's immune to, its features, a
  // loyalty score.
  const parts = sharedParts(d, { pc: false });
  if ( !bound && !mindless ) {
    // (Its type by the system's name for it; a subtype as its sheet writes it.)
    const subtype = String(d.subtype ?? "").split(/[^\p{L}-]+/u).filter(Boolean);
    const kinds = Object.keys(LOYAL_BY_KIND).map(k => [k, k === d.creature ? creatureTypeName(k) : subtype.find(w => w.toLowerCase() === k)]).filter(([, why]) => why);
    const [kin, why] = kinds.sort(([a], [b]) => Math.abs(LOYAL_BY_KIND[b]) - Math.abs(LOYAL_BY_KIND[a]))[0] ?? [];
    if ( kin ) parts.push({ trait: "loyal", n: LOYAL_BY_KIND[kin], why });
  }
  if ( Number.isFinite(d.loyalty) && !mindless ) parts.push({ trait: "loyal", n: clamp((d.loyalty - 10) * 1.2, -12, 12), why: t("Reason.Loyalty", { n: d.loyalty }) });
  // (Each trait's reason for where it starts, then the parts that moved it.)
  const built = traitsFromParts({ tactical, brave, selfish, loyal }, parts, { lead: reasons, min: 0, max: 100 });
  return { traits: built.traits, flags, reasons: built.reasons };
}
