import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "universal-query-platform-server",
    timestamp: new Date().toISOString(),
  });
});
