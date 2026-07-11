import crypto from "node:crypto";
import { query } from "./db.js";

const tokenTtlMs = 1000 * 60 * 60 * 12;

export function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
}

export function makeSalt() {
  return crypto.randomBytes(16).toString("hex");
}

export function verifyPassword(password, salt, expectedHash) {
  const actual = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expectedHash, "hex"));
}

export function createToken(user) {
  const secret = process.env.AUTH_SECRET || "change-this-render-auth-secret";
  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    exp: Date.now() + tokenTtlMs,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyToken(token) {
  const secret = process.env.AUTH_SECRET || "change-this-render-auth-secret";
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

export async function requireAgentAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Agent login required." });

  const result = await query("select id, username, role, active from agent_accounts where id = $1", [payload.id]);
  const user = result.rows[0];
  if (!user?.active) return res.status(401).json({ error: "Agent account is pending admin approval." });
  req.user = user;
  next();
}

export async function requireAdminAuth(req, res, next) {
  await requireAgentAuth(req, res, () => {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ error: "Admin access required." });
    }
    next();
  });
}
