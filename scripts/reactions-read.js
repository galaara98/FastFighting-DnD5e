/**
 * 5e reactions the helper doesn't know by identifier, read from a feature's words into the core's reactions (its
 * behavior/responses.js): a monster's Parry, a Retaliation, and the like in any book, by the reading words' "reactions"
 * section (reading/<lang>.json).
 *
 *  - Where: 2024's "Trigger: ... Response: ..."; a sentence saying it can use its reaction ("When ..., you can use your
 *    reaction to ..."); "provokes an opportunity attack from you when ..."; or, where the words say nothing of the
 *    moment (2014's monster Parry), the activity's own condition, the rest its response.
 *  - The moment (`moments`, the first that fits): hit, missed, attacked, a friend targeted or hit, a foe casting, a foe
 *    entering its reach, damaged; melee or ranged attacks only where it says so; how near ("within 5 feet of you"), of
 *    the friend or of the foe as it says.
 *  - What it does (`effects`): a bonus to AC (its number, or the activity's roll formula: 2024's), a strike back, the
 *    blow halved, so much off the blow (dice, plus a proficiency bonus or an ability modifier), damage dealt back (its
 *    type by the reading words' "damageTypes").
 * A sentence that happens only sometimes ("On a miss, ...") is left out; one with a choice, a teleport, a reroll or
 * the like keeps the reaction from being read at all, as does a moment or a response the engine has no word for.
 * Pure: plain text in, the core's reactions out.
 */
import { part } from "./core.js";
import { currentReading } from "./reading.js";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

/** A reading word's pattern, compiled (null for none, or one that won't compile). */
function patternOf(entry, flags = "i") {
  const p = entry?.pattern;
  if ( typeof p !== "string" || !p ) return null;
  try {
    return new RegExp(p, flags);
  } catch ( err ) {
    return null;
  }
}

/** The text's sentences. */
const sentences = text => String(text ?? "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter(Boolean);

/**
 * Its moments and responses, as the words put them: [{trigger, response}], each a piece of text. 2024's Trigger and
 * Response first; else each sentence saying it can use its reaction (or that a foe provokes an opportunity attack from
 * it when ...); else the activity's condition as the trigger, the words its response.
 */
export function triggerParts(text, condition = "", words = currentReading().reactions ?? {}) {
  const said = String(text ?? "").replace(/\s+/g, " ").trim();
  const trigger = patternOf(words.trigger)?.exec(said);
  const response = trigger ? patternOf(words.response)?.exec(said.slice(trigger.index)) : null;
  if ( trigger && response ) {
    const at = trigger.index + response.index;
    return [{ trigger: `${condition} ${said.slice(trigger.index + trigger[0].length, at)}`.trim(), response: said.slice(at + response[0].length).trim() }];
  }
  const out = [];
  for ( const s of sentences(said) ) {
    const use = patternOf(words.useReaction)?.exec(s);
    if ( use ) {
      out.push({ trigger: s.slice(0, use.index), response: s.slice(use.index + use[0].length) });
      continue;
    }
    const opportunity = patternOf(words.opportunity)?.exec(s);
    if ( opportunity ) out.push({ trigger: s.slice(opportunity.index + opportunity[0].length), response: null, strike: true });
  }
  if ( !out.length && String(condition).trim() ) out.push({ trigger: String(condition), response: said });
  return out;
}

/** The moment a trigger names, with its filters: {on (a moment or a list), melee, ranged, range, byRange}, or null. */
export function momentOf(trigger, words = currentReading().reactions ?? {}) {
  const text = String(trigger ?? "");
  for ( const m of words.moments ?? [] ) {
    const found = patternOf(m)?.exec(text);
    if ( !found ) continue;
    const g = found.groups ?? {};
    const out = { on: m.on };
    if ( g.melee || g.melee2 ) out.melee = true;
    if ( g.ranged || g.ranged2 ) out.ranged = true;
    // (How near: of the friend, for a friend's moment, where the words put it after the attack; of the foe where they
    // put it before, on the one attacking.)
    const near = patternOf(words.near)?.exec(text);
    const feet = Number(near?.groups?.feet);
    if ( feet > 0 ) {
      if ( (m.on === "allyTargeted" || m.on === "allyHit") && near.index < found.index ) out.byRange = feet;
      else out.range = feet;
    }
    return out;
  }
  return null;
}

/**
 * What its response does: {ac, strike, halve, reduce: {n, faces, add}, harm: {n, faces, flat, type}}, any of them, or
 * null for nothing the engine plays (or one it can't be sure of: a choice, a teleport ...).
 */
export function responseOf(response, words = currentReading().reactions ?? {}) {
  const fx = words.effects ?? {};
  const out = {};
  for ( const s of sentences(response) ) {
    if ( patternOf(fx.only)?.test(s) ) continue;
    if ( patternOf(fx.unclear)?.test(s) ) return null;
    const ac = patternOf(fx.ac)?.exec(s);
    // (A number; its proficiency bonus; else the activity's roll formula.)
    if ( ac ) out.ac = Number(ac.groups?.ac) || (ac.groups?.prof ? "prof" : null) || out.ac || true;
    if ( patternOf(fx.disadvantage)?.test(s) ) out.ac ??= 5;
    if ( patternOf(fx.strike)?.test(s) ) out.strike = true;
    if ( patternOf(fx.halve)?.test(s) ) out.halve = true;
    const reduce = patternOf(fx.reduce)?.exec(s);
    if ( reduce ) out.reduce = { n: Number(reduce.groups?.n) || 1, faces: Number(reduce.groups?.faces), add: reduce.groups?.add ?? null };
    const harm = patternOf(fx.harm)?.exec(s);
    if ( harm ) out.harm = { n: Number(harm.groups?.n) || 1, faces: Number(harm.groups?.faces), flat: Number(harm.groups?.flat) || 0, type: String(harm.groups?.type ?? "") };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The reactions a feature's words give (spec.reactions entries), none where they say nothing the engine plays.
 * @param {object} d
 * @param {string} d.id           the reaction's id (its item's: one reaction each, numbered past the first)
 * @param {string} d.label        its name
 * @param {string} d.text         its words, as plain text
 * @param {string} [d.condition]  its activity's condition (dnd5e's activation.condition)
 * @param {number} [d.formula]    its activity's roll formula, as a number (2024's "adds [its formula] to its AC")
 * @param {number} [d.prof]       its proficiency bonus
 * @param {object} [d.mods]       its ability modifiers ({dex: 3})
 * @param {object} [d.words]      the reading words (reading.js, by default): their "reactions", "abilities" and
 *                                "damageTypes"
 */
export function reactionsFromWords({ id, label, text, condition = "", formula = null, prof = 2, mods = {}, words = currentReading() }) {
  const read = words.reactions ?? {};
  const out = [];
  // (Whether every moment it answers is one of these.)
  const only = (moment, list) => [].concat(moment.on).every(on => list.includes(on));
  for ( const piece of triggerParts(text, condition, read) ) {
    // (The moment where its trigger says, else where its response names it: "an attack against a creature that enters
    // its reach".)
    const moment = momentOf(piece.trigger, read) ?? (piece.response ? momentOf(piece.response, read) : null);
    const does = piece.strike ? { strike: true } : responseOf(piece.response, read);
    if ( !moment || !does ) continue;
    const r = { id: out.length ? `${id}.${out.length}` : id, label, ...moment };
    if ( does.ac !== undefined ) {
      const ac = does.ac === true ? Number(formula) : does.ac === "prof" ? prof : does.ac;
      if ( !(ac > 0) ) continue;
      if ( !only(moment, ["hit", "attacked", "allyTargeted"]) ) continue;
      r.ac = ac;
    }
    if ( does.strike ) r.strike = true;
    if ( does.halve && only(moment, ["hit"]) ) r.halve = true;
    if ( does.reduce && only(moment, ["hit", "allyHit"]) && does.reduce.faces > 0 ) {
      const add = String(does.reduce.add ?? "");
      const ability = ABILITIES.find(a => patternOf(words.abilities?.[a])?.test(add));
      const flat = !add ? 0 : patternOf(read.effects?.proficiency)?.test(add) ? prof : ability ? Number(mods[ability]) || 0 : null;
      if ( flat === null ) continue;
      r.reduce = part([{ n: does.reduce.n, faces: does.reduce.faces }], flat, "untyped");
    }
    if ( does.harm?.faces > 0 ) {
      const type = Object.keys(words.damageTypes ?? {}).find(k => patternOf(words.damageTypes[k])?.test(does.harm.type));
      if ( !type ) continue;
      r.harm = { damage: [part([{ n: does.harm.n, faces: does.harm.faces }], does.harm.flat, type)] };
    }
    if ( r.ac === undefined && !r.strike && !r.halve && !r.reduce && !r.harm ) continue;
    out.push(r);
  }
  return out;
}
