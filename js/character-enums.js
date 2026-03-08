// js/character-enums.js
// Shared fallback arrays for character profile dropdowns.
// The server provides the canonical lists via the /api/enums endpoint; these
// arrays are used as client-side fallbacks when the API response is unavailable.

export const DEFAULT_EDUCATION_OPTIONS = [
  "No Qualifications", "GCSEs", "A Levels", "Certificate of HE", "Diploma",
  "Bachelors Degree", "Masters Degree", "Doctorate",
];

export const DEFAULT_CAREER_OPTIONS = [
  "Manual / Skilled Trade", "Public Sector Professional", "Legal Profession",
  "Finance / Banking / Corporate", "Business Owner / Entrepreneur",
  "Political Staffer / Researcher", "Trade Union / Activist",
  "Media / Journalism / Communications", "Academia / Education Leadership",
  "Military / Police / Security",
];

export const DEFAULT_FAMILY_OPTIONS = [
  "Single", "Married, No Children", "Married with Children", "Civil Partnership",
  "Divorced", "Divorced with Children", "Widowed",
  "Long-Term Partner with Children", "Long-Term Partner, No Children",
];

/** Resolve education options from a server-provided enums object, falling back to defaults. */
export function getEducationOptions(enums) {
  return (enums && enums.educationOptions) ? enums.educationOptions : DEFAULT_EDUCATION_OPTIONS;
}

/** Resolve career options from a server-provided enums object, falling back to defaults. */
export function getCareerOptions(enums) {
  return (enums && enums.careerOptions) ? enums.careerOptions : DEFAULT_CAREER_OPTIONS;
}

/** Resolve family options from a server-provided enums object, falling back to defaults. */
export function getFamilyOptions(enums) {
  return (enums && enums.familyOptions) ? enums.familyOptions : DEFAULT_FAMILY_OPTIONS;
}
