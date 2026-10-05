import { Router } from "express";
import { z } from "zod";
import { login } from "./auth.service.js";

const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
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
      res.status(401).json({ error: { code: result.status, message: "帳號或密碼錯誤。" } });
      return;
    }

    res.json({ user: result.user, accessToken: result.token, tokenType: "Bearer" });
  } catch (error) {
    next(error);
  }
});
