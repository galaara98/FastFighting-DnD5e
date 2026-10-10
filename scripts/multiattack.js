/**
 * Read a D&D 5e "Multiattack" description into the strikes it makes, in order. Pure, unit-tested.
 *
 *   "The goblin makes two attacks: one with its scimitar and one with its shortbow."   -> [Scimitar, Shortbow]
 *   "The ogre makes two greatclub attacks."                                            -> [Greatclub, Greatclub]
 *   "The bandit captain makes three attacks, using Scimitar or Pistol in any combination." -> best of those, x3
 *   "The wolf attacks twice."                                                          -> best strike, x2
 */

const NUMBER = { one: 1, once: 1, two: 2, twice: 2, three: 3, thrice: 3, four: 4, five: 5, six: 6, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };

function plain(html) {
  return String(html ?? "").replace(/@\w+\[[^\]]*\](?:\{([^}]*)\})?/g, (m, label) => label ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** Escape a name for use in a pattern. */
const re = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * @param {string} description   Multiattack description (HTML or text)
 * @param {string[]} names       Names of the creature's strikes, best first
 * @returns {string[]|null}      Strike names in the order they're made, or null if it can't be read
 */
export function parseMultiattack(description, names) {
  const text = plain(description).toLowerCase();
  if ( !text || !names.length ) return null;
  const total = (() => {
    const m = /makes (one|two|three|four|five|six|\d) (?:[\w'-]+ )*?attacks?/.exec(text) ?? /attacks (twice|thrice|once)/.exec(text);
    return m ? NUMBER[m[1]] : null;
  })();
  if ( !total ) return null;
  const known = names.map(n => ({ name: n, low: n.toLowerCase() }));
  const byWord = new Map(known.map(k => [k.low, k.name]));

  // "one with its bite and two with its claws"
  const out = [];
  for ( const m of text.matchAll(/(one|two|three|four|five|\d) (?:with|using) (?:its|their|his|her) ([\w' -]+?)(?=,| and |\.|;| or |$)/g) ) {
    const n = NUMBER[m[1]];
    const name = matchName(m[2], known);
    if ( name ) for ( let i = 0; i < n; i++ ) out.push(name);
  }
  if ( out.length ) return out.slice(0, total).concat(Array(Math.max(0, total - out.length)).fill(out.at(-1)));

  // "makes two greatclub attacks"
  const named = new RegExp(`makes (?:one|two|three|four|five|six|\\d) (${known.map(k => re(k.low)).join("|")}) attacks?`).exec(text);
  if ( named ) return Array(total).fill(byWord.get(named[1]));

  // "using Scimitar or Pistol in any combination": the first (best) of the ones named
  const mentioned = known.filter(k => text.includes(k.low));
  if ( mentioned.length ) return Array(total).fill(mentioned[0].name);

  // "attacks twice": its best strike
  return Array(total).fill(names[0]);
}

/** The strike a phrase names: exact, singular/plural, or contained. */
function matchName(phrase, known) {
  const p = phrase.trim().replace(/s$/, "");
  return known.find(k => k.low === phrase.trim() || k.low === p || k.low.replace(/s$/, "") === p)?.name
    ?? known.find(k => phrase.includes(k.low.replace(/s$/, "")))?.name
    ?? null;
}
