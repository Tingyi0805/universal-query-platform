import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requirePermission } from "../auth/auth.middleware.js";
import { withErrorModule } from "../../middleware/safeErrorDiagnostic.js";
import { workstationManagement } from "./workstationManagement.repository.js";
import {
  grantSchema,
  metadataSchema,
  positiveId,
  strictIds,
} from "./workstationManagement.js";
const id = z.coerce.number().int().positive().safe();
const paging = z.object({
  search: z.string().max(100).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const create = z
  .object({
    workstationCode: z.string().regex(/^[A-Za-z0-9_-]{2,100}$/),
    displayName: z.string().trim().min(1).max(200),
    platformCode: z.enum(["WINDOWS", "ANDROID", "IOS", "UNKNOWN"]),
    purposeCode: z.enum(["SHARED_QUERY", "DASHBOARD"]),
    sortOrder: z.number().int().min(0).max(10000),
  })
  .strict();
const audience = z
  .object({
    kind: z.enum(["DEPARTMENT", "GROUP"]),
    code: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    displayName: z.string().trim().min(1).max(200),
    isActive: z.boolean(),
    userIds: strictIds(2000),
    expectedRevision: positiveId.optional(),
  })
  .strict();
const expected = new Set([
  "WORKSTATION_NOT_FOUND",
  "WORKSTATION_RETIRED",
  "WORKSTATION_VERSION_STALE",
  "WORKSTATION_GRANT_INVALID",
  "WORKSTATION_DELETE_UNSAFE",
  "WORKSTATION_PURPOSE_BOUND",
  "WORKSTATION_PURPOSE_INVALID",
  "WORKSTATION_DEVICE_UNAVAILABLE",
  "AUDIENCE_NOT_FOUND",
  "AUDIENCE_VERSION_STALE",
  "WORKSTATION_SCHEMA_REQUIRED",
  "PLATFORM_DB_NOT_CONFIGURED",
]);
export function createWorkstationManagementRouter(
  deps = workstationManagement,
) {
  const router = Router();
  router.use(requirePermission("MANAGE_USERS"));
  function route(
    method: "get" | "post" | "put" | "delete",
    path: string,
    work: (req: Request, res: Response) => Promise<void>,
  ) {
    router[method](path, async (req, res, next) => {
      try {
        res.setHeader("Cache-Control", "no-store");
        await withErrorModule("admin.workstation", () => work(req, res));
      } catch (error) {
        if (error instanceof z.ZodError) {
          res
            .status(400)
            .json({
              error: {
                code: "VALIDATION_ERROR",
                message: "欄位格式不正確；ID 必須為不重複的正整數。",
                requestId: req.id,
              },
            });
          return;
        }
        const code = error instanceof Error ? error.message : "";
        if (expected.has(code)) {
          res
            .status(
              code.endsWith("NOT_FOUND")
                ? 404
                : code.endsWith("NOT_CONFIGURED") ||
                    code.endsWith("SCHEMA_REQUIRED")
                  ? 503
                  : 409,
            )
            .json({
              error: {
                code,
                message:
                  code === "WORKSTATION_SCHEMA_REQUIRED"
                    ? "新工作站管理需要 916 Schema；請先在隔離環境完成驗證，勿在共用資料庫執行。"
                    : "操作未套用，請重新載入並確認工作站狀態及授權。",
                requestId: req.id,
              },
            });
          return;
        }
        if (
          [2601, 2627].includes(Number((error as { number?: number })?.number))
        ) {
          res
            .status(409)
            .json({
              error: {
                code: "CODE_EXISTS",
                message: "代碼已存在。",
                requestId: req.id,
              },
            });
          return;
        }
        next(error);
      }
    });
  }
  route("get", "/workstation-management", async (_req, res) => {
    res.json(await deps.list());
  });
  route("post", "/workstation-management", async (req, res) => {
    res
      .status(201)
      .json(await deps.create(create.parse(req.body), req.authUser!.id));
  });
  route("put", "/shared-workstations/:id/management", async (req, res) => {
    await deps.metadata(
      id.parse(req.params.id),
      metadataSchema.parse(req.body),
      req.authUser!.id,
    );
    res.json({ status: "OK", pinLoginEnabled: false });
  });
  route("post", "/shared-workstations/:id/retire", async (req, res) => {
    await deps.retire(
      id.parse(req.params.id),
      z.object({ expectedVersion: positiveId }).strict().parse(req.body)
        .expectedVersion,
      req.authUser!.id,
    );
    res.json({ status: "OK" });
  });
  route("delete", "/shared-workstations/:id", async (req, res) => {
    await deps.removeUnused(
      id.parse(req.params.id),
      z.object({ expectedVersion: positiveId }).strict().parse(req.body)
        .expectedVersion,
      req.authUser!.id,
    );
    res.json({ status: "OK" });
  });
  route("get", "/shared-workstations/:id/grants", async (req, res) => {
    res.json(await deps.grants(id.parse(req.params.id)));
  });
  route("put", "/shared-workstations/:id/grants", async (req, res) => {
    await deps.saveGrants(
      id.parse(req.params.id),
      grantSchema.parse(req.body),
      req.authUser!.id,
    );
    res.json({ status: "OK", pinLoginEnabled: false });
  });
  route("post", "/shared-workstations/:id/grants/copy", async (req, res) => {
    const b = z
      .object({ sourceId: positiveId, expectedVersion: positiveId })
      .strict()
      .parse(req.body);
    await deps.saveGrants(
      id.parse(req.params.id),
      {
        userIds: [],
        departmentIds: [],
        groupIds: [],
        expectedVersion: b.expectedVersion,
      },
      req.authUser!.id,
      b.sourceId,
    );
    res.json({ status: "OK" });
  });
  route("get", "/shared-workstations/:id/effective-users", async (req, res) => {
    const p = paging.parse(req.query);
    res.json(
      await deps.effective(
        id.parse(req.params.id),
        p.search,
        p.page,
        p.pageSize,
      ),
    );
  });
  route("get", "/workstation-audiences", async (req, res) => {
    const p = paging.parse(req.query);
    res.json(await deps.audiences(p.search, p.page, p.pageSize));
  });
  route("get", "/workstation-audiences/:id/members", async (req, res) => {
    res.json(await deps.audienceMembers(id.parse(req.params.id)));
  });
  route("post", "/workstation-audiences", async (req, res) => {
    res
      .status(201)
      .json(
        await deps.saveAudience(audience.parse(req.body), req.authUser!.id),
      );
  });
  route("put", "/workstation-audiences/:id", async (req, res) => {
    const b = audience.extend({ expectedRevision: positiveId }).parse(req.body);
    res.json(
      await deps.saveAudience(b, req.authUser!.id, id.parse(req.params.id)),
    );
  });
  route("get", "/workstation-dashboard-devices", async (_req, res) => {
    res.json(await deps.devices());
  });
  route(
    "post",
    "/shared-workstations/:id/dashboard-device",
    async (req, res) => {
      const b = z
        .object({ deviceId: positiveId, expectedVersion: positiveId })
        .strict()
        .parse(req.body);
      await deps.bindDevice(
        id.parse(req.params.id),
        b.deviceId,
        b.expectedVersion,
        req.authUser!.id,
      );
      res.json({ status: "OK" });
    },
  );
  return router;
}
