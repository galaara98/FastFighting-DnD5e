/**
 * A player's turn in a live battle, read from the chat cards dnd5e made for it: what FastFighting's engine would have
 * logged, so the turn is told like any other. dnd5e 6 says what a card is by its type ("attack", "damage", "check")
 * and keeps the rest in its system data (the activity, the item, the targets with their AC); earlier versions kept it
 * all in flags.dnd5e (roll.type, targets, activity, item). Both are read.
 *   - An attack roll: at whom, with what, a hit (against the target's AC), a critical or a miss; its damage roll's damage
 *     (the sheets settle how much).
 *   - Persuasion, Intimidation or Deception: words, for the GM to confirm (at whom and how well).
 *   - Healing: told as healing (the sheets say how much).
 * Each event says whether it's `sure`.
 */

/** A skill rolled at someone that is words, and which (dnd5e skill ids). */
const TALK = { per: "persuade", itm: "intimidate", dec: "deceive" };

const tokenIdOf = uuid => (typeof uuid === "string" && uuid.includes("Token.") ? uuid.split("Token.").pop().split(".")[0] : null);

/** The natural d20 of a roll, where it shows. */
function naturalOf(roll) {
  const d20 = roll?.dice?.find?.(d => d.faces === 20);
  return d20?.total ?? null;
}

/** A document by its uuid, where it's at hand (null in tests, or for one that's gone). */
function lookUp(uuid) {
  if ( !uuid || typeof globalThis.fromUuidSync !== "function" ) return null;
  try {
    return globalThis.fromUuidSync(uuid) ?? null;
  } catch ( err ) {
    return null;
  }
}

/**
 * What a card is, whichever way dnd5e wrote it: {type: "attack"|"damage"|"healing"|"skill", skill, targets: [{uuid,
 * ac}], item (its name), ranged, launched (a shot from a weapon: not a spell, nor a thrown one)}, or null for a card
 * that's none of those.
 */
export function cardOf(m) {
  const roll = m.rolls?.[0] ?? null;
  const f = m.flags?.dnd5e;
  if ( f?.roll ) {
    const ranged = /^r/.test(String(f.activity?.attack?.type ?? "")) || f.roll?.attackMode === "ranged";
    const item = lookUp(f.item?.uuid);
    return {
      type: f.roll.type, skill: f.roll.skillId ?? null, targets: (f.targets ?? []).map(t => ({ uuid: t.uuid, ac: t.ac })),
      item: item?.name ?? null, ranged, launched: ranged && (f.item?.type ?? item?.type) === "weapon" && f.roll?.attackMode !== "thrown", kind: roll?.options?.type ?? null
    };
  }
  const s = m.system;
  const rolled = roll?.options?.rollType ?? m.type;
  if ( !s || !["attack", "damage", "healing", "check", "skill"].includes(rolled) ) return null;
  const activity = lookUp(s.activity?.uuid);
  const attackType = String(activity?.attack?.type?.value ?? activity?.attack?.type ?? "");
  const type = rolled === "check" ? (s.skill ? "skill" : null) : rolled;
  if ( !type ) return null;
  const ranged = /^r/.test(attackType) || roll?.options?.attackMode === "ranged";
  return {
    type, skill: s.skill ?? null, targets: (s.targets ?? []).map(t => ({ uuid: t.token ?? t.actor ?? t.uuid, ac: t.ac })),
    item: s.item?.name ?? null, ranged, launched: ranged && s.item?.type === "weapon" && roll?.options?.attackMode !== "thrown", kind: roll?.options?.type ?? null
  };
}

/**
 * @param {ChatMessage[]} messages  the cards made during the turn, oldest first
 * @param {object} context          {tokenId, ids: {tokenId: battle id}}
 * @returns {object[]} engine log events, each with `sure`
 */
export function readDnd5eTurn(messages, { tokenId, ids = {} } = {}) {
  const events = [];
  for ( const m of messages ) {
    if ( m.speaker?.token !== tokenId ) continue;
    const card = cardOf(m);
    if ( !card ) continue;
    const roll = m.rolls?.[0] ?? null;
    const targets = card.targets.map(t => ({ id: ids[tokenIdOf(t.uuid)] ?? null, ac: t.ac })).filter(t => t.id);
    if ( card.type === "attack" ) {
      const natural = naturalOf(roll);
      for ( const t of targets ) {
        const crit = !!roll?.isCritical;
        const fumble = !!roll?.isFumble;
        const hit = !fumble && (crit || (Number.isFinite(t.ac) && Number.isFinite(roll?.total) ? roll.total >= t.ac : true));
        events.push({
          type: "attack", targetId: t.id, action: card.item ?? "", degree: crit ? 3 : hit ? 2 : fumble ? 0 : 1, natural, total: roll?.total ?? null,
          dc: t.ac ?? null, margin: Number.isFinite(t.ac) && Number.isFinite(roll?.total) ? roll.total - t.ac : 0, melee: !card.ranged, ranged: card.ranged,
          launched: card.launched, damage: 0, sure: Number.isFinite(t.ac)
        });
      }
    } else if ( card.type === "damage" || card.type === "healing" ) {
      const total = Number(roll?.total) || 0;
      if ( card.type === "healing" || card.kind === "healing" ) {
        for ( const t of targets.length ? targets : [{ id: null }] ) events.push({ type: "heal", targetId: t.id, action: card.item ?? "", amount: total, sure: !!t.id });
        continue;
      }
      for ( const t of targets ) {
        const strike = [...events].reverse().find(e => e.type === "attack" && e.targetId === t.id && e.degree >= 2 && !e.damage);
        if ( strike ) Object.assign(strike, { damage: total, damageType: card.kind });
        else events.push({ type: "auto", targetId: t.id, action: card.item ?? "", damage: total, damageType: card.kind, sure: false });
      }
    } else if ( card.type === "skill" && TALK[card.skill] ) {
      events.push({ type: "talk", targetId: targets[0]?.id ?? null, kind: TALK[card.skill], skill: card.skill, degree: null, natural: naturalOf(roll), total: roll?.total ?? null, sure: false });
    }
  }
  return events;
}
