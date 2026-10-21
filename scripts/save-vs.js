/**
 * Situational saves, as dnd5e keeps them: the core's spec.saveVs (behavior/save-vs.js), advantage on some saves, or on
 * saves against some things.
 *   - The sheet's own: an ability's save roll mode (system.abilities.<a>.save.roll.mode), which the 2024 features set
 *     with an effect (Danger Sense, Gnomish Cunning): advantage (or disadvantage) on every save of that ability.
 *   - A passive feature's words, where no effect of its own says so (the 2014 features, a monster's traits): "has
 *     advantage on saving throws against spells and other magical effects" (Magic Resistance), "against being charmed"
 *     (Fey Ancestry), "Strength and Dexterity saving throws made against effects that would knock it prone"
 *     (Sure-Footed). Which saves, and against what, by the reading words' "saveVs" and "abilities" sections
 *     (reading/<lang>.json): an ability's name before "saving throws" picks its saves, and what follows names the
 *     effects (the engine's tags: "magical", "inflicts:<condition>", "damage:<type>"). One said only while something
 *     holds ("while raging", "unless incapacitated"), one for others (allies in an aura), and one against something the
 *     engine doesn't tell apart (Concentration, death saves, turning undead) are left to the table.
 * Actions carry "damage:<type>" for the damage they deal (damageTags), which a save against poison goes by.
 * Pure: plain values in, the core's saveVs entries out.
 */
import { currentReading, wordPattern } from "./reading.js";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

/** A reading word's pattern, compiled (null for none, or one that won't compile). */
const patternOf = wordPattern;

/** Advantage (or disadvantage) on every save of an ability, from the sheet's save roll modes ({dex: 1}). */
export function sheetSaveVs(modes = {}) {
  const out = [];
  for ( const a of ABILITIES ) {
    const mode = Math.sign(Number(modes?.[a]) || 0);
    if ( mode ) out.push({ advantage: mode, saves: [a] });
  }
  return out;
}

/**
 * The saves one sentence's "advantage on ... saving throws ..." gives (an entry of spec.saveVs), or null.
 * @param {string} sentence
 * @param {object} words      the reading words' "saveVs" section
 * @param {object} names      the reading words' "abilities" (each ability's name)
 */
function fromSentence(sentence, words, names) {
  const advantage = patternOf(words.advantage);
  const m = advantage ? advantage.exec(sentence) : null;
  if ( !m ) return null;
  const before = sentence.slice(0, m.index);
  if ( patternOf(words.conditional)?.test(sentence) || patternOf(words.others)?.test(before) ) return null;
  let clause = sentence.slice(m.index + m[0].length);
  const end = patternOf(words.clauseEnd)?.exec(clause);
  if ( end ) clause = clause.slice(0, end.index);
  if ( patternOf(words.skip)?.test(clause) ) return null;
  const saves = patternOf(words.saves)?.exec(clause);
  if ( !saves ) return null;
  // Which saves: the abilities named just before "saving throws" (past any checks or rolls named first); none, all.
  let named = clause.slice(0, saves.index);
  const notSave = patternOf(words.notSave, "gi");
  if ( notSave ) for ( const n of named.matchAll(notSave) ) named = clause.slice(n.index + n[0].length, saves.index);
  const abilities = ABILITIES.filter(a => patternOf(names?.[a])?.test(named));
  // Against what: the engine's tags its words name (not its examples: "such as traps and spells").
  let against = clause.slice(saves.index + saves[0].length);
  const example = patternOf(words.examples)?.exec(against);
  if ( example ) against = against.slice(0, example.index);
  const vs = Object.entries(words.tags ?? {}).filter(([, entry]) => patternOf(entry)?.test(against)).map(([tag]) => tag);
  // (Against something it says, but nothing the engine knows: not for the engine. Against whatever it sees: any.)
  if ( !vs.length && /\p{L}/u.test(against) && !patternOf(words.any)?.test(against) ) return null;
  return { advantage: 1, ...(abilities.length ? { saves: abilities } : {}), ...(vs.length ? { vs } : {}) };
}

/**
 * What a passive feature's words give its saves: spec.saveVs entries (none where they say nothing the engine plays).
 * @param {string} text        its words, as plain text
 * @param {object} [words]     the reading words (reading.js, by default): their "saveVs" and "abilities"
 */
export function saveVsFromWords(text, words = currentReading()) {
  const out = [];
  for ( const sentence of String(text ?? "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+/) ) {
    const entry = fromSentence(sentence, words.saveVs ?? {}, words.abilities ?? {});
    if ( entry ) out.push(entry);
  }
  return out;
}

/** The "damage:<type>" tags of whatever damage an action deals (its own, its sequence's, its riders': a bite's venom). */
export function damageTags(action) {
  const types = new Set();
  const take = parts => { for ( const p of parts ?? [] ) if ( p?.type && p.type !== "untyped" ) types.add(String(p.type).toLowerCase()); };
  take(action?.damage);
  for ( const s of action?.sequence ?? [] ) take(s?.damage);
  for ( const e of action?.effects ?? [] ) take(e?.damage);
  return [...types].map(type => `damage:${type}`);
}
