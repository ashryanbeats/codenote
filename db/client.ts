import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const url = Deno.env.get("DATABASE_URL");
if (!url) throw new Error("DATABASE_URL is not set");

export const sql = postgres(url, {
  // Keep this simple for now; tune later.
  max: 10,
});

export const db = drizzle(sql);
