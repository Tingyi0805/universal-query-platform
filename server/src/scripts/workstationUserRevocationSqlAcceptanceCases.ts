/** Names only; importing a report must never import SQL. */
export const userSqlCases = ["account-no-device","user-disable","user-token-revoke","user-local-password","user-role-assignment",
 "user-shared-workstation-preserved","user-pin-binding-invalidated","account-request-replay","user-rowversion-conflict",
 "user-generation-conflict","account-audit-rollback","account-decision-rollback","account-commit-unknown","concurrent-user-revoke"] as const;
