/**
 * Cook County building class code interpreter.
 *
 * Class codes use a digit-based system where the first digit indicates
 * property type:
 *   1xx = Vacant land
 *   2xx = Residential (1-6 units)
 *   3xx = Multi-unit residential (7+ units)
 *   5xx = Commercial / Mixed-use
 *   6xx = Industrial
 */

/** Common Cook County class codes and descriptions. */
export const CLASS_CODE_MAP: Record<string, string> = {
  // Vacant land
  "1-00": "Vacant land (unimproved)",
  "1-03": "Vacant land — residential area",
  "1-10": "Vacant land — commercial area",
  "1-11": "Vacant land — industrial area",
  "1-12": "Vacant land — railroad right-of-way",
  // Residential
  "2-02": "Single-family detached — one story, up to 1,000 sq ft",
  "2-03": "Single-family detached — one story, 1,001-1,500 sq ft",
  "2-04": "Single-family detached — one story, 1,501+ sq ft",
  "2-05": "Single-family detached — A-frame or contemporary",
  "2-06": "Single-family detached — two story, up to 2,200 sq ft",
  "2-07": "Single-family detached — two story, 2,201+ sq ft",
  "2-08": "Single-family detached — split-level",
  "2-09": "Single-family detached — old style/row",
  "2-10": "Two-family residence",
  "2-11": "Three-unit apartment building",
  "2-12": "Mixed-use (primarily residential)",
  "2-34": "Condominium unit — residential",
  "2-78": "Multi-unit (4-6 units)",
  "2-95": "Townhouse / row house",
  // Multi-unit residential (7+)
  "3-11": "Apartment building — 7 to 13 units",
  "3-13": "Apartment building — 14 to 29 units",
  "3-15": "Apartment building — 30 to 69 units",
  "3-18": "Apartment building — 70 to 99 units",
  "3-19": "Apartment building — 100+ units",
  "3-90": "Cooperative apartment building",
  // Commercial
  "5-00": "Commercial building (general)",
  "5-03": "Commercial building — one story",
  "5-04": "Commercial building — two story",
  "5-09": "Commercial building — three+ stories",
  "5-11": "Commercial office building — one story",
  "5-12": "Commercial office building — two story",
  "5-13": "Commercial office building — three+ stories",
  "5-16": "Mixed-use commercial/residential",
  "5-17": "One-story commercial building",
  "5-18": "Two-story commercial building",
  "5-50": "Hotel / motel",
  "5-90": "Parking garage — commercial",
  "5-91": "Parking lot — commercial",
  "5-92": "Shopping center / strip mall",
  // Industrial
  "6-00": "Industrial building (general)",
  "6-01": "Light industrial building",
  "6-03": "Heavy industrial building",
  "6-10": "Warehouse / distribution center",
  "6-11": "Manufacturing building",
  "6-12": "Manufacturing / warehouse combination",
  "6-22": "Industrial loft building",
  "6-30": "Food processing plant",
  "6-50": "Industrial office / lab",
};

/**
 * Return a human-readable description for a Cook County class code.
 * Falls back to a generic description based on the first digit.
 */
export function describeClassCode(code: string): string {
  const exact = CLASS_CODE_MAP[code];
  if (exact) return exact;

  // Fallback by first digit
  const first = code.charAt(0);
  switch (first) {
    case "1":
      return "Vacant land";
    case "2":
      return "Residential property";
    case "3":
      return "Multi-unit residential (7+ units)";
    case "5":
      return "Commercial / mixed-use property";
    case "6":
      return "Industrial property";
    default:
      return `Property class ${code}`;
  }
}

/** Return a human-readable label for Cook County parcel type codes. */
export function describeParcelType(type: number): string {
  switch (type) {
    case 1: return "Condo";
    default: return "Standard";
  }
}

/** Code starts with "5" — commercial / mixed-use. */
export function isCommercialClass(code: string): boolean {
  return code.startsWith("5");
}

/** Code starts with "6" — industrial. */
export function isIndustrialClass(code: string): boolean {
  return code.startsWith("6");
}

/** Code starts with "1" — vacant land. */
export function isVacantClass(code: string): boolean {
  return code.startsWith("1");
}

/**
 * Determine if a class code is potentially eligible for Class 7a/7b
 * assessment reduction.
 *
 * Eligible classes: commercial (5xx) and some multi-unit residential (3xx)
 * that are used in commercial rehab projects.
 */
export function isClass7aEligible(code: string): boolean {
  return code.startsWith("5") || code.startsWith("3");
}
