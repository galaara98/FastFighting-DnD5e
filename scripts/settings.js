/**
 * This module's own world settings, shown at the foot of FastFighting's settings under its name (the core's, API 28):
 *   homebrewDelay  a house rule, off by default: a creature may Delay its turn, coming back at the end of the round with
 *                  its initiative last from then on (rules.js dnd5eRulesWith). Neither SRD has Delay.
 * And the Lore-Collector's advantage, once this module's own (fast-fighting-dnd5e.loreBoost), now the core's: a value a
 * GM set here goes to the core's, once (moveLoreBoost).
 */
export const MODULE_ID = "fast-fighting-dnd5e";

/** Register the settings (on init). */
export function registerSettings() {
  game.settings.register(MODULE_ID, "homebrewDelay", {
    name: "FFDND5E.Settings.homebrewDelay.Name",
    hint: "FFDND5E.Settings.homebrewDelay.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
}

/** Is the homebrew Delay on in this world? False where it can't be read. */
export function homebrewDelay() {
  try {
    return !!globalThis.game?.settings?.get(MODULE_ID, "homebrewDelay");
  } catch ( err ) {
    return false;
  }
}

/**
 * The Lore-Collector's advantage was this module's own setting until the core's took its place (core API 28): a value
 * a GM set here goes to the core's, once, where the core's has none of its own yet. Temporary: remove it a few
 * releases on, as FastFighting PF2e did.
 */
export function moveLoreBoost() {
  if ( !game.user?.isGM ) return;
  const world = game.settings.storage?.get?.("world");
  const ours = world?.getSetting?.(`${MODULE_ID}.loreBoost`);
  if ( !ours || world.getSetting("fast-fighting.loreBoost") ) return;
  const value = Number(ours.value);
  if ( Number.isFinite(value) ) game.settings.set("fast-fighting", "loreBoost", value);
}
