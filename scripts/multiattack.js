/**
 * Read a D&D 5e "Multiattack" description into the strikes it makes, in order. Pure, unit-tested. It reads the
 * sentence patterns the 2014 and 2024 stat blocks use, not particular monsters:
 *
 *   "The goblin makes two attacks: one with its scimitar and one with its shortbow."     -> [Scimitar, Shortbow]
 *   "The bear makes one Bite attack and one Claw attack."                                -> [Bite, Claw]
 *   "The ogre makes two greatclub attacks."                                              -> [Greatclub, Greatclub]
 *   "The thug makes two melee attacks."                                                  -> its best melee strike, x2
 *   "The captain makes two attacks, using Scimitar or Pistol in any combination."        -> [Scimitar x2] or [Pistol x2]
 *   "The knight makes two Longsword attacks or two Longbow attacks."                     -> either
 *   "The wolf attacks twice."                                                            -> its best strike, x2
 *
 * Where a monster has a choice, each choice is an option, and the simulation picks one each turn (melee up close,
 * ranged from afar, whichever does more).
 */

const NUMBER = { one: 1, once: 1, two: 2, twice: 2, three: 3, thrice: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const COUNT = `${Object.keys(NUMBER).filter(w => !/ce$/.test(w)).join("|")}|\\d+d\\d+|\\d+`;
const GENERIC = /^(?:melee|ranged|weapon|other|natural|additional|more|different)$/;
const MAX_OPTIONS = 4;

function plain(html) {
  return String(html ?? "").replace(/@\w+\[[^\]]*\](?:\{([^}]*)\})?/g, (m, label) => label ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** "two" -> 2, "3" -> 3, "1d4" -> its average, rounded. */
function countOf(word) {
  const dice = /^(\d+)d(\d+)$/.exec(word);
  if ( dice ) return Math.max(1, Math.round(Number(dice[1]) * (Number(dice[2]) + 1) / 2));
  return NUMBER[word] ?? (Number(word) || 0);
}

/** A strike's name without its "(Wolf or Hybrid Form Only)" note. */
const baseName = name => name.toLowerCase().replace(/\s*\([^)]*\)/g, "").trim();
const singular = s => s.replace(/(?:es|s)$/, "");

/**
 * The strike a phrase names: exact, singular/plural, or (unless strict) contained. Strict is for "N ___ attacks",
 * where the blank must be a name ("only one of which can be a bite" names no attack count).
 */
function matchName(phrase, known, strict = false) {
  const p = phrase.trim().replace(/^(?:its|their|his|her|a|an|the)\s+/, "").replace(/\s*-$/, "").trim();
  if ( !p ) return null;
  return known.find(k => k.low === p || singular(k.low) === singular(p))?.name
    ?? (strict ? null : known.find(k => p.includes(singular(k.low)) || (singular(p).length > 3 && k.low.startsWith(singular(p))))?.name)
    ?? null;
}

/** The strikes a stretch of text names, best first. */
function named(text, known) {
  return known.filter(k => new RegExp(`\\b${singular(k.low).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(text)).map(k => k.name);
}

/**
 * @param {string} description            Multiattack description (HTML or text)
 * @param {(string|{name, melee})[]} strikes   The creature's strikes, best first (melee true/false when known)
 * @returns {string[][]}                  Each way it can make its Multiattack (strike names in order), most likely first
 */
export function parseMultiattackOptions(description, strikes) {
  const text = plain(description).toLowerCase();
  const known = (strikes ?? []).map(s => (typeof s === "string" ? { name: s, melee: null } : s)).map(k => ({ ...k, low: baseName(k.name) }));
  if ( !text || !known.length ) return [];

  // The sentence that says how many attacks (later ones are swaps: "It can replace one attack with ...").
  const sentences = text.split(/(?<=\.)\s*(?=[a-z])/).filter(s => !/^(?:it|the [\w' -]+?) (?:can )?(?:replace|(?:make|use)s?\b[^.]*\b(?:in place of|instead of))/.test(s));
  const countRe = new RegExp(`\\b(?:${COUNT})\\b[^.]*?\\battacks?\\b|attacks (?:twice|thrice)|as many [\\w' -]+ attacks as it has heads`);
  const sentence = sentences.find(s => countRe.test(s)) ?? sentences.find(s => new RegExp(`\\b(?:${COUNT}) [a-z]`).test(s)) ?? "";
  if ( !sentence ) return [];

  // "... or two Longbow attacks", "..., or it makes three Poison Ray attacks", "... - or two ranged attacks ..."
  // (An alternative that needs something first, "three Slam attacks if it used Hasten this turn", isn't the usual.)
  const split = sentence.split(new RegExp(`,?\\s+(?:-\\s+)?or (?:it )?(?:makes |can make )?(?=(?:${COUNT}) )`));
  const alternatives = split.length > 1 ? split.filter((p, i) => i === 0 || !/\bif (?:it|the|its)\b/.test(p)) : split;
  const out = [];
  for ( const part of alternatives ) out.push(...readOption(part, known));
  // The same sequence twice is one option.
  const seen = new Set();
  return out.filter(seq => seq.length && !seen.has(seq.join("|")) && seen.add(seq.join("|"))).slice(0, MAX_OPTIONS);
}

/** One alternative: a list of slots, each "n strikes, one of these". */
function readOption(part, known) {
  // "one with its bite and two with its claws", "two ranged attacks with its longbow", "one to constrict"
  const withIts = [...part.matchAll(new RegExp(`\\b(${COUNT}) (?:(?:melee |ranged )?attacks? )?(?:(?:with|using) (?:its|their|his|her)|to) ([\\w' -]+?)(?=,| and |\\.|;| or | - |$)`, "g"))];
  if ( withIts.length ) {
    const slots = withIts.map(m => ({ n: countOf(m[1]), choices: [matchName(m[2], known)].filter(Boolean) }));
    if ( slots.every(s => s.choices.length) ) return expand(slots, totalOf(part, slots));
  }

  // "using Claw or Tail in any combination", "either with its longsword or its longbow"
  const pool = (() => {
    const using = /using ([^.]*?) in any combination/.exec(part)?.[1] ?? /either with ([^.]*)/.exec(part)?.[1];
    const names = using ? named(using, known) : [];
    return names.length ? names : null;
  })();
  const ofKind = word => {
    if ( word === "melee" ) return known.filter(k => k.melee !== false).map(k => k.name);
    if ( word === "ranged" ) return known.filter(k => k.melee !== true).map(k => k.name);
    return pool ?? known.map(k => k.name);
  };

  // "one Bite attack and one Claw attack", "two Javelin or Morningstar attacks", "three other attacks", "two melee attacks"
  const slots = [];
  for ( const m of part.matchAll(new RegExp(`\\b(${COUNT}) ([a-z][\\w' -]*?) attacks?\\b`, "g")) ) {
    const phrase = m[2].trim();
    const n = countOf(m[1]);
    if ( GENERIC.test(phrase) ) {
      const choices = ofKind(phrase);
      if ( !choices.length ) return []; // "two ranged attacks" with nothing to shoot
      slots.push({ n, choices });
      continue;
    }
    const choices = phrase.split(/,? or |, /).map(p => matchName(p, known, true)).filter(Boolean);
    if ( choices.length ) slots.push({ n, choices });
  }
  // "makes three Rend." (a word lost from the stat block)
  if ( !slots.length ) {
    for ( const m of part.matchAll(new RegExp(`\\b(${COUNT}) ([a-z][\\w' -]*?)(?=[.,]|$)`, "g")) ) {
      const name = matchName(m[2], known);
      if ( name && known.some(k => k.low === m[2].trim() || singular(k.low) === singular(m[2].trim())) ) slots.push({ n: countOf(m[1]), choices: [name] });
    }
  }
  if ( slots.length ) return expand(slots, totalOf(part, slots));

  // "makes three attacks", "attacks twice", "as many Bite attacks as it has heads" (a hydra starts with five)
  const heads = /as many ([\w' -]+?) attacks as it has heads/.exec(part);
  if ( heads ) {
    const name = matchName(heads[1], known);
    return name ? [Array(5).fill(name)] : [];
  }
  const total = totalOf(part, []);
  if ( !total ) return [];
  // "only one of which can be a bite": not that one
  const limited = /only one of which can be (?:a |an |with its )?([\w' -]+)/.exec(part);
  const not = limited ? matchName(limited[1], known) : null;
  const choices = ofKind(/\bmelee\b/.test(part) && !/\branged\b/.test(part) ? "melee" : /\branged\b/.test(part) && !/\bmelee\b/.test(part) ? "ranged" : "").filter(n => n !== not);
  return expand([{ n: total, choices: choices.length ? choices : [known[0].name] }], total);
}

/** How many attacks a passage says it makes. */
function totalOf(part, slots) {
  const m = new RegExp(`\\b(${COUNT}) (?:[\\w'-]+ )*?attacks?\\b`).exec(part) ?? /attacks (twice|thrice)/.exec(part);
  const said = m ? countOf(m[1]) : 0;
  const sum = slots.reduce((s, x) => s + x.n, 0);
  return Math.max(said, sum);
}

/**
 * Slots -> sequences. A slot with one choice is fixed; slots with several choices make one option per choice
 * (so "Scimitar or Pistol in any combination" is all-scimitar or all-pistol, whichever suits the moment).
 * Short of the total ("one with its bite and one to constrict"), the last strike repeats.
 */
function expand(slots, total) {
  const varied = [...new Set(slots.filter(s => s.choices.length > 1).flatMap(s => s.choices))];
  const picks = varied.length ? varied : [null];
  return picks.map(pick => {
    const seq = slots.flatMap(s => Array(s.n).fill(s.choices.length > 1 && s.choices.includes(pick) ? pick : s.choices[0]));
    while ( seq.length < total && seq.length ) seq.push(seq.at(-1));
    return seq;
  });
}
