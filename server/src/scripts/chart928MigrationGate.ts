// Prevent an unapproved 928 artifact from entering the generic db:migrate path.
// This is a SOURCE-INVENTORY guard, not a migration approval mechanism.
// It does not inspect clinical data, connect to SQL, or enable any CHART route.
export const CHART_928_GENERIC_MIGRATION_APPROVED=false as const;

export function rejectUnapprovedChart928Migration(
  files:readonly string[], command:string,
):void {
  if(command==="status")return; // read-only discovery is still permitted
  if(files.some(file=>/^928_.*\.sql$/i.test(file)))
    throw Error("CHART_928_GENERIC_MIGRATION_BLOCKED_INDEPENDENT_APPROVAL_REQUIRED");
}
