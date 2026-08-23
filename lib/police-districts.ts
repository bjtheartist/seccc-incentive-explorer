/**
 * Chicago Police District names — standard, stable public nomenclature
 * (the same names CPD's own materials and news coverage use), keyed by the
 * district number the City's live boundary layer returns
 * (lib/district-lookup.ts `queryPoliceDistrict`). Chicago currently
 * operates 22 geographic patrol districts; districts 13, 21, and 23 were
 * retired in the 2012 consolidation and never reused.
 */
export const POLICE_DISTRICT_NAMES: Record<string, string> = {
  "1": "Central",
  "2": "Wentworth",
  "3": "Grand Crossing",
  "4": "South Chicago",
  "5": "Calumet",
  "6": "Gresham",
  "7": "Englewood",
  "8": "Chicago Lawn",
  "9": "Deering",
  "10": "Ogden",
  "11": "Harrison",
  "12": "Near West",
  "14": "Shakespeare",
  "15": "Austin",
  "16": "Jefferson Park",
  "17": "Albany Park",
  "18": "Near North",
  "19": "Town Hall",
  "20": "Lincoln",
  "22": "Morgan Park",
  "24": "Rogers Park",
  "25": "Grand Central",
};

/** "6th (Gresham)" — falls back to the bare ordinal when the district
 *  number isn't in the known set (a boundary-layer change ahead of this
 *  list, never a guess). */
export function policeDistrictLabel(districtNumber: string): string {
  const name = POLICE_DISTRICT_NAMES[districtNumber];
  const ordinal = `${districtNumber}${ordinalSuffix(districtNumber)}`;
  return name ? `${ordinal} (${name})` : ordinal;
}

function ordinalSuffix(value: string): string {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return "";
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}
