import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import settingsRouter from "./settings";
import portfolioRouter from "./portfolio";
import marketRouter from "./market";
import ordersRouter from "./orders";
import tradelogRouter from "./tradelog";
import agentRouter from "./agent";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

// Public endpoints
router.use(healthRouter);
router.use(authRouter);

// Protected endpoints
router.use(requireAuth);
router.use(settingsRouter);
router.use(portfolioRouter);
router.use(marketRouter);
router.use(ordersRouter);
router.use(tradelogRouter);
router.use(agentRouter);

export default router;
