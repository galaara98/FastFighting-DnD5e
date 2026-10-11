/**
 * What a 5e character adds to a hit, for a price: Divine Smite and the smite spells (a spell slot, upcast for more),
 * Eldritch Smite (a pact slot), Stunning Strike (a Focus or ki point), Battle Master maneuvers (a superiority die).
 * They aren't actions of their own: the engine offers them when a hit lands, and the creature decides whether this
 * hit is worth it (see the core's riders.js).
 *
 * Recognised by identifier (the same in the free rules and every book); a feature or spell with no attack of its own
 * that says it works "when you hit" or "after you hit" counts too, so books nobody has seen yet still work.
 * Pure: plain values in, riders out.
 */

/** Identifiers of things that ride on a hit. */
export const ON_HIT = new Set([
  "divine-smite", "searing-smite", "shining-smite", "branding-smite", "thunderous-smite", "wrathful-smite", "blinding-smite",
  "staggering-smite", "banishing-smite", "eldritch-smite", "stunning-strike",
  // Battle Master maneuvers (the Player's Handbook)
  "trip-attack", "menacing-attack", "pushing-attack", "disarming-attack", "distracting-strike", "goading-attack", "precision-attack",
  "lunging-attack", "sweeping-attack", "feinting-attack", "commanding-strike"
]);
/** What a character's words say about riding on a hit. */
export const HIT_WORDS = /\b(?:immediately )?after (?:you )?hit(?:ting)?\b|\bwhen you hit (?:a |the |that )?(?:creature|target|foe|enemy)\b/i;
const MELEE_ONLY = /\bmelee weapon\b|\bunarmed strike\b|\bmelee attack\b/i;
const RANGED_ONLY = /\branged weapon\b|\branged attack\b/i;
const ONCE_PER_TURN = /\bonce (?:on each of your turns|per turn|each turn)\b/i;
const VS_FIENDS = /\bfiends?\b|\bundead\b|\bunholy\b/i;

/**
 * The riders one feature or spell makes.
 * @param {object} d
 * @param {string} d.id          a stable id for the item
 * @param {string} d.name
 * @param {string} d.text        its description, as plain words
 * @param {object[]} d.damage    [{parts, perLevel: parts added for each slot level above the first, vs: against fiends and
 *                               undead only, total: (with vs) all it deals then, rather than extra}]
 * @param {object|null} d.save   {type, dc, outcome} a save its target makes, and what a failure lays on it
 * @param {object|null} d.cost   what one use takes: {slots: [{key, level, pool}], baseLevel, maxLevel, turn: {bonus?, slot?}}
 *                               or {resource, pool} or {uses}
 * @param {number} [d.attackDie] a die added to a close miss (Precision Attack)
 * @returns {object[]} riders for spec.riders
 */
export function ridersFrom(d) {
  const melee = MELEE_ONLY.test(d.text) && !RANGED_ONLY.test(d.text);
  const ranged = RANGED_ONLY.test(d.text) && !MELEE_ONLY.test(d.text);
  const base = {
    label: d.name, weapon: !/\bspell attack\b/i.test(d.text), melee: melee || undefined, ranged: ranged || undefined,
    oncePerTurn: ONCE_PER_TURN.test(d.text) || undefined, critDouble: true
  };
  const outcome = d.save?.outcome ?? null;
  const save = d.save && outcome ? { type: d.save.type, dc: d.save.dc } : null;
  if ( d.attackDie ) {
    return [{ ...base, id: d.id, when: "miss", attackDie: d.attackDie, critDouble: undefined, ...priceOf(d.cost, null) }];
  }
  const normal = d.damage.filter(x => !x.vs);
  const versus = d.damage.filter(x => x.vs);
  const levels = d.cost?.slots?.length ? d.cost.slots : [null];
  const out = [];
  for ( const slot of levels ) {
    const above = slot ? Math.max(0, slot.level - (d.cost.baseLevel ?? slot.level)) : 0;
    const capped = d.cost?.maxLevel ? Math.min(above, d.cost.maxLevel - (d.cost.baseLevel ?? 1)) : above;
    const dmg = list => list.flatMap(x => [...x.parts, ...scaled(x.perLevel, capped)]);
    const plain = dmg(normal);
    const extra = dmg(versus);
    const versusAll = versus.some(x => x.total) ? extra : [...plain, ...extra];
    const tag = slot ? `${d.id}@${slot.key}` : d.id;
    const group = slot || extra.length ? d.id : undefined;
    const price = priceOf(d.cost, slot);
    const rider = { ...base, ...price, group, damage: plain.length ? plain : undefined };
    if ( save ) Object.assign(rider, { save, onSave: [outcome, outcome, null, null] });
    else if ( outcome ) rider.outcome = outcome;
    if ( !rider.damage && !rider.save && !rider.outcome ) continue;
    // Against fiends and undead (Divine Smite), a bigger version first: one or the other.
    if ( extra.length ) out.push({ ...rider, id: `${tag}:vs`, label: `${d.name} (fiend or undead)`, vs: ["fiend", "undead"], damage: versusAll });
    out.push({ ...rider, id: tag });
  }
  return out;
}

/** n more of a scaling's dice (n levels above the first). */
function scaled(parts, n) {
  if ( !parts?.length || n <= 0 ) return [];
  return parts.map(p => ({ ...p, dice: p.dice.map(x => ({ ...x, n: x.n * n })), flat: p.flat * n }));
}

/** What a use costs, as rider fields. */
function priceOf(cost, slot) {
  if ( !cost ) return {};
  const turn = cost.turn && Object.keys(cost.turn).length ? { cost: { ...cost.turn } } : {};
  if ( slot ) return { resource: slot.key, dear: slot.level, ...turn };
  if ( cost.resource ) return { resource: cost.resource, ...turn };
  if ( Number.isFinite(cost.uses) ) return { uses: cost.uses, ...turn };
  return turn;
}

/** Does this item's text name fiends and undead (a Divine Smite's extra die)? */
export const namesFiends = text => VS_FIENDS.test(text ?? "");
