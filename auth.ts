import type { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import NeonAdapter from "@auth/neon-adapter";
import { Pool } from "@neondatabase/serverless";
import { normalizeEmail, verifyPassword } from "@/lib/password";

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

export const authOptions: NextAuthOptions = {
  adapter: pool ? (NeonAdapter(pool) as Adapter) : undefined,
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "missing-google-client-id",
      clientSecret:
        process.env.GOOGLE_CLIENT_SECRET || "missing-google-client-secret",
    }),
    CredentialsProvider({
      id: "credentials",
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!pool || !credentials?.email || !credentials.password) {
          return null;
        }

        const email = normalizeEmail(credentials.email);
        const result = await pool.query(
          `SELECT id, name, email, image, password_hash
           FROM users
           WHERE lower(email) = $1
           LIMIT 1`,
          [email]
        );
        const user = result.rows[0];
        if (!user?.password_hash) return null;

        const valid = await verifyPassword(
          credentials.password,
          user.password_hash
        );
        if (!valid) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    session({ session, user, token }) {
      if (session.user) {
        (session.user as typeof session.user & { id?: string }).id =
          user?.id || token.sub;
      }
      return session;
    },
  },
};
