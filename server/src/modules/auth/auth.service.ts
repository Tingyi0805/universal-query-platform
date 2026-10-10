import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { findUserById, findUserByUsername, updateOwnLocalPassword } from "./auth.repository.js";
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

  const options: jwt.SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  };

  const token = jwt.sign(
    {
      sub: String(user.id),
      username: user.username,
      displayName: user.displayName,
      permissions: user.permissions,
      tokenVersion: record.tokenVersion,
    },
    env.JWT_SECRET,
    options,
  );

  return { status: "OK", user, token };
}


export async function changeOwnPassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const record = await findUserById(userId);

  if (record === undefined) throw new Error("AUTH_NOT_CONFIGURED");
  if (!record || !record.isActive || record.authProvider !== "LOCAL" || !record.passwordHash) {
    throw new Error("USER_NOT_FOUND_OR_NOT_LOCAL");
  }

  const currentPasswordOk = await bcrypt.compare(currentPassword, record.passwordHash);
  if (!currentPasswordOk) throw new Error("CURRENT_PASSWORD_INVALID");

  const samePassword = await bcrypt.compare(newPassword, record.passwordHash);
  if (samePassword) throw new Error("NEW_PASSWORD_MUST_DIFFER");

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await updateOwnLocalPassword(userId, passwordHash);
}
