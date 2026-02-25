/**
 * Shared party list for NPC submissions across Parliament pages.
 * 14 parties — mirrors CONSTITUENCY_PARTIES minus Speaker.
 */
export const NPC_SUBMISSION_PARTIES = [
  "Conservative",
  "Labour",
  "Liberal Democrat",
  "SNP",
  "Plaid Cymru",
  "Green",
  "UKIP",
  "DUP",
  "Sinn Féin",
  "SDLP",
  "Alliance",
  "UUP",
  "TUP",
  "Independents",
];

/**
 * Returns an HTML string of <option> elements for NPC party dropdowns.
 */
export function npcPartyOptions() {
  return NPC_SUBMISSION_PARTIES.map((p) => `<option value="${p}">${p}</option>`).join("");
}
