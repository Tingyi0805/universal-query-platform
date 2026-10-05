import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { findUserByUsername } from "./auth.repository.js";
import type { LoginResult } from "./auth.types.js";

export async function login(username: string, password: string): Promise<LoginResult> {
  const record = await findUserByUsername(username.trim());

  if (record === undefined || !env.JWT_SECRET) {
    return { status: "AUTH_NOT_CONFIGURED" };
  }

  if (!record || !record.isActive || record.authProvider !== "LOCAL" || !record.passwordHash) {
    return { status: "INVALID_CREDENTIALS" };
  }

  const passwordOk = await bcrypt.compare(password, record.passwordHash);
  if (!passwordOk) return { status: "INVALID_CREDENTIALS" };

  const user = {
    id: record.id,
    username: record.username,
    displayName: record.displayName,
    permissions: record.permissions,
  };

  const token = jwt.sign(
    {
      sub: String(user.id),
      username: user.username,
      displayName: user.displayName,
      permissions: user.permissions,
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN },
  );

  return { status: "OK", user, token };
}
