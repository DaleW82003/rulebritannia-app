#!/usr/bin/env node
/**
 * scripts/convert-1997-csv.js
 *
 * Legacy compatibility entrypoint for the default 1997 scenario. The reusable
 * converter now lives in scripts/convert-scenario-csv.js.
 *
 * Usage:
 *   node scripts/convert-1997-csv.js
 */

import { convertScenarioCsvToConstituencies } from "./convert-scenario-csv.js";

convertScenarioCsvToConstituencies("1997");
