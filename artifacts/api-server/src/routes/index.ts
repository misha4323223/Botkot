import { Router, type IRouter } from "express";
import healthRouter from "./health";
import settingsRouter from "./settings";
import portfolioRouter from "./portfolio";
import marketRouter from "./market";
import ordersRouter from "./orders";
import tradelogRouter from "./tradelog";
import agentRouter from "./agent";

const router: IRouter = Router();

router.use(healthRouter);
router.use(settingsRouter);
router.use(portfolioRouter);
router.use(marketRouter);
router.use(ordersRouter);
router.use(tradelogRouter);
router.use(agentRouter);

export default router;
