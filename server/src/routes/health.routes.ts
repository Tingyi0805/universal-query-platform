import { Router } from "express";
import { isPlatformDbConfigured } from "../config/database.js";
import { env } from "../config/env.js";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "universal-query-platform-server",
    timestamp: new Date().toISOString(),
    components: {
      platformDatabase: isPlatformDbConfigured() ? "CONFIGURED" : "NOT_CONFIGURED",
      authentication: isPlatformDbConfigured() && env.JWT_SECRET ? "CONFIGURED" : "NOT_CONFIGURED",
    },
  });
});
