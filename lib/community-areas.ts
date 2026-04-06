/**
 * Chicago's 77 official community areas with approximate centroid coordinates.
 * Source: City of Chicago Data Portal — Community Area boundaries.
 * Centroids are representative points for zone checks and census lookups.
 */

export interface CommunityArea {
  id: number;
  name: string;
  lat: number;
  lon: number;
}

export const CHICAGO_COMMUNITY_AREAS: CommunityArea[] = [
  { id: 1, name: "Rogers Park", lat: 42.0087, lon: -87.6676 },
  { id: 2, name: "West Ridge", lat: 41.9981, lon: -87.6907 },
  { id: 3, name: "Uptown", lat: 41.9664, lon: -87.6536 },
  { id: 4, name: "Lincoln Square", lat: 41.9688, lon: -87.6893 },
  { id: 5, name: "North Center", lat: 41.9541, lon: -87.6788 },
  { id: 6, name: "Lake View", lat: 41.9434, lon: -87.6530 },
  { id: 7, name: "Lincoln Park", lat: 41.9214, lon: -87.6513 },
  { id: 8, name: "Near North Side", lat: 41.9000, lon: -87.6345 },
  { id: 9, name: "Edison Park", lat: 42.0084, lon: -87.8136 },
  { id: 10, name: "Norwood Park", lat: 41.9862, lon: -87.8006 },
  { id: 11, name: "Jefferson Park", lat: 41.9703, lon: -87.7604 },
  { id: 12, name: "Forest Glen", lat: 41.9782, lon: -87.7456 },
  { id: 13, name: "North Park", lat: 41.9731, lon: -87.7257 },
  { id: 14, name: "Albany Park", lat: 41.9680, lon: -87.7230 },
  { id: 15, name: "Portage Park", lat: 41.9580, lon: -87.7650 },
  { id: 16, name: "Irving Park", lat: 41.9530, lon: -87.7240 },
  { id: 17, name: "Dunning", lat: 41.9470, lon: -87.8090 },
  { id: 18, name: "Montclare", lat: 41.9290, lon: -87.8040 },
  { id: 19, name: "Belmont Cragin", lat: 41.9310, lon: -87.7680 },
  { id: 20, name: "Hermosa", lat: 41.9180, lon: -87.7370 },
  { id: 21, name: "Avondale", lat: 41.9390, lon: -87.7110 },
  { id: 22, name: "Logan Square", lat: 41.9230, lon: -87.7080 },
  { id: 23, name: "Humboldt Park", lat: 41.9020, lon: -87.7220 },
  { id: 24, name: "West Town", lat: 41.9010, lon: -87.6840 },
  { id: 25, name: "Austin", lat: 41.8930, lon: -87.7650 },
  { id: 26, name: "West Garfield Park", lat: 41.8810, lon: -87.7290 },
  { id: 27, name: "East Garfield Park", lat: 41.8810, lon: -87.7050 },
  { id: 28, name: "Near West Side", lat: 41.8810, lon: -87.6640 },
  { id: 29, name: "North Lawndale", lat: 41.8610, lon: -87.7190 },
  { id: 30, name: "South Lawndale", lat: 41.8430, lon: -87.7120 },
  { id: 31, name: "Lower West Side", lat: 41.8530, lon: -87.6680 },
  { id: 32, name: "Loop", lat: 41.8820, lon: -87.6320 },
  { id: 33, name: "Near South Side", lat: 41.8570, lon: -87.6320 },
  { id: 34, name: "Armour Square", lat: 41.8430, lon: -87.6340 },
  { id: 35, name: "Douglas", lat: 41.8350, lon: -87.6170 },
  { id: 36, name: "Oakland", lat: 41.8230, lon: -87.6050 },
  { id: 37, name: "Fuller Park", lat: 41.8220, lon: -87.6320 },
  { id: 38, name: "Grand Boulevard", lat: 41.8130, lon: -87.6170 },
  { id: 39, name: "Kenwood", lat: 41.8090, lon: -87.5980 },
  { id: 40, name: "Washington Park", lat: 41.7930, lon: -87.6160 },
  { id: 41, name: "Hyde Park", lat: 41.7940, lon: -87.5910 },
  { id: 42, name: "Woodlawn", lat: 41.7810, lon: -87.5990 },
  { id: 43, name: "South Shore", lat: 41.7620, lon: -87.5780 },
  { id: 44, name: "Chatham", lat: 41.7410, lon: -87.6120 },
  { id: 45, name: "Avalon Park", lat: 41.7450, lon: -87.5880 },
  { id: 46, name: "South Chicago", lat: 41.7390, lon: -87.5560 },
  { id: 47, name: "Burnside", lat: 41.7330, lon: -87.6040 },
  { id: 48, name: "Calumet Heights", lat: 41.7280, lon: -87.5790 },
  { id: 49, name: "Roseland", lat: 41.7140, lon: -87.6250 },
  { id: 50, name: "Pullman", lat: 41.7090, lon: -87.6070 },
  { id: 51, name: "South Deering", lat: 41.7020, lon: -87.5670 },
  { id: 52, name: "East Side", lat: 41.7070, lon: -87.5370 },
  { id: 53, name: "West Pullman", lat: 41.6880, lon: -87.6340 },
  { id: 54, name: "Riverdale", lat: 41.6510, lon: -87.6300 },
  { id: 55, name: "Hegewisch", lat: 41.6550, lon: -87.5540 },
  { id: 56, name: "Garfield Ridge", lat: 41.7950, lon: -87.7680 },
  { id: 57, name: "Archer Heights", lat: 41.8100, lon: -87.7310 },
  { id: 58, name: "Brighton Park", lat: 41.8190, lon: -87.6990 },
  { id: 59, name: "McKinley Park", lat: 41.8310, lon: -87.6760 },
  { id: 60, name: "Bridgeport", lat: 41.8380, lon: -87.6510 },
  { id: 61, name: "New City", lat: 41.8100, lon: -87.6590 },
  { id: 62, name: "West Elsdon", lat: 41.7940, lon: -87.7250 },
  { id: 63, name: "Gage Park", lat: 41.7950, lon: -87.6960 },
  { id: 64, name: "Clearing", lat: 41.7810, lon: -87.7640 },
  { id: 65, name: "West Lawn", lat: 41.7740, lon: -87.7230 },
  { id: 66, name: "Chicago Lawn", lat: 41.7700, lon: -87.6940 },
  { id: 67, name: "West Englewood", lat: 41.7780, lon: -87.6680 },
  { id: 68, name: "Englewood", lat: 41.7790, lon: -87.6440 },
  { id: 69, name: "Greater Grand Crossing", lat: 41.7610, lon: -87.6170 },
  { id: 70, name: "Ashburn", lat: 41.7470, lon: -87.7130 },
  { id: 71, name: "Auburn Gresham", lat: 41.7430, lon: -87.6570 },
  { id: 72, name: "Beverly", lat: 41.7190, lon: -87.6730 },
  { id: 73, name: "Washington Heights", lat: 41.7210, lon: -87.6510 },
  { id: 74, name: "Mount Greenwood", lat: 41.6990, lon: -87.7080 },
  { id: 75, name: "Morgan Park", lat: 41.6910, lon: -87.6680 },
  { id: 76, name: "O'Hare", lat: 41.9790, lon: -87.8580 },
  { id: 77, name: "Edgewater", lat: 41.9840, lon: -87.6600 },
];

/** Find a community area by name (case-insensitive partial match) */
export function findCommunityArea(query: string): CommunityArea | undefined {
  const q = query.toLowerCase().trim();
  return CHICAGO_COMMUNITY_AREAS.find(
    (ca) => ca.name.toLowerCase() === q
  ) || CHICAGO_COMMUNITY_AREAS.find(
    (ca) => ca.name.toLowerCase().includes(q)
  );
}
