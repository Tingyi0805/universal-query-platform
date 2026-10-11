import { Router } from "express";
import { z } from "zod";
import { authenticateJwt } from "./auth.middleware.js";
import { changeOwnPassword, login } from "./auth.service.js";
import { enrollQuickPin, revokeQuickPin, getConfiguredPinLength } from "./quickPin.service.js";
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

const pinEnrollSchema = z.object({
  password: z.string().min(1).max(200),
  pin: z.string().regex(/^\d{4,12}$/),
});
const pinRevokeSchema = z.object({ password: z.string().min(1).max(200) });

// Enrollment/revocation only. PIN sign-in is deliberately not enabled yet.
authRouter.post("/quick-pin/enroll", authenticateJwt, async (req, res, next) => {
  try {
    const parsed = pinEnrollSchema.safeParse(req.body);
    if (!parsed.success || !req.authUser) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "請輸入密碼及 4 至 12 位數 PIN。" } });
      return;
    }
    const status = await enrollQuickPin(req.authUser.id, parsed.data.password, parsed.data.pin);
    if (status !== "OK") {
      await tryWriteAuditEvent({ eventType: "QUICK_PIN_ENROLL_FAILED", status: "FAILED", userId: req.authUser.id, errorCode: status, ...auditRequestContext(req) });
      res.status(status === "NOT_CONFIGURED" ? 503 : status === "PIN_WEAK" ? 400 : 401)
        .json({ error: { code: status, message: status === "PIN_WEAK" ? "PIN 過於簡單，請重新設定。" : "無法設定 PIN，請確認正式密碼及系統設定。" } });
      return;
    }
    await tryWriteAuditEvent({ eventType: "QUICK_PIN_ENROLLED", userId: req.authUser.id, ...auditRequestContext(req) });
    res.json({ status: "OK" });
  } catch (error) { next(error); }
});

authRouter.post("/quick-pin/revoke", authenticateJwt, async (req, res, next) => {
  try {
    const parsed = pinRevokeSchema.safeParse(req.body);
    if (!parsed.success || !req.authUser) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "請輸入正式密碼。" } });
      return;
    }
    const status = await revokeQuickPin(req.authUser.id, parsed.data.password);
    if (status !== "OK") {
      await tryWriteAuditEvent({ eventType: "QUICK_PIN_REVOKE_FAILED", status: "FAILED", userId: req.authUser.id, errorCode: status, ...auditRequestContext(req) });
      res.status(status === "NOT_CONFIGURED" ? 503 : 401)
        .json({ error: { code: status, message: "驗證失敗，無法撤銷 PIN。" } });
      return;
    }
    await tryWriteAuditEvent({ eventType: "QUICK_PIN_REVOKED", userId: req.authUser.id, ...auditRequestContext(req) });
    res.json({ status: "OK" });
  } catch (error) { next(error); }
});

authRouter.get("/quick-pin/policy", authenticateJwt, async (_req, res, next) => {
  try {
    res.json({ pinLength: await getConfiguredPinLength() });
  } catch (error) { next(error); }
});
