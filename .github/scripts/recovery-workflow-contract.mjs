import { recoveryOperations } from './recovery-verification.mjs';

export function recoveryWorkflowProblems(workflow) {
  const issues = [];
  const check = (ok, message) => {
    if (!ok) issues.push(`recovery-verification.yml: ${message}`);
  };
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check(Object.keys(workflow.on ?? {}).join() === 'workflow_dispatch', 'manual dispatch only');
  check(
    Object.keys(workflow.on?.workflow_dispatch?.inputs ?? {}).join() === 'operation',
    'no free-form input',
  );
  const input = workflow.on?.workflow_dispatch?.inputs?.operation;
  check(
    input?.type === 'choice' &&
      input?.required === true &&
      input?.default === 'capture-r0' &&
      equal(input.options, recoveryOperations),
    'fixed read-only operations',
  );
  check(equal(workflow.permissions, { contents: 'read', actions: 'read' }), 'read-only token');
  check(
    equal(workflow.concurrency, { group: 'production-maintenance', 'cancel-in-progress': false }),
    'serialize all maintenance',
  );
  check(
    !workflow.env && Object.keys(workflow.jobs ?? {}).join() === 'verification',
    'single protected job',
  );
  const job = workflow.jobs?.verification;
  check(
    job?.if === "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'" &&
      job?.environment === 'production-maintenance' &&
      job?.['runs-on'] === 'ubuntu-latest' &&
      job?.['timeout-minutes'] === 15 &&
      !job?.env &&
      !job?.permissions &&
      !job?.container &&
      !job?.services,
    'main-only protected hosted job',
  );
  const steps = job?.steps ?? [];
  check(steps.length === 5, 'fixed preparation/execution/archive order');
  check(
    steps[0]?.uses === 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1' &&
      equal(steps[0]?.with, { ref: '${{ github.sha }}', 'persist-credentials': false }),
    'approved checkout',
  );
  check(
    steps[1]?.uses === 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020' &&
      equal(steps[1]?.with, { 'node-version': '24.19.0', 'package-manager-cache': false }),
    'pinned runtime',
  );
  check(
    steps[2]?.run?.trim() ===
      'corepack enable\ncorepack prepare pnpm@11.21.0 --activate\npnpm install --frozen-lockfile\npnpm workflow:validate',
    'credential-free locked preparation',
  );
  check(
    steps[3]?.run === 'node .github/scripts/recovery-verification.mjs' &&
      !steps[3]?.['working-directory'] &&
      equal(steps[3]?.env, {
        GH_TOKEN: '${{ github.token }}',
        RECOVERY_OPERATION: '${{ inputs.operation }}',
        RECOVERY_APPROVAL: '${{ secrets.RECOVERY_APPROVAL }}',
        RECOVERY_OWNER_URL:
          "${{ inputs.operation != 'verify-restored' && secrets.RECOVERY_OWNER_URL || '' }}",
        RECOVERY_RUNTIME_URL:
          "${{ inputs.operation == 'verify-restored' && secrets.RECOVERY_RUNTIME_URL || '' }}",
      }),
    'only scoped isolation credentials at bounded runner',
  );
  check(
    steps[4]?.uses === 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a' &&
      equal(steps[4]?.with, {
        name: 'recovery-verification-${{ github.run_id }}-${{ github.run_attempt }}',
        path: '${{ runner.temp }}/hzense-recovery-verification.json',
        'if-no-files-found': 'error',
        'retention-days': 30,
      }),
    'archive exact reviewed evidence file only after success',
  );
  for (const [index, step] of steps.entries()) {
    check(!step.if && !step['continue-on-error'], 'no guard or failure bypass');
    check(!step.run?.includes('${{'), 'no shell interpolation');
    if (index !== 3)
      check(!step.env && !JSON.stringify(step).includes('secrets.'), 'no ambient secrets');
    if ([0, 1, 4].includes(index)) check(!step.run, 'no replacement shell for pinned action');
    else check(!step.uses, 'no replacement action for bounded shell');
  }
  return issues;
}
