import pg from "pg";
import fs from "node:fs/promises";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL in .env.setup");
const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: true },
  connectionTimeoutMillis: 8000,
});
try {
  await client.connect();
  if (process.argv.includes("--inspect")) {
    console.log(
      (
        await client.query(
          "select tablename from pg_tables where schemaname='public'",
        )
      ).rows,
    );
  } else {
    for (const file of (await fs.readdir("supabase/migrations"))
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      await client.query(
        await fs.readFile(`supabase/migrations/${file}`, "utf8"),
      );
      console.log(`Applied ${file}`);
    }
  }
} catch (error) {
  console.error("Database setup failed:", error.code || error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
