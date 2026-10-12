/**
 * What D&D 5e says about a character, for the one time FastFighting sets it up by itself (the core's
 * foundry/auto-config.js): the playstyles that fit it and its own answers to the tactics questions, from its classes
 * (by identifier), species (by identifier, only where an SRD trait says something), kind of creature, alignment and
 * gear; and its biography as plain text for the keywords (biographyOf: what's said of it, and its story). Pure.
 */

/** What each class leans toward (several classes add up). */
const CLASSES = Object.freeze({
  barbarian: { brawler: 0.5, impatient: 0.3 },
  bard: { peoplePleaser: 0.3, diplomat: 0.3, enabler: 0.2 },
  cleric: { enabler: 0.5, moralist: 0.2 },
  druid: { unmundane: 0.3, loreCollector: 0.2, enabler: 0.1 },
  fighter: { brawler: 0.3, tank: 0.2 },
  monk: { speedRunner: 0.4 },
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

/** The playstyles that fit: {id: -1 to 1}. */
export function dnd5eHints({ classes = [], species = null, creature = "", alignment = null, shield = false, heavy = false } = {}) {
  const out = {};
  const add = map => { for ( const [k, v] of Object.entries(map ?? {}) ) out[k] = (out[k] ?? 0) + v; };
  for ( const c of classes ) add(CLASSES[c]);
  add(SPECIES[species]);
  add(CREATURES[creature]);
  add(ALIGNMENTS[alignment]);
  if ( shield ) add({ tank: 0.2 });
  if ( heavy ) add({ tank: 0.2 });
  for ( const k of Object.keys(out) ) out[k] = Math.max(-1, Math.min(1, out[k]));
  return out;
}

/** A class's fighting style, the first class that has one. */
const CLASS_STYLE = Object.freeze({
  paladin: "protector", barbarian: "frontline", fighter: "frontline", monk: "skirmisher", rogue: "skirmisher", ranger: "ranged",
  wizard: "caster", sorcerer: "caster", warlock: "caster", druid: "caster", cleric: "caster", bard: "caster", artificer: "caster"
});

/** D&D 5e's own answers to the tactics questions, where it knows better than the numbers: {key: answer}. */
export function dnd5eTactics({ classes = [], creature = "", mindless = false } = {}) {
  const out = {};
  const style = classes.map(c => CLASS_STYLE[c]).find(Boolean);
  if ( style ) out.style = style;
  // (A paladin guards its friends and goes to one who falls; a cleric heals readily.)
  if ( classes.includes("paladin") ) Object.assign(out, { target: "protect", allyDying: "rescue" });
  if ( classes.includes("cleric") ) out.healAggro = "aggressive";
  // (Constructs and oozes, and the mindless, never run.)
  if ( ["construct", "ooze"].includes(creature) || mindless ) out.retreat = "never";
  if ( creature === "beast" ) out.beyond = "stay";
  return out;
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
 * appearance, personality traits, ideals, bonds and flaws) in full, and its biography as a story told about it (a
 * backstory: its words may be about anyone in it). A creature's biography is its lore, said of it. Nothing on a 5e sheet
 * says what it's against.
 * @param {string} type        "character" | "npc"
 * @param {object} details     its system.details
 * @param {(html: string) => string} [text]   a field's HTML as plain text
 * @returns {{about: string, story: string, against: string}}
 */
export function biographyOf(type, details, text = plainText) {
  const d = details ?? {};
  const join = values => values.map(v => text(v ?? "")).filter(Boolean).join("\n");
  if ( type === "character" ) return { about: join([d.appearance, d.trait, d.ideal, d.bond, d.flaw]), story: join([d.biography?.value, d.biography?.public]), against: "" };
  return { about: join([d.biography?.value, d.biography?.public, d.trait, d.ideal, d.bond, d.flaw]), story: "", against: "" };
}

/** Text from the sheet's HTML. */
export function plainText(html) {
  return String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, "\"").replace(/\s+/g, " ").trim();
}
