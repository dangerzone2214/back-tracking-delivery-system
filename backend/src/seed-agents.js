import { query } from "./db.js";
import { hashPassword, makeSalt } from "./auth.js";

export const agentSeedAccounts = Array.from({ length: 100 }, (_, index) => {
  const number = String(index + 1).padStart(3, "0");
  return {
    username: `agent${number}`,
    password: `BT-2026-Agent${number}!`,
  };
});

export async function seedAgentAccounts() {
  await seedAccount({
    username: process.env.ADMIN_USERNAME || "admin",
    password: process.env.ADMIN_PASSWORD || "Admin-Change-Me-2026!",
    role: "admin",
  });

  if (process.env.AGENT_USERNAME && process.env.AGENT_PASSWORD) {
    await seedAccount({
      username: process.env.AGENT_USERNAME,
      password: process.env.AGENT_PASSWORD,
      role: "agent",
    });
  }

  for (const account of agentSeedAccounts) {
    await seedAccount({ ...account, role: "agent" });
  }
  console.log(`Agent seed complete: ${agentSeedAccounts.length} default accounts checked.`);
}

async function seedAccount({ username, password, role }) {
  const salt = makeSalt();
  const passwordHash = hashPassword(password, salt);
  await query(
    `insert into agent_accounts (username, password_hash, salt, role, active)
     values ($1, $2, $3, $4, true)
     on conflict (username) do nothing`,
    [String(username).toLowerCase(), passwordHash, salt, role]
  );
}
