import { saveState } from "../core.js";

function ensureBucket(data, key, fallback) {
  data[key] ??= fallback;
  return data[key];
}

export function updateParliamentState(data, patch = {}) {
  const p = ensureBucket(data, "parliament", {});
  Object.assign(p, patch);
  saveState(data);
}

export function updateEconomyState(data, patch = {}) {
  const e = ensureBucket(data, "economyPage", {});
  Object.assign(e, patch);
  saveState(data);
}

export function updateRolesForAccount(data, username, patch = {}) {
  data.userManagement ??= {};
  data.userManagement.accounts ??= [];
  const acc = data.userManagement.accounts.find((a) => String(a.username) === String(username));
  if (!acc) return false;
  Object.assign(acc, patch);
  saveState(data);
  return true;
}

export function updateGovernmentOffices(data, offices = []) {
  data.government ??= {};
  data.government.offices = Array.isArray(offices) ? offices : [];
  saveState(data);
}

export function updateOppositionOffices(data, offices = []) {
  data.opposition ??= {};
  data.opposition.offices = Array.isArray(offices) ? offices : [];
  saveState(data);
}

export function updateBudgetControls(data, patch = {}) {
  data.budget ??= {};
  data.budget.adminControls ??= {};
  Object.assign(data.budget.adminControls, patch);
  saveState(data);
}

export function postPoll(data, pollRecord) {
  data.polling ??= {};
  data.polling.polls ??= [];
  data.polling.polls.unshift(pollRecord);
  saveState(data);
}
