export type AuthUser = {
  id: number;
  username: string;
  displayName: string;
  permissions: string[];
};

export type LoginResult =
  | { status: "OK"; user: AuthUser; token: string }
  | { status: "INVALID_CREDENTIALS" }
  | { status: "AUTH_NOT_CONFIGURED" };
