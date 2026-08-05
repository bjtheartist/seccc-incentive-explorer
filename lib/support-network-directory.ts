import supportNetworkContactsData from "@/data/curated/support_network_contacts.json";

export type SupportNetworkCoverageRole =
  | "core_local"
  | "citywide_specialist"
  | "regional_option"
  | "verification_needed";

export type SupportNetworkRelationshipStatus =
  | "relationship_unconfirmed"
  | "service_area_check_needed";

export interface SupportNetworkPublicIntake {
  email?: string;
  phone?: string;
  url: string;
}

export interface SupportNetworkKeyContact {
  name: string;
  role: string;
  email?: string;
  phone?: string;
  sourceUrl: string;
}

export interface SupportNetworkOrganization {
  id: string;
  name: string;
  organizationType: string;
  coverageRole: SupportNetworkCoverageRole;
  relationshipStatus: SupportNetworkRelationshipStatus;
  supportLanes: string[];
  geography: string;
  bestFor: string;
  publicIntake: SupportNetworkPublicIntake;
  keyContacts: SupportNetworkKeyContact[];
  chamberNextStep: string;
  lastVerifiedAt: string;
  sourceUrls: string[];
}

export interface SupportNetworkDirectoryData {
  generatedAt: string;
  sourceNote: string;
  organizations: SupportNetworkOrganization[];
}

export const supportNetworkDirectory =
  supportNetworkContactsData as SupportNetworkDirectoryData;
