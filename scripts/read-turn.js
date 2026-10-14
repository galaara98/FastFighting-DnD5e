/**
 * A player's turn in a live battle, read from the chat cards dnd5e made for it (flags.dnd5e: the roll's type, its
 * targets, its activity and item): what FastFighting's engine would have logged, so the turn is told like any other.
 *   - An attack roll: at whom, with what, a hit (against the target's AC), a critical or a miss; its damage roll's damage
 *     (the sheets settle how much).
 *   - Persuasion, Intimidation or Deception: words, for the GM to confirm (at whom and how well).
 *   - Healing: told as healing (the sheets say how much).
 * Each event says whether it's `sure`.
 */

/** A skill rolled at someone that is words, and which (dnd5e skill ids). */
const TALK = { prs: "persuade", itm: "intimidate", dec: "deceive" };

const tokenIdOf = uuid => (typeof uuid === "string" && uuid.includes("Token.") ? uuid.split("Token.").pop().split(".")[0] : null);

/** The natural d20 of a roll, where it shows. */
function naturalOf(roll) {
  const d20 = roll?.dice?.find?.(d => d.faces === 20);
  return d20?.total ?? null;
}

/** The item a card came from, by its name. */
function itemName(m) {
  const uuid = m.flags?.dnd5e?.item?.uuid;
  if ( !uuid ) return null;
  try {
    return fromUuidSync(uuid)?.name ?? null;
  } catch ( err ) {
    return null;
  }
}

/**
 * @param {ChatMessage[]} messages  the cards made during the turn, oldest first
 * @param {object} context          {tokenId, ids: {tokenId: battle id}}
 * @returns {object[]} engine log events, each with `sure`
 */
export function readDnd5eTurn(messages, { tokenId, ids = {} } = {}) {
  const events = [];
  for ( const m of messages ) {
    const f = m.flags?.dnd5e;
    if ( !f?.roll || m.speaker?.token !== tokenId ) continue;
    const roll = m.rolls?.[0] ?? null;
    const targets = (f.targets ?? []).map(t => ({ id: ids[tokenIdOf(t.uuid)] ?? null, ac: t.ac })).filter(t => t.id);
    const type = f.roll.type;
    if ( type === "attack" ) {
      const natural = naturalOf(roll);
      const ranged = /^r/.test(String(f.activity?.attack?.type ?? "")) || f.roll?.attackMode === "ranged";
      for ( const t of targets ) {
        const crit = !!roll?.isCritical;
        const fumble = !!roll?.isFumble;
        const hit = !fumble && (crit || (Number.isFinite(t.ac) && Number.isFinite(roll?.total) ? roll.total >= t.ac : true));
        events.push({
          type: "attack", targetId: t.id, action: itemName(m) ?? "", degree: crit ? 3 : hit ? 2 : fumble ? 0 : 1, natural, total: roll?.total ?? null,
          dc: t.ac ?? null, margin: Number.isFinite(t.ac) && Number.isFinite(roll?.total) ? roll.total - t.ac : 0, melee: !ranged, ranged, launched: ranged,
          damage: 0, sure: Number.isFinite(t.ac)
        });
      }
    } else if ( type === "damage" || type === "healing" ) {
      const total = Number(roll?.total) || 0;
      const kind = roll?.options?.type ?? null;
      if ( type === "healing" || kind === "healing" ) {
        for ( const t of targets.length ? targets : [{ id: null }] ) events.push({ type: "heal", targetId: t.id, action: itemName(m) ?? "", amount: total, sure: !!t.id });
        continue;
      }
      for ( const t of targets ) {
        const strike = [...events].reverse().find(e => e.type === "attack" && e.targetId === t.id && e.degree >= 2 && !e.damage);
        if ( strike ) Object.assign(strike, { damage: total, damageType: kind });
        else events.push({ type: "auto", targetId: t.id, action: itemName(m) ?? "", damage: total, damageType: kind, sure: false });
      }
    } else if ( type === "skill" && TALK[f.roll.skillId] ) {
      const t = targets[0]?.id ?? null;
      events.push({ type: "talk", targetId: t, kind: TALK[f.roll.skillId], skill: f.roll.skillId, degree: null, natural: naturalOf(roll), total: roll?.total ?? null, sure: false });
    }
  }
  return events;
}
