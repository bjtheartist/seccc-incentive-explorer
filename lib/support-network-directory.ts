import supportNetworkContactsData from "@/data/curated/support_network_contacts.json";
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const httpsUrl = z.string().url().startsWith("https://");

const supportNetworkDirectorySchema = z.object({
  generatedAt: isoDate,
  sourceNote: z.string().min(1),
  organizations: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      organizationType: z.string().min(1),
      coverageRole: z.enum([
        "core_local",
        "citywide_specialist",
        "regional_option",
        "verification_needed",
      ]),
      supportLanes: z.array(z.string().min(1)).min(1),
      geography: z.string().min(1),
      bestFor: z.string().min(1),
      publicIntake: z.object({
        email: z.string().email().optional(),
        phone: z.string().min(1).optional(),
        url: httpsUrl,
      }).strict(),
      keyContacts: z.array(
        z.object({
          name: z.string().min(1),
          role: z.string().min(1),
          sourceUrl: httpsUrl,
        }).strict(),
      ),
      lastVerifiedAt: isoDate,
      sourceUrls: z.array(httpsUrl).min(1),
    }).strict(),
  ),
}).strict();

export type SupportNetworkDirectoryData = z.infer<typeof supportNetworkDirectorySchema>;
export type SupportNetworkOrganization = SupportNetworkDirectoryData["organizations"][number];
export type SupportNetworkCoverageRole = SupportNetworkOrganization["coverageRole"];

export const supportNetworkDirectory =
  supportNetworkDirectorySchema.parse(supportNetworkContactsData);
