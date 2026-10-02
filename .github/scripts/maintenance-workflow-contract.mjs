import { maintenanceOperations } from './production-maintenance.mjs';

export function maintenanceWorkflowProblems(workflow) {
  const issues = [];
  const check = (condition, message) => {
    if (!condition) issues.push(`production-maintenance.yml: ${message}`);
  };
  check(
    Object.keys(workflow.on ?? {}).join() === 'workflow_dispatch',
    'only manual dispatch is permitted',
  );
  const inputs = workflow.on?.workflow_dispatch?.inputs;
  check(Object.keys(inputs ?? {}).join() === 'operation', 'no free-form inputs are permitted');
  check(
    inputs?.operation?.type === 'choice' &&
      inputs.operation.required === true &&
      inputs.operation.default === 'preflight' &&
      JSON.stringify(inputs.operation.options) === JSON.stringify(maintenanceOperations),
    'operation choices must match the reviewed runner',
  );
  check(
    workflow.concurrency?.group === 'production-maintenance' &&
      workflow.concurrency['cancel-in-progress'] === false,
    'maintenance must serialize without cancelling a running mutation',
  );
  check(
    JSON.stringify(workflow.permissions) === JSON.stringify({ contents: 'read', actions: 'read' }),
    'only contents/read and actions/read are permitted',
  );
  check(!workflow.env, 'do not put credentials in workflow-wide environment');
  check(Object.keys(workflow.jobs ?? {}).join() === 'maintenance', 'unexpected maintenance job');
  const job = workflow.jobs?.maintenance;
  check(
    job?.if === "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'" &&
      job?.environment === 'production-maintenance' &&
      job?.['runs-on'] === 'ubuntu-latest' &&
      job?.['timeout-minutes'] === 20 &&
      !job?.env &&
      !job?.permissions,
    'keep the hosted main-only protected job contract',
  );
  const steps = job?.steps ?? [];
  check(
    steps.length === 7 &&
      steps[0]?.name === 'Checkout approved commit' &&
      steps[1]?.name === 'Set up Node.js' &&
      steps[2]?.name === 'Prepare runner without production credentials' &&
      steps[3]?.name === 'Require current main and successful main CI' &&
      steps[4]?.name === 'Execute bounded maintenance' &&
      steps[5]?.name === 'Archive approved public ACL evidence' &&
      steps[6]?.name === 'Apply and independently verify approved migration',
    'step order must preserve preparation, CI guard, then secret-bearing execution',
  );
  check(
    steps[0]?.with?.ref === '${{ github.sha }}' &&
      steps[0]?.with?.['persist-credentials'] === false,
    'checkout must bind the approved SHA without persisting a token',
  );
  check(
    steps[3]?.env?.GH_TOKEN === '${{ github.token }}' &&
      steps[3]?.run?.includes('test "$head" = "$GITHUB_SHA"') &&
      steps[3]?.run?.includes('event=push&head_sha=$GITHUB_SHA&per_page=1') &&
      steps[3]?.run?.includes('test "$conclusion" = success'),
    'require current main and its successful latest push CI before credential use',
  );
  check(
    steps[4]?.run === 'node ../../.github/scripts/production-maintenance.mjs' &&
      steps[4]?.id === 'maintenance' &&
      steps[4]?.['working-directory'] === 'apps/web' &&
      steps[4]?.env?.GH_TOKEN === '${{ github.token }}' &&
      steps[4]?.env?.MAINTENANCE_SEQUENCE_PHASE ===
        "${{ inputs.operation == 'migrate-and-verify' && 'prepare' || '' }}" &&
      !steps[4]?.env?.MAINTENANCE_ACL_ARCHIVE_CONFIRMED &&
      steps[4]?.env?.MAINTENANCE_OPERATION === '${{ inputs.operation }}',
    'only the bounded runner with its read-only freshness token may consume credentials',
  );
  const secretBindings = {
    DATABASE_DIRECT_URL:
      "${{ inputs.operation != 'runtime-preflight' && secrets.DATABASE_DIRECT_URL || '' }}",
    HZENSE_RUNTIME_DATABASE_URL:
      "${{ inputs.operation == 'runtime-preflight' && secrets.HZENSE_RUNTIME_DATABASE_URL || '' }}",
    MAINTENANCE_APPROVAL:
      "${{ (inputs.operation == 'migrate' || inputs.operation == 'search-apply' || inputs.operation == 'acl-capture' || inputs.operation == 'migrate-and-verify') && secrets.MAINTENANCE_APPROVAL || '' }}",
    MAINTENANCE_BACKUP_ID:
      "${{ (inputs.operation == 'preflight' || inputs.operation == 'migrate' || inputs.operation == 'search-apply' || inputs.operation == 'acl-capture' || inputs.operation == 'migrate-and-verify') && secrets.MAINTENANCE_BACKUP_ID || '' }}",
  };
  for (const [name, expression] of Object.entries(secretBindings)) {
    check(steps[4]?.env?.[name] === expression, `keep the scoped ${name} binding`);
  }
  check(
    steps[5]?.id === 'archive' &&
      steps[5]?.if ===
        "always() && ((success() && inputs.operation == 'acl-capture') || (inputs.operation == 'migrate-and-verify' && steps.maintenance.outputs.acl_captured == 'true'))" &&
      steps[5]?.uses === 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a' &&
      !steps[5]?.env &&
      !steps[5]?.run &&
      JSON.stringify(steps[5]?.with) ===
        JSON.stringify({
          name: 'acl-evidence-${{ github.run_id }}-${{ github.run_attempt }}',
          path: '${{ runner.temp }}/hzense-acl-evidence.json',
          'if-no-files-found': 'error',
          'retention-days': 30,
        }),
    'archive only the approved ACL file after successful capture and before sequence DDL; never upload dumps or directories',
  );
  const applySecrets = {
    DATABASE_DIRECT_URL: '${{ secrets.DATABASE_DIRECT_URL }}',
    MAINTENANCE_APPROVAL: '${{ secrets.MAINTENANCE_APPROVAL }}',
    MAINTENANCE_BACKUP_ID: '${{ secrets.MAINTENANCE_BACKUP_ID }}',
  };
  const applyEnvironment = {
    GH_TOKEN: '${{ github.token }}',
    MAINTENANCE_OPERATION: '${{ inputs.operation }}',
    MAINTENANCE_SEQUENCE_PHASE: 'apply',
    MAINTENANCE_ACL_ARCHIVE_CONFIRMED: '${{ steps.archive.outcome }}',
    ...applySecrets,
    ...Object.fromEntries(
      Object.entries(steps[4]?.env ?? {}).filter(([key]) =>
        key.startsWith('HZENSE_DATABASE_EXPECTED_'),
      ),
    ),
  };
  check(
    steps[6]?.if === "success() && inputs.operation == 'migrate-and-verify'" &&
      steps[6]?.run === 'node ../../.github/scripts/production-maintenance.mjs' &&
      steps[6]?.['working-directory'] === 'apps/web' &&
      JSON.stringify(steps[6]?.env) === JSON.stringify(applyEnvironment),
    'combined DDL must follow successful remote ACL archive in the same protected job with the original approval',
  );
  for (const [index, step] of steps.entries()) {
    check(
      (index === 5 || index === 6 || !step.if) && !step['continue-on-error'],
      'required steps must not be skipped or ignored',
    );
    check(!step.run?.includes('${{'), 'never interpolate expressions into shell commands');
    if (index !== 4 && index !== 6) {
      check(!JSON.stringify(step).includes('secrets.'), 'preparation must not receive secrets');
    } else {
      for (const [name, value] of Object.entries(step.env ?? {})) {
        check(
          !String(value).includes('secrets.') ||
            (index === 4 ? secretBindings : applySecrets)[name] === value,
          'unreviewed secret binding',
        );
      }
    }
  }
  return issues;
}
