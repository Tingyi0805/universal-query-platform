import type { ErrorRequestHandler } from "express";
import { logger } from "../config/logger.js";
import { env } from "../config/env.js";

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const requestId = req.id;

  logger.error(
    {
      err: error,
      requestId,
      method: req.method,
      path: req.originalUrl,
    },
    "Unhandled request error",
  );

  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "伺服器發生未預期錯誤。",
      requestId,
      detail: env.NODE_ENV === "development" && error instanceof Error ? error.message : undefined,
    },
  });
};
