/**
 * The cards FastFighting rolls in a live battle's turns, whose damage it applies itself (applyDamageCard) or settles by
 * its own sum: rollStrike's and rollDamage's damage cards and the engine's own dice shown as dnd5e's cards
 * (table-cards.js), each marked as its own (flags["fast-fighting-dnd5e"].rolled). On them, dnd5e's damage tray and its
 * Apply entries in the chat's menu (Apply Damage, Healing, Double, Half ...), which would apply the damage a second
 * time, are gone for everyone; and on a save card of the engine's own dice, the Resist and Break Concentration buttons,
 * which would spend a Legendary Resistance or end a concentration the engine has already decided. The mark counts only
 * on a card a GM made: anyone may put any flag on their own card. A card whose damage the live battle applied itself,
 * whoever made it (a player's card applied for them), loses its tray too in the browser of the GM who plays the battle:
 * by the ids the core noted as it applied them (its damageApplied), never by the card's flags. A card the table settles
 * itself after all (the core's leaveToTable, API 21) loses its mark (unmarkRolled), its tray back.
 */
import { damageApplied } from "./core.js";
import { t } from "./words.js";

/** This module's id: its flags' scope. */
export const HELPER_ID = "fast-fighting-dnd5e";

/** The mark, as a card's message data carries it as the card is made: a fresh one each time (Foundry cleans it in place). */
export const rolledFlags = () => ({ [HELPER_ID]: { rolled: { times: 1 } } });

/** dnd5e's trays, which apply a card's damage or effects. */
const TRAYS = "damage-application, effect-application";
/** dnd5e's buttons on a save card that change the sheet. */
const SAVE_BUTTONS = '[data-action="resistSave"], [data-action="breakConcentration"]';

/**
 * A card of FastFighting's it won't apply after all, the table settling it (the core's leaveToTable, API 21): its mark
 * off, so its tray and menu entries are back for everyone. Only its own mark, on a card a GM made.
 */
export async function unmarkRolled(message) {
  if ( !rolledHere(message) || typeof message?.unsetFlag !== "function" ) return;
  await message.unsetFlag(HELPER_ID, "rolled");
}

/** Is this card one FastFighting rolled for a turn it plays? Its mark, on a card a GM made; a player's card is theirs. */
export const rolledHere = message => !!message?.flags?.[HELPER_ID]?.rolled && !!message?.author?.isGM;

/** Is FastFighting's the say on this card's damage: its own mark on a GM's card, or a card the live battle applied? */
export const handled = message => rolledHere(message) || damageApplied(message);

/**
 * A card of FastFighting's, rendered (renderChatMessageHTML, and dnd5e.renderChatMessage once dnd5e has added its
 * trays): its trays gone, a line saying FastFighting does it in the first one's place (the trays themselves, not their
 * insides: dnd5e's fill themselves in once they're on the page); on a save card of its own, no Resist or Break
 * Concentration.
 */
export function hideApply(message, html) {
  if ( !handled(message) ) return;
  const trays = [...(html?.querySelectorAll?.(TRAYS) ?? [])];
  trays.forEach((tray, i) => {
    const note = i === 0 && globalThis.document ? Object.assign(globalThis.document.createElement("span"), { textContent: t("DamageHandled") }) : null;
    if ( note ) tray.replaceWith(note);
    else tray.remove();
  });
  if ( rolledHere(message) ) for ( const button of html?.querySelectorAll?.(SAVE_BUTTONS) ?? [] ) button.remove();
}

/** The chat's menu (getChatMessageContextOptions): dnd5e's Apply entries not on a card of FastFighting's. */
export function hideApplyMenu(app, options) {
  for ( const entry of Array.isArray(options) ? options : [] ) {
    if ( entry?.group !== "damage" || typeof entry.label !== "string" || !entry.label.startsWith("DND5E.ChatContext") || typeof entry.visible !== "function" ) continue;
    const visible = entry.visible;
    entry.visible = li => !handled(globalThis.game?.messages?.get?.(li?.dataset?.messageId)) && visible(li);
  }
}
