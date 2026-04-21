import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { encryptString, decryptString } from "../lib/crypto";

const router: IRouter = Router();

async function getOrCreateSettings() {
  const rows = await db.select().from(settingsTable).limit(1);
  let row = rows[0];
  if (!row) {
    [row] = await db.insert(settingsTable).values({}).returning();
  }
  // Return decrypted token to callers
  return { ...row, token: decryptString(row.token) };
}

router.get("/settings", async (_req, res): Promise<void> => {
  const s = await getOrCreateSettings();
  res.json({
    hasToken: !!s.token,
    isSandbox: s.isSandbox,
    accountId: s.accountId,
    maxOrderAmount: s.maxOrderAmount,
    riskPercent: s.riskPercent,
    agentIntervalMinutes: s.agentIntervalMinutes,
  });
});

router.put("/settings", async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const s = await getOrCreateSettings();
  const update: Partial<typeof settingsTable.$inferInsert> = {};

  if (parsed.data.token != null) update.token = encryptString(parsed.data.token);
  if (parsed.data.isSandbox != null) update.isSandbox = parsed.data.isSandbox;
  if (parsed.data.accountId != null) update.accountId = parsed.data.accountId;
  if (parsed.data.maxOrderAmount != null) update.maxOrderAmount = parsed.data.maxOrderAmount;
  if (parsed.data.riskPercent != null) update.riskPercent = parsed.data.riskPercent;
  if (parsed.data.agentIntervalMinutes != null) update.agentIntervalMinutes = parsed.data.agentIntervalMinutes;

  const [updated] = await db.update(settingsTable).set(update).returning();
  const final = updated ?? { ...s, token: s.token ? encryptString(s.token) : null };

  res.json({
    hasToken: !!final.token,
    isSandbox: final.isSandbox,
    accountId: final.accountId,
    maxOrderAmount: final.maxOrderAmount,
    riskPercent: final.riskPercent,
    agentIntervalMinutes: final.agentIntervalMinutes,
  });
});

export { getOrCreateSettings };
export default router;
