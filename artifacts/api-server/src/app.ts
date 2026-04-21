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

// On startup, sync TINKOFF_API_TOKEN env var into the settings table if present,
// then auto-start the agent if it was previously running (or if watchlist is non-empty)
async function initOnStartup() {
  const envToken = process.env.TINKOFF_API_TOKEN;

  try {
    const rows = await db.select().from(settingsTable).limit(1);
    if (rows.length === 0) {
      await db.insert(settingsTable).values({ token: envToken ?? null });
      logger.info("Created default settings row");
    } else if (envToken && !rows[0].token) {
      await db.update(settingsTable).set({ token: envToken });
      logger.info("Saved TINKOFF_API_TOKEN from env to settings");
    }
  } catch (err) {
    logger.error({ err }, "Failed to init settings");
  }

  // Auto-start the agent — import dynamically to avoid circular deps
  try {
    const { startAgentLoop } = await import("./lib/agent-loop");
    await startAgentLoop();
    logger.info("Agent auto-started on server boot");
  } catch (err) {
    logger.warn({ err }, "Agent auto-start skipped (no watchlist or token)");
  }
}

initOnStartup();

export default app;
