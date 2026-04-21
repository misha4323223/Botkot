import { Router, type IRouter } from "express";
import {
  checkPassword,
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
  verifySessionToken,
} from "../lib/auth";

const router: IRouter = Router();

router.get("/auth/status", (_req, res): void => {
  res.json({ authRequired: !!process.env.APP_PASSWORD });
});

router.get("/auth/me", (req, res): void => {
  if (!process.env.APP_PASSWORD) {
    res.json({ authenticated: true, authRequired: false });
    return;
  }
  const ok = verifySessionToken(readSessionCookie(req));
  res.json({ authenticated: ok, authRequired: true });
});

router.post("/auth/login", (req, res): void => {
  const { password } = (req.body ?? {}) as { password?: string };
  if (typeof password !== "string" || password.length === 0) {
    res.status(400).json({ error: "Password is required" });
    return;
  }
  if (!process.env.APP_PASSWORD) {
    res.status(503).json({ error: "Авторизация не настроена на сервере" });
    return;
  }
  if (!checkPassword(password)) {
    req.log.warn("Failed login attempt");
    res.status(401).json({ error: "Неверный пароль" });
    return;
  }
  const token = createSessionToken();
  setSessionCookie(res, token);
  req.log.info("User logged in");
  res.json({ ok: true });
});

router.post("/auth/logout", (_req, res): void => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

export default router;
