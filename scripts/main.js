/**
 * FastFighting D&D 5e: teaches FastFighting Core how Dungeons & Dragons Fifth Edition works.
 * Registers the dnd5e adapter (actor data, rules, personality defaults, leadership, Make it So) through the
 * core's public API.
 */
import { Dnd5eAdapter } from "./adapter.js";
import { registerLoreBoost } from "./lore.js";

export const MODULE_ID = "fast-fighting-dnd5e";

/** The core API this helper is written against (older cores have no api.version: that is 1). */
const NEEDS_API = 9;

/**
 * The last translation module we knew of for this game system, by language: in a language other than English, this
 * module's settings recommend it when it isn't on (FastFighting Core's api.adviseTranslation).
 */
const KNOWN_TRANSLATIONS = {
  es: { id: "translate-dnd5e-sdr2-es", title: "Translation: DnD5e SRD 5.2 2024 Spanish Translation (Babele)", url: "https://github.com/foundryvtt-sinregistrar/translate-dnd5e-sdr2-es" }
};

Hooks.once("init", () => {
  // How much a Lore-Collector's sizing a foe up pays off (lore.js).
  registerLoreBoost();
});

Hooks.once("fastFighting.init", api => {
  // module.json limits this module to dnd5e worlds; this guard covers anything that slips past.
  if ( game.system.id !== "dnd5e" ) {
    console.warn(`${MODULE_ID} | not a D&D Fifth Edition world (${game.system.id}); FastFighting D&D 5e stays inactive.`);
    return;
  }
  if ( (api.version ?? 1) < NEEDS_API ) {
    console.error(`${MODULE_ID} | FastFighting Core is too old for this version of FastFighting D&D 5e; update it.`);
    ui.notifications?.error(game.i18n.localize("FFDND5E.CoreTooOld"), { permanent: true });
    return;
  }
  api.registerAdapter("dnd5e", Dnd5eAdapter, { priority: 10, source: MODULE_ID });
  api.adviseTranslation?.(MODULE_ID, game.system.title, KNOWN_TRANSLATIONS);
  // Words kept in English for now, while the system isn't translated (hardcoded-toEN.json).
  api.keepEnglish?.(MODULE_ID);
});

Hooks.once("ready", () => {
  if ( !game.modules.get("fast-fighting")?.active && game.user.isGM ) {
    ui.notifications.warn(game.i18n.localize("FFDND5E.NeedsCore"));
  }
});
