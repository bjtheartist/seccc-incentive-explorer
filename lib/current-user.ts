import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

export async function getCurrentUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user as
    | (NonNullable<typeof session>["user"] & { id?: string })
    | undefined;
  return user?.id ?? null;
}
