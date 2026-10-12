import type { ErrorRequestHandler } from "express";
import { logger } from "../config/logger.js";

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const requestId = req.id;

  logger.error(
    {
      // Driver messages/stack traces can contain SQL, bind values or connection strings.
      code: "INTERNAL_SERVER_ERROR",
      requestId,
      method: req.method,
      path: req.path,
    },
    "Unhandled request error",
  );

  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "伺服器發生未預期錯誤。",
      requestId,
    },
  });
};
