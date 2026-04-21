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
  return { ...row, token: decryptString(row.token) };
}

function publicView(s: Awaited<ReturnType<typeof getOrCreateSettings>>) {
  return {
    hasToken: !!s.token,
    isSandbox: s.isSandbox,
    accountId: s.accountId,
    maxOrderAmount: s.maxOrderAmount,
    riskPercent: s.riskPercent,
    agentIntervalMinutes: s.agentIntervalMinutes,
    paperMode: s.paperMode,
    confidenceThreshold: s.confidenceThreshold,
    stopLossPercent: s.stopLossPercent,
    takeProfitPercent: s.takeProfitPercent,
    dailyLossLimitRub: s.dailyLossLimitRub,
    maxTradesPerDay: s.maxTradesPerDay,
    priceLimitPercent: s.priceLimitPercent,
  };
}

router.get("/settings", async (_req, res): Promise<void> => {
  const s = await getOrCreateSettings();
  res.json(publicView(s));
});

router.put("/settings", async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await getOrCreateSettings();
  const update: Partial<typeof settingsTable.$inferInsert> = {};
  const d = parsed.data;
  if (d.token != null) update.token = encryptString(d.token);
  if (d.isSandbox != null) update.isSandbox = d.isSandbox;
  if (d.accountId != null) update.accountId = d.accountId;
  if (d.maxOrderAmount != null) update.maxOrderAmount = d.maxOrderAmount;
  if (d.riskPercent != null) update.riskPercent = d.riskPercent;
  if (d.agentIntervalMinutes != null) update.agentIntervalMinutes = d.agentIntervalMinutes;
  if (d.paperMode != null) update.paperMode = d.paperMode;
  if (d.confidenceThreshold != null) update.confidenceThreshold = d.confidenceThreshold;
  if (d.stopLossPercent != null) update.stopLossPercent = d.stopLossPercent;
  if (d.takeProfitPercent != null) update.takeProfitPercent = d.takeProfitPercent;
  if (d.dailyLossLimitRub != null) update.dailyLossLimitRub = d.dailyLossLimitRub;
  if (d.maxTradesPerDay != null) update.maxTradesPerDay = d.maxTradesPerDay;
  if (d.priceLimitPercent != null) update.priceLimitPercent = d.priceLimitPercent;

  await db.update(settingsTable).set(update);
  const fresh = await getOrCreateSettings();
  res.json(publicView(fresh));
});

export { getOrCreateSettings };
export default router;
