import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { db, settingsTable } from "@workspace/db";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// On startup, sync TINKOFF_API_TOKEN env var into the settings table if present
async function syncTokenFromEnv() {
  const envToken = process.env.TINKOFF_API_TOKEN;
  if (!envToken) return;

  try {
    const rows = await db.select().from(settingsTable).limit(1);
    if (rows.length === 0) {
      await db.insert(settingsTable).values({ token: envToken });
      logger.info("Saved TINKOFF_API_TOKEN from env to settings (new row)");
    } else {
      const existing = rows[0];
      if (!existing.token) {
        await db.update(settingsTable).set({ token: envToken });
        logger.info("Saved TINKOFF_API_TOKEN from env to settings (updated)");
      }
    }
  } catch (err) {
    logger.error({ err }, "Failed to sync token from env");
  }
}

syncTokenFromEnv();

export default app;
