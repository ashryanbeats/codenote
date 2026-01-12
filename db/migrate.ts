import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./client.ts";

await migrate(db, { migrationsFolder: "db/migrations" });
await sql.end();

console.log("✅ Migrations applied");
