import { Router } from "express";
import { z } from "zod";
import { authenticateJwt } from "./auth.middleware.js";
import { changeOwnPassword, login } from "./auth.service.js";
import { auditRequestContext } from "../audit/auditContext.js";
import { tryWriteAuditEvent } from "../audit/audit.repository.js";

const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10).max(200),
});

export const authRouter = Router();

authRouter.post("/login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "帳號或密碼格式不正確。" } });
      return;
    }

    const result = await login(parsed.data.username, parsed.data.password);

    if (result.status === "AUTH_NOT_CONFIGURED") {
      res.status(503).json({ error: { code: result.status, message: "登入服務尚未設定。" } });
      return;
    }

    if (result.status === "INVALID_CREDENTIALS") {
      await tryWriteAuditEvent({
        eventType: "LOGIN_FAILED",
        status: "FAILED",
        errorCode: result.status,
        parameters: { username: parsed.data.username },
        ...auditRequestContext(req),
      });
      res.status(401).json({ error: { code: result.status, message: "帳號或密碼錯誤。" } });
      return;
    }

    await tryWriteAuditEvent({
      eventType: "LOGIN_SUCCESS",
      userId: result.user.id,
      parameters: { username: result.user.username },
      ...auditRequestContext(req),
    });
    res.json({ user: result.user, accessToken: result.token, tokenType: "Bearer" });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", authenticateJwt, (req, res) => {
  res.json({ user: req.authUser });
});


authRouter.post("/change-password", authenticateJwt, async (req, res, next) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success || !req.authUser) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "密碼格式不正確，新密碼至少 10 字元。" } });
      return;
    }

    await changeOwnPassword(
      req.authUser.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );

    await tryWriteAuditEvent({
      eventType: "USER_PASSWORD_CHANGED",
      userId: req.authUser.id,
      parameters: { targetUserId: req.authUser.id },
      ...auditRequestContext(req),
    });
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "CURRENT_PASSWORD_INVALID") {
      await tryWriteAuditEvent({
        eventType: "USER_PASSWORD_CHANGE_FAILED",
        status: "FAILED",
        errorCode: error.message,
        userId: req.authUser?.id ?? null,
        parameters: req.authUser ? { targetUserId: req.authUser.id } : null,
        ...auditRequestContext(req),
      });
      res.status(400).json({ error: { code: error.message, message: "目前密碼不正確。" } });
      return;
    }
    if (error instanceof Error && error.message === "NEW_PASSWORD_MUST_DIFFER") {
      res.status(400).json({ error: { code: error.message, message: "新密碼不可與目前密碼相同。" } });
      return;
    }
    if (error instanceof Error && error.message === "USER_NOT_FOUND_OR_NOT_LOCAL") {
      res.status(400).json({ error: { code: error.message, message: "此帳號不是可變更密碼的本機帳號。" } });
      return;
    }
    next(error);
  }
});
