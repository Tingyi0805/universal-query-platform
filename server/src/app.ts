import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { type Request, type Response } from "express";
import helmet from "helmet";
import pinoHttpModule from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import { auditRouter } from "./modules/audit/audit.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { dataSourceRouter } from "./modules/datasource/datasource.routes.js";
import { datasetRouter } from "./modules/dataset/dataset.routes.js";
import { queryCategoryRouter } from "./modules/queryCategory/queryCategory.routes.js";
import { queryDefinitionRouter } from "./modules/queryDefinition/queryDefinition.routes.js";
import { queryRuntimeRouter } from "./modules/queryDefinition/queryRuntime.routes.js";
import { systemSettingsRouter } from "./modules/systemSettings/systemSettings.routes.js";
import { healthRouter } from "./routes/health.routes.js";

const pinoHttp = pinoHttpModule as unknown as (options: {
  logger: typeof logger;
  genReqId: (req: Request, res: Response) => string;
}) => express.RequestHandler;

export const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(
  pinoHttp({
    logger,
    genReqId: (req: Request, res: Response) => {
      const incoming = req.headers["x-request-id"];
      const requestId =
        typeof incoming === "string" && incoming.trim()
          ? incoming.trim()
          : randomUUID();

      res.setHeader("x-request-id", requestId);
      return requestId;
    },
  }),
);

app.use("/api/health", healthRouter);
app.use("/api/system/status", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/audit", auditRouter);
app.use("/api/datasources", dataSourceRouter);
app.use("/api/datasets", datasetRouter);
app.use("/api/query-categories", queryCategoryRouter);
app.use("/api/query-definitions", queryDefinitionRouter);
app.use("/api/queries", queryRuntimeRouter);
app.use("/api/system-settings", systemSettingsRouter);

app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "找不到指定的 API。",
    },
  });
});

app.use(errorHandler);
