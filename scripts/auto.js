/**
 * What D&D 5e says about a character, for the one time FastFighting sets it up by itself (the core's
 * foundry/auto-config.js): the playstyles that fit it and its own answers to the tactics questions ("Let this character
 * decide": dnd5eTactics, from its classes and subclasses, features, spells, attacks, gear, skills, languages, alignment
 * and kind of creature); and its biography as plain text for the keywords (biographyOf: what's said of it, and its story). Pure:
 * plain values in (the system's names for things through words.js).
 */
import { listJoin, plainText } from "./core.js";
import { t, abilityName, alignmentName, creatureTypeName, conditionName, skillName, languageName, legendaryActionsName } from "./words.js";
import { currentReading, wordPattern } from "./reading.js";

/** What each class leans toward (several classes add up). */
const CLASSES = Object.freeze({
  barbarian: { brawler: 0.5, impatient: 0.3 },
  bard: { peoplePleaser: 0.3, diplomat: 0.3, enabler: 0.2 },
  cleric: { enabler: 0.5, moralist: 0.2 },
  druid: { unmundane: 0.3, loreCollector: 0.2, enabler: 0.1 },
  fighter: { brawler: 0.3, tank: 0.2 },
  monk: { dps: 0.3, kiter: 0.2 },
  paladin: { tank: 0.4, martyr: 0.3, moralist: 0.2 },
  ranger: { wallflower: 0.4, relentless: 0.2 },
  rogue: { thief: 0.5, wallflower: 0.2 },
  sorcerer: { unmundane: 0.6 },
  warlock: { unmundane: 0.5, instigator: 0.1 },
  wizard: { unmundane: 0.4, loreCollector: 0.4 },
  artificer: { puzzleManiac: 0.5 }
});

/** Species, only where an SRD trait leans somewhere (an orc's Relentless Endurance, a gnome's cunning). */
const SPECIES = Object.freeze({
  orc: { relentless: 0.2 },
  "half-orc": { relentless: 0.2 },
  dwarf: { tank: 0.15 },
  gnome: { puzzleManiac: 0.2 },
  tiefling: { unmundane: 0.1 }
});

/** What each kind of creature leans toward. */
const CREATURES = Object.freeze({
  beast: { brawler: 0.3 },
  undead: { relentless: 0.3 },
  fiend: { cruel: 0.4 },
  celestial: { moralist: 0.3, martyr: 0.2 },
  construct: { relentless: 0.5 },
  fey: { wildcard: 0.4 },
  aberration: { instigator: 0.2, wildcard: 0.2 },
  ooze: { relentless: 0.4, brawler: 0.2 },
  plant: { relentless: 0.3 },
  dragon: { leader: 0.2, cruel: 0.1 },
  giant: { brawler: 0.3 },
  monstrosity: { brawler: 0.2 },
  elemental: { relentless: 0.2, impatient: 0.1 }
});

/** What an alignment leans toward (lg, ng, cg, ln, n, cn, le, ne, ce). */
const ALIGNMENTS = Object.freeze({
  lg: { moralist: 0.3 }, ng: { moralist: 0.2, enabler: 0.1 }, cg: { moralist: 0.1, wildcard: 0.1 },
  ln: { skeptic: 0.2 }, cn: { wildcard: 0.3 },
  le: { cruel: 0.2 }, ne: { mercenary: 0.3, cruel: 0.1 }, ce: { cruel: 0.4, wildcard: 0.1 }
});

/**
 * Features, by identifier (the SRD's, and a few other books' by identifier only), and the playstyles they lean toward:
 * healing others (a Medic), slipping away (a Kiter), dealing the most damage (DPS), lifting friends (an Enabler).
 */
const FEATURES = Object.freeze({
  "lay-on-hands": { medic: 0.3 }, healer: { medic: 0.4 }, "disciple-of-life": { medic: 0.3 }, "preserve-life": { medic: 0.3 },
  "channel-divinity-preserve-life": { medic: 0.3 }, "healing-hands": { medic: 0.2 }, "blessed-healer": { medic: 0.2 },
  "cunning-action": { kiter: 0.3 }, mobile: { kiter: 0.4 }, "nimble-escape": { kiter: 0.3 }, "unarmored-movement": { kiter: 0.2 },
  "step-of-the-wind": { kiter: 0.2 },
  "sneak-attack": { dps: 0.3 }, "great-weapon-master": { dps: 0.4 }, sharpshooter: { dps: 0.4 }, "divine-smite": { dps: 0.2 },
  "paladins-smite": { dps: 0.2 }, "brutal-strike": { dps: 0.2 }, "brutal-critical": { dps: 0.1 }, "agonizing-blast": { dps: 0.2 },
  "improved-critical": { dps: 0.2 }, "savage-attacker": { dps: 0.2 },
  "bardic-inspiration": { enabler: 0.3 }, "flash-of-genius": { enabler: 0.3 }
});

/**
 * Spells, by identifier, a little each: healing (a Medic), a mark for more damage (DPS), a friend's buff (an Enabler),
 * a way out (a Kiter).
 */
const SPELLS = Object.freeze({
  "cure-wounds": { medic: 0.15 }, "healing-word": { medic: 0.2 }, "mass-healing-word": { medic: 0.2 }, "prayer-of-healing": { medic: 0.15 },
  "mass-cure-wounds": { medic: 0.15 }, heal: { medic: 0.15 }, revivify: { medic: 0.1 }, "spare-the-dying": { medic: 0.1 }, aid: { medic: 0.1, enabler: 0.1 },
  hex: { dps: 0.2 }, "hunters-mark": { dps: 0.2 },
  bless: { enabler: 0.2 }, haste: { enabler: 0.2 }, heroism: { enabler: 0.15 }, "faerie-fire": { enabler: 0.15 }, guidance: { enabler: 0.1 },
  "enhance-ability": { enabler: 0.1 }, "shield-of-faith": { enabler: 0.1 },
  "expeditious-retreat": { kiter: 0.2 }, "misty-step": { kiter: 0.1 }, longstrider: { kiter: 0.1 }
});

/** The playstyles that fit: {id: -1 to 1}. `features` and `spells`: their identifiers (spells it has ready). */
export function dnd5eHints({ classes = [], species = null, creature = "", alignment = null, shield = false, heavy = false, features = [], spells = [] } = {}) {
  const out = {};
  const add = map => { for ( const [k, v] of Object.entries(map ?? {}) ) out[k] = (out[k] ?? 0) + v; };
  for ( const c of classes ) add(CLASSES[c]);
  for ( const f of new Set(features) ) if ( Object.hasOwn(FEATURES, f) ) add(FEATURES[f]);
  for ( const s of new Set(spells) ) if ( Object.hasOwn(SPELLS, s) ) add(SPELLS[s]);
  add(SPECIES[species]);
  add(CREATURES[creature]);
  add(ALIGNMENTS[alignment]);
  if ( shield ) add({ tank: 0.2 });
  if ( heavy ) add({ tank: 0.2 });
  for ( const k of Object.keys(out) ) out[k] = Math.max(-1, Math.min(1, out[k]));
  return out;
}

/** A class's way of fighting: its main class's (the one with the most levels). */
const CLASS_STYLE = Object.freeze({
  paladin: "protector", barbarian: "frontline", fighter: "frontline", monk: "skirmisher", rogue: "skirmisher", ranger: "ranged",
  wizard: "caster", sorcerer: "caster", warlock: "caster", druid: "caster", cleric: "caster", bard: "caster", artificer: "caster"
});

/** How strongly a class reaches for magic, by its spellcasting progression (dnd5e's: full, pact, half, third, artificer). */
const PROGRESSION_SPECIALTY = Object.freeze({ full: "strong", pact: "strong", half: "some", artificer: "some", third: "some" });

/*
 * Features by identifier (the 2014 and 2024 SRD's, and a few from other books: identifiers only), and what they say.
 */
/** A reaction that guards a friend: the Protection and Interception fighting styles; a shield guardian's guarding. */
const GUARDS = ["protection", "interception", "shield"];
/** Melee fighting styles (a ranger who takes one fights up close). */
const MELEE_STYLES = ["dueling", "great-weapon-fighting", "two-weapon-fighting"];
/** Short-rest resources a class spends in every fight: Action Surge, ki or focus, superiority dice. */
const EVERY_FIGHT = ["action-surge", "monks-focus", "ki", "combat-superiority", "superiority-dice"];
/** Finishing off the hurt: Rampage, Blood Frenzy, Colossus Slayer. */
const FINISHERS = ["rampage", "blood-frenzy", "colossus-slayer"];
/** Fighting to the end: a cultist's Dark Devotion, a golem's Berserk, a berserker's recklessness, a boar's Bloodied Fury. */
const FANATICS = ["dark-devotion", "berserk", "reckless", "bloodied-frenzy", "bloodied-fury"];
/** Back on its feet: Regeneration, Undead Fortitude, Relentless Endurance, Relentless Rage, Rejuvenation, Relentless. */
const ENDURING = ["regeneration", "undead-fortitude", "relentless-endurance", "relentless-rage", "rejuvenation", "relentless"];
/** Hunting down whoever's near: pack hunters, the Aggressive, Rampage, Blood Frenzy. */
const HUNTERS = ["pack-tactics", "aggressive", "rampage", "blood-frenzy"];
/** Commanders, who'd call their troops: Leadership, Aura of Authority. */
const COMMANDERS = ["leadership", "aura-of-authority"];
/** A Life Domain cleric's own (its subclass's identifiers, then its features'). */
const LIFE = ["life-domain", "life"];
const LIFE_FEATURES = ["disciple-of-life", "preserve-life", "channel-divinity-preserve-life"];
/** Backgrounds with money to buy their way out. */
const MONEYED = ["merchant", "noble", "guild-artisan"];
/** Kinds of creature that live among others and trade (2024's goblinoids are fey). */
const PEOPLE = ["humanoid", "fey", "giant"];
/**
 * Fighting styles made for one kind of weapon, and its attacks that fit: Archery a bow's or crossbow's shot, Great Weapon
 * Fighting a two-handed weapon, Dueling a one-handed one.
 */
const STYLE_WEAPONS = Object.freeze([
  ["archery", a => a.weapon === "ranged"],
  ["great-weapon-fighting", a => a.weapon === "melee" && a.twoHanded],
  ["dueling", a => a.weapon === "melee" && !a.twoHanded]
]);
/** Features built on using magic items: a thief's (2014 and 2024). */
const ITEM_USERS = ["fast-hands", "use-magic-device"];

/**
 * D&D 5e's own answers to the tactics questions, and what it offers and expects to end an argument: {key: {value, why}},
 * only where its data says something (the core's reading of its hidden scores stands for the rest). `why` is the
 * system's own name for what decided it (a class, feature, spell, skill, alignment, kind of creature).
 *
 * @param {object} f
 * @param {boolean} [f.pc]          a player character
 * @param {number} [f.level]        its level, or challenge rating
 * @param {{id, name, levels, hd, progression, subclass: {id, name, progression}|null}[]} [f.classes]
 * @param {string} [f.creature]     its creature type (beast, construct, fiend ...)
 * @param {string} [f.subtype]      its subtype, as written (Devil, Goblinoid ...)
 * @param {string|null} [f.alignment]  lg ... ce
 * @param {boolean} [f.mindless]    barely thinks
 * @param {number} [f.int]          its Intelligence score
 * @param {boolean} [f.speaks]      has a language it speaks (or telepathy)
 * @param {boolean} [f.summoned]    called by someone it serves
 * @param {boolean} [f.legendary]   has legendary actions
 * @param {{id, name, en}[]} [f.features]   its features: identifier, name, English name (lower case)
 * @param {string[]} [f.recharge]   its abilities that recharge, by name
 * @param {string[]} [f.heals]      what it heals others with, by name
 * @param {string[]} [f.selfHeals]  what it heals only itself with, on its turn, by name (Second Wind)
 * @param {{id, name}[]} [f.spells] its spells ready
 * @param {number} [f.potions]      healing potions carried
 * @param {Record<string, number>} [f.skills]  proficiency in per, dec, itm, med (1 proficient, 2 expertise)
 * @param {string[]} [f.ci]         its condition immunities
 * @param {{id, name}|null} [f.background]
 * @param {number} [f.money]        in copper
 * @param {number[]} [f.coins]      its coins' values, in copper
 * @param {string[]} [f.languages]  its languages, by key
 * @param {string|null} [f.coreStyle]  the core's answer for style (what its best attack is)
 * @param {{id, name, item, multiattack, weapon, twoHanded, consumable}[]} [f.attacks]  the attacks it makes with its
 *   action (adapter.js): its action's id and name, its item's identifier, whether it's its Multiattack, a weapon's
 *   ("melee" or "ranged": a bow's or crossbow's shot), a two-handed one, and whether it spends a consumable
 * @returns {Record<string, {value: *, why: string}>}
 */
export function dnd5eTactics(f = {}) {
  const pc = !!f.pc;
  const classes = (f.classes ?? []).map(c => (typeof c === "string" ? { id: c, name: c } : c)).filter(c => c?.id);
  const main = [...classes].sort((a, b) => (Number(b.levels) || 0) - (Number(a.levels) || 0))[0] ?? null;
  const ofClass = id => classes.find(c => c.id === id) ?? null;
  const features = (f.features ?? []).filter(x => x?.id || x?.en);
  // (By identifier; else by its English name, the identifier's words.)
  const feature = ids => features.find(x => ids.includes(x.id) || ids.some(id => x.en === id.replace(/-/g, " "))) ?? null;
  const creature = String(f.creature ?? "");
  const kind = creature ? creatureTypeName(creature) : "";
  const align = String(f.alignment ?? "");
  const good = align.length === 2 && align.endsWith("g");
  const evil = align.length === 2 && align.endsWith("e");
  const alignName = align ? alignmentName(align) : "";
  const heals = (f.heals ?? []).filter(Boolean);
  const healNames = listJoin(heals.slice(0, 3));
  const skills = f.skills ?? {};
  // (A subtype word as its sheet writes it: "Devil".)
  const subtype = word => String(f.subtype ?? "").split(/[^\p{L}-]+/u).find(w => w.toLowerCase() === word) ?? null;

  const out = {};
  // The first to speak to a question has its say (with something to say, and a reason).
  const say = (key, value, why) => { if ( !(key in out) && value !== undefined && why ) out[key] = { value, why: String(why) }; };

  // What it is, before anything it can do: one serving a master, one that barely thinks, a construct, one with no words.
  const master = f.summoned ? t("Reason.Master") : null;
  const blank = f.mindless ? t("Reason.BarelyThinks") : null;
  const construct = creature === "construct" ? kind : null;
  const wordless = f.speaks === false ? t("Reason.NoLanguage") : null;
  const beast = creature === "beast";

  // The features that say most.
  const guard = feature(GUARDS);
  const nimble = feature(["nimble-escape"]);
  const casting = pc ? null : feature(["spellcasting", "innate-spellcasting"]);
  const paladin = ofClass("paladin");
  const cleric = ofClass("cleric");
  const life = classes.find(c => LIFE.includes(c.subclass?.id))?.subclass ?? feature(LIFE_FEATURES);
  const devil = subtype("devil");
  const attacks = (f.attacks ?? []).filter(a => a?.id);

  // Its signature attack: a creature's Multiattack (when it makes it one way), a warlock's Eldritch Blast with Agonizing
  // Blast, the one weapon its fighting style is made for.
  const multiattack = attacks.filter(a => a.multiattack);
  if ( multiattack.length === 1 ) say("preferredAction", multiattack[0].id, multiattack[0].name);
  const agonizing = feature(["agonizing-blast"]);
  const blast = agonizing ? attacks.find(a => a.item === "eldritch-blast") : null;
  if ( blast ) say("preferredAction", blast.id, agonizing.name);
  for ( const [id, fits] of STYLE_WEAPONS ) {
    const style = feature([id]);
    const fit = style ? attacks.filter(fits) : [];
    if ( fit.length === 1 ) say("preferredAction", fit[0].id, style.name);
  }

  // Its way of fighting: a guardian's reaction, its fighting style, slipping away, its spells, its main class.
  if ( guard ) say("style", "protector", guard.name);
  const archery = feature(["archery"]);
  if ( archery ) say("style", "ranged", archery.name);
  const melee = main?.id === "ranger" ? feature(MELEE_STYLES) : null;
  if ( melee ) say("style", "frontline", melee.name);
  if ( nimble ) say("style", "skirmisher", nimble.name);
  if ( casting && f.coreStyle === "caster" ) say("style", "caster", casting.name);
  const blade = main?.id === "warlock" ? feature(["pact-of-the-blade"]) : null;
  if ( blade ) say("style", "frontline", blade.name);
  // (A cleric or druid trained for armor and arms: Divine Order: Protector, Primal Order: Warden.)
  const armored = main?.id === "cleric" ? feature(["divine-order-protector"]) : main?.id === "druid" ? feature(["primal-order-warden"]) : null;
  if ( armored ) say("style", "frontline", armored.name);
  if ( CLASS_STYLE[main?.id] ) say("style", CLASS_STYLE[main.id], main.name);
  const aggressive = feature(["aggressive"]);
  if ( aggressive ) say("style", "frontline", aggressive.name);

  // Whom it goes for: those it guards (a paladin's friends), the nearest (the mindless, a berserk golem), the hurt.
  if ( guard ) say("target", "protect", guard.name);
  if ( paladin ) say("target", "protect", paladin.name);
  const berserk = feature(["berserk"]);
  if ( berserk ) say("target", "nearest", berserk.name);
  if ( blank ) say("target", "nearest", blank);
  const finisher = feature(FINISHERS);
  if ( finisher ) say("target", "weakest", finisher.name);
  const slayer = feature(["mage-slayer"]);
  if ( slayer ) say("target", "casters", slayer.name);

  // Its limited means: what recharges (and a legendary creature's) is for this fight; a short rest's, for every fight;
  // a full caster's spell slots last the day.
  if ( !pc && f.recharge?.length ) say("resourceUse", "nova", f.recharge[0]);
  if ( f.legendary ) say("resourceUse", "nova", legendaryActionsName());
  if ( pc && main ) {
    const progression = main.progression ?? "none";
    if ( progression === "pact" ) say("resourceUse", "nova", feature(["pact-magic"])?.name ?? main.name);
    else if ( progression === "none" ) say("resourceUse", "nova", feature(EVERY_FIGHT)?.name);
    else if ( progression === "full" ) say("resourceUse", "conserve", main.name);
  }

  // Magic: a caster's class, by how much it casts (its subclass's, an Eldritch Knight's); a creature's spellcasting.
  if ( pc && main ) {
    say("specialty", PROGRESSION_SPECIALTY[main.progression], main.name);
    say("specialty", PROGRESSION_SPECIALTY[main.subclass?.progression], main.subclass?.name);
  }
  if ( casting && f.coreStyle === "caster" ) say("specialty", "strong", casting.name);

  // Gear: an artificer's, and a thief's Fast Hands and Use Magic Device, are made for it; a creature's flask or bomb is
  // for throwing; a merchant knows what it all costs.
  const artificer = ofClass("artificer");
  if ( artificer ) say("consumables", "freely", artificer.name);
  const hands = feature(ITEM_USERS);
  if ( hands ) say("consumables", "freely", hands.name);
  const bomb = pc ? null : attacks.find(a => a.consumable);
  if ( bomb ) say("consumables", "freely", bomb.name);
  if ( f.background?.id === "merchant" ) say("consumables", "sparing", f.background.name);

  // Talking: never without a mind, words or a will of its own; a devil bargains, a bard talks first; its social skills.
  for ( const why of [blank, wordless, master] ) if ( why ) say("talk", "never", why);
  if ( devil ) say("talk", "first", devil);
  if ( main?.id === "bard" ) say("talk", "first", main.name);
  const social = ["per", "dec", "itm"].filter(k => Number(skills[k]) >= 1);
  const sway = social.reduce((n, k) => n + (Number(skills[k]) >= 2 ? 2 : 1), 0);
  if ( social.length ) say("talk", sway >= 3 ? "first" : "opportune", listJoin(social.map(skillName)));

  // Healing others: a Life Domain cleric at all costs; a cleric, a paladin's Lay on Hands, a celestial readily; the evil
  // keep it for themselves; anyone else as it comes.
  if ( heals.length ) {
    if ( life ) say("healAggro", "allCosts", life.name);
    if ( cleric ) say("healAggro", "aggressive", cleric.name);
    const layOn = feature(["lay-on-hands"]);
    if ( layOn ) say("healAggro", "aggressive", layOn.name);
    if ( creature === "celestial" ) say("healAggro", "aggressive", kind);
    if ( !pc && evil ) say("healAggro", "conservative", alignName);
    say("healAggro", "balanced", healNames);
  }

  // Its own potions: one that heals itself needs none; one hard to put down waits; frail ones drink early.
  if ( Number(f.potions) > 0 ) {
    const regen = feature(["regeneration"]);
    if ( regen ) say("potionThreshold", "never", regen.name);
    const tough = feature(["relentless-endurance", "relentless-rage", "undead-fortitude"]);
    if ( tough ) say("potionThreshold", "25", tough.name);
    const die = { d6: "50", d12: "25" }[main?.hd];
    if ( pc && die ) say("potionThreshold", die, t("Reason.HitDie", { name: main.name, die: main.hd }));
  }

  // A friend down: a paladin, a cleric and a healer go to them; the evil and the mindless fight on; a goblin boss puts
  // a friend between itself and harm.
  if ( blank ) say("allyDying", "fight", blank);
  if ( construct ) say("allyDying", "fight", construct);
  const redirect = feature(["redirect-attack"]);
  if ( redirect ) say("allyDying", "protectSelf", redirect.name);
  if ( paladin ) say("allyDying", "rescue", paladin.name);
  if ( cleric ) say("allyDying", "rescue", cleric.name);
  if ( !pc && evil ) say("allyDying", "fight", alignName);
  if ( heals.length ) say("allyDying", "rescue", healNames);
  const spare = (f.spells ?? []).find(s => s?.id === "spare-the-dying") ?? feature(["healer"]);
  if ( spare ) say("allyDying", "rescue", spare.name);
  if ( !pc && good ) say("allyDying", "rescue", alignName);
  if ( creature === "celestial" ) say("allyDying", "rescue", kind);
  if ( pc && Number(skills.med) >= 1 ) say("allyDying", "rescue", skillName("med"));

  // Back up from 0 HP: what keeps it going rejoins at once; one that heals itself does that first; a beast runs.
  const enduring = feature(ENDURING);
  if ( enduring ) say("selfRevived", "rejoin", enduring.name);
  for ( const why of [blank, construct] ) if ( why ) say("selfRevived", "rejoin", why);
  const selfHeals = (f.selfHeals ?? []).filter(Boolean);
  if ( selfHeals.length ) say("selfRevived", "healSelf", listJoin(selfHeals.slice(0, 2)));
  if ( heals.length ) say("selfRevived", "healSelf", healNames);
  if ( beast ) say("selfRevived", "retreat", t("Reason.BeastFlees"));

  // Running: never for what serves, barely thinks, or is built or devoted to fight on; a pack runs when it's losing,
  // a goblin slips away hurt; nothing frightens the fearless; a beast flees when hurt.
  for ( const why of [master, blank] ) if ( why ) say("retreat", "never", why);
  if ( ["construct", "ooze"].includes(creature) ) say("retreat", "never", kind);
  const fanatic = feature(FANATICS);
  if ( fanatic ) say("retreat", "never", fanatic.name);
  const pack = feature(["pack-tactics"]);
  if ( pack ) say("retreat", "losing", pack.name);
  if ( nimble ) say("retreat", "hurt", nimble.name);
  if ( (f.ci ?? []).includes("frightened") ) say("retreat", "losing", t("Reason.Immune", { condition: conditionName("frightened") }));
  if ( beast ) say("retreat", "hurt", t("Reason.BeastFlees"));

  // Its own defense (a 5e shield is in its AC: this is how readily it Dodges): anyone can Dodge but the mindless, an
  // animal's mind and the reckless; a monk's Patient Defense makes it a bonus action.
  if ( blank ) say("shield", "never", blank);
  const int = Number(f.int);
  if ( Number.isFinite(int) && int <= 3 ) say("shield", "never", t("Reason.Ability", { name: abilityName("int"), n: int }));
  const reckless = feature(["reckless-attack", "reckless"]);
  if ( reckless ) say("shield", "never", reckless.name);
  const patient = feature(["patient-defense", "monks-focus"]);
  if ( patient ) say("shield", "always", patient.name);
  say("shield", "spare", t("Dodge"));

  // Others nearby: what serves, barely thinks or was built stays; pack hunters and the bloodthirsty hunt; a commander
  // calls its troops; a beast stays.
  for ( const why of [master, blank, construct] ) if ( why ) say("beyond", "stay", why);
  const hunter = feature(HUNTERS);
  if ( hunter ) say("beyond", "hunt", hunter.name);
  const commander = feature(COMMANDERS);
  if ( commander ) say("beyond", "seekHelp", commander.name);
  if ( beast ) say("beyond", "stay", kind);

  // What it offers and expects to end an argument: nothing, without a mind, words or a will of its own; a devil's
  // bargain; a dragon's tribute; a thief's toll; a merchant or noble buys its way out; a creature's alignment.
  for ( const why of [blank, wordless, master] ) {
    if ( why ) { say("offer", { kind: "" }, why); say("expect", { kind: "" }, why); }
  }
  const gp = (f.coins ?? []).includes(100) ? 100 : null;
  // (So much gold by its level or challenge rating, as the core reckons a demand.)
  const toll = gp ? { kind: "money", amount: 10 * Math.max(1, Math.round(Number(f.level) || 0)), coin: gp } : null;
  if ( devil ) {
    say("offer", { kind: "noHarm" }, devil);
    if ( toll ) say("expect", toll, devil);
  }
  // (A true dragon, not a kobold or a dim wyrmling.)
  if ( creature === "dragon" && toll && Number(f.int) >= 10 ) say("expect", toll, kind);
  if ( !pc && toll && (f.languages ?? []).includes("cant") ) say("expect", toll, languageName("cant"));
  const moneyed = MONEYED.includes(f.background?.id) ? f.background : null;
  const share = gp ? Math.floor((Number(f.money) || 0) / gp / 10) : 0;
  if ( moneyed && share >= 1 ) say("offer", { kind: "money", amount: share, coin: gp }, moneyed.name);
  if ( !pc && good ) {
    say("offer", { kind: "noHarm" }, alignName);
    say("expect", { kind: "noHarm" }, alignName);
  }
  if ( !pc && align === "ne" && toll && PEOPLE.includes(creature) ) say("expect", toll, alignName);
  if ( !pc && align === "ce" ) say("offer", { kind: "" }, alignName);
  return out;
}

/** "Understands Common but can't speak" (not "can't speak in wolf form"), in the reading words ("no puede hablar" too). */
const mute = text => !!wordPattern(currentReading().languages?.mute)?.test(String(text ?? ""));

/**
 * The languages it speaks, by key: its sheet's, and those its custom languages name ("Common plus one other language"),
 * by the system's names for them; none if it can't speak ("Understands Common but can't speak").
 * @param {{value, custom, communication}} languages   its system.traits.languages
 * @param {Record<string, string>} names               the system's languages, by key
 */
export function spokenLanguages(languages, names = {}) {
  const custom = String(languages?.custom ?? "");
  if ( mute(custom) ) return [];
  const value = languages?.value;
  const out = new Set(value instanceof Set ? value : Array.isArray(value) ? value : []);
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for ( const [key, name] of Object.entries(names) ) {
    if ( name && new RegExp(`(?<![\\p{L}])${escape(String(name))}(?![\\p{L}])`, "iu").test(custom) ) out.add(key);
  }
  return [...out];
}

/**
 * Does it talk with anyone who has a language at all (the core's social.anyLanguage)? Every language (dnd5e's "ALL";
 * every standard and every exotic one, as 2024's angels have it), or telepathy.
 */
export function talksWithAnyone(languages) {
  const value = languages?.value;
  const keys = new Set([...(value instanceof Set ? value : Array.isArray(value) ? value : [])].map(k => String(k).toLowerCase()));
  return keys.has("all") || (keys.has("standard") && keys.has("exotic")) || Number(languages?.communication?.telepathy?.value) > 0;
}

/** Does it speak at all (a language, a custom one, telepathy)? */
export function speaksAtAll(languages, names = {}) {
  if ( Number(languages?.communication?.telepathy?.value) > 0 ) return true;
  const custom = String(languages?.custom ?? "").trim();
  return spokenLanguages(languages, names).length > 0 || (!!custom && !mute(custom));
}

/** The alignment's key (lg ... ce) from what the sheet says, by the system's own names for them; null if none fits. */
export function alignmentKey(text, names = {}) {
  const said = String(text ?? "").trim().toLowerCase();
  if ( !said ) return null;
  for ( const [key, name] of Object.entries(names) ) if ( String(name).trim().toLowerCase() === said ) return key;
  return null;
}

/**
 * Its biography, for the keywords (the core's {about, story, against}): what a character's sheet says of it (its
 * appearance, personality traits, ideals and flaws) in full, and its biography as a story told about it (a backstory:
 * its words may be about anyone in it). A creature's biography is its lore, said of it. Never its bonds: those are about
 * others (the people, places and things it's tied to). Nothing on a 5e sheet says what it's against.
 * @param {string} type        "character" | "npc"
 * @param {object} details     its system.details
 * @param {(html: string) => string} [text]   a field's HTML as plain text
 * @returns {{about: string, story: string, against: string}}
 */
export function biographyOf(type, details, text = plainText) {
  const d = details ?? {};
  const join = values => values.map(v => text(v ?? "")).filter(Boolean).join("\n");
  if ( type === "character" ) return { about: join([d.appearance, d.trait, d.ideal, d.flaw]), story: join([d.biography?.value, d.biography?.public]), against: "" };
  return { about: join([d.biography?.value, d.biography?.public, d.trait, d.ideal, d.flaw]), story: "", against: "" };
}
