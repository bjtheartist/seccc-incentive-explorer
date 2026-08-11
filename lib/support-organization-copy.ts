export const SUPPORT_ORGANIZATIONS_SECTION_TITLE =
  "Organizations that may be able to help";

export const SUPPORT_ORGANIZATIONS_SECTION_ID = "support-organizations";

export const LEGACY_SUPPORT_NETWORK_SECTION_TITLE = "Your Support Network";

export const SUPPORT_ORGANIZATIONS_DESCRIPTION =
  "Selected using published service areas, project types, and support services. Confirm current programs and contact options directly with each organization.";

export const SUPPORT_ORGANIZATIONS_CAPACITY_NOTE =
  "A listing in a current official source or a reachable website does not confirm that an organization is accepting new clients.";

export const SUPPORT_ORGANIZATIONS_SOURCE_LABEL =
  "Chicago Small Business Resource Map (source records reviewed)";

export const SUPPORT_ORGANIZATION_AVAILABILITY_LINE =
  "Availability: Current programs, intake capacity, and response times are not confirmed. Confirm directly with the organization.";

export const SUPPORT_VERIFICATION_GUIDE = [
  {
    label: "Listed in a current official source",
    description:
      "The organization appears in a dated government, program, or other official directory. This confirms the listing, not current intake.",
  },
  {
    label: "Official website checked",
    description:
      "The link matched the organization's official website when reviewed. This confirms the destination, not that a program is open.",
  },
  {
    label: "Public intake recently confirmed",
    description:
      "An email, phone number, or intake form was publicly posted when reviewed. This does not confirm that the channel is monitored or that a response is guaranteed.",
  },
  {
    label: "Current capacity not confirmed",
    description:
      "Assume capacity is unknown unless the organization directly confirms it is accepting new clients. Capacity can change faster than public directories.",
  },
] as const;

export function isSupportOrganizationSectionTitle(title: string): boolean {
  return (
    title === SUPPORT_ORGANIZATIONS_SECTION_TITLE ||
    title === LEGACY_SUPPORT_NETWORK_SECTION_TITLE
  );
}
