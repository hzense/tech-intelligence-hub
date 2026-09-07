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
    steps.length === 5 &&
      steps[0]?.name === 'Checkout approved commit' &&
      steps[1]?.name === 'Set up Node.js' &&
      steps[2]?.name === 'Prepare runner without production credentials' &&
      steps[3]?.name === 'Require current main and successful main CI' &&
      steps[4]?.name === 'Execute bounded maintenance',
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
      steps[4]?.['working-directory'] === 'apps/web' &&
      steps[4]?.env?.GH_TOKEN === '${{ github.token }}' &&
      steps[4]?.env?.MAINTENANCE_OPERATION === '${{ inputs.operation }}',
    'only the bounded runner with its read-only freshness token may consume credentials',
  );
  const secretBindings = {
    DATABASE_DIRECT_URL:
      "${{ inputs.operation != 'runtime-preflight' && secrets.DATABASE_DIRECT_URL || '' }}",
    HZENSE_RUNTIME_DATABASE_URL:
      "${{ inputs.operation == 'runtime-preflight' && secrets.HZENSE_RUNTIME_DATABASE_URL || '' }}",
    MAINTENANCE_APPROVAL:
      "${{ (inputs.operation == 'migrate' || inputs.operation == 'search-apply') && secrets.MAINTENANCE_APPROVAL || '' }}",
    MAINTENANCE_BACKUP_ID:
      "${{ (inputs.operation == 'migrate' || inputs.operation == 'search-apply') && secrets.MAINTENANCE_BACKUP_ID || '' }}",
  };
  for (const [name, expression] of Object.entries(secretBindings)) {
    check(steps[4]?.env?.[name] === expression, `keep the scoped ${name} binding`);
  }
  for (const [index, step] of steps.entries()) {
    check(!step.if && !step['continue-on-error'], 'required steps must not be skipped or ignored');
    check(!step.run?.includes('${{'), 'never interpolate expressions into shell commands');
    if (index !== 4) {
      check(!JSON.stringify(step).includes('secrets.'), 'preparation must not receive secrets');
    } else {
      for (const [name, value] of Object.entries(step.env ?? {})) {
        check(
          !String(value).includes('secrets.') || secretBindings[name] === value,
          'unreviewed secret binding',
        );
      }
    }
  }
  return issues;
}
