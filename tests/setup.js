/**
 * Every test runs as a Foundry client in English would: game.i18n reads this module's languages/en.json and
 * FastFighting Core's, fresh for each test (a test may add to globalThis.game, or replace it, as it needs); and the
 * words items are read by are reading/en.json's, as Foundry would fetch them (a test may set others: setReading).
 */
import fs from "node:fs";
import { beforeEach } from "vitest";
import { fakeI18n } from "./foundry-i18n.js";
import { setReading } from "../scripts/reading.js";

const READING = JSON.parse(fs.readFileSync(new URL("../reading/en.json", import.meta.url), "utf8"));

const install = () => {
  globalThis.game = { i18n: fakeI18n() };
  setReading(READING);
};
install();
beforeEach(install);
