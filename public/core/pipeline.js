// One entry point that runs every deterministic engine in order. Used by the UI, the tests and the
// evidence builder, so there is exactly one definition of "what the numbers are".

import { computeMetrics } from './metrics.js';
import { prepareForecast, runForecast } from './forecast.js';
import { computeHealth } from './health.js';
import { detectRisks } from './risk.js';
import { matchFinancing } from './financing.js';
import { proposeActions } from './actions.js';
import { withDefaults } from './util.js';

export function analyze(transactions, rawSettings = {}, importStats = null) {
  const settings = withDefaults(rawSettings);
  const metrics = computeMetrics(transactions, settings);
  if (metrics.empty) return { settings, metrics, empty: true };
  const prep = prepareForecast(transactions, metrics, settings);
  const forecast = prep.available ? runForecast(prep) : prep;
  const health = computeHealth(metrics, forecast);
  const risks = detectRisks({ transactions, metrics, prep, forecast, importStats });
  const financing = forecast.available ? matchFinancing(metrics, forecast) : null;
  const actions = proposeActions({ metrics, prep, forecast, risks, financing });
  return { settings, transactions, metrics, prep, forecast, health, risks, financing, actions, empty: false };
}
