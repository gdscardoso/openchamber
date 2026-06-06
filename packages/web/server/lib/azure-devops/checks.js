const APP_INFO = { name: 'Azure DevOps', slug: 'azure-devops' };

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCheckState(value) {
  const state = normalizeText(value).toLowerCase();
  if (state === 'success' || state === 'failure' || state === 'pending') {
    return state;
  }
  return 'unknown';
}

function summarizeChecks(states) {
  const counts = { success: 0, failure: 0, pending: 0 };
  for (const state of states) {
    if (state === 'success' || state === 'failure' || state === 'pending') {
      counts[state] += 1;
    }
  }
  const total = counts.success + counts.failure + counts.pending;
  return {
    state: counts.failure > 0 ? 'failure' : (counts.pending > 0 ? 'pending' : (total > 0 ? 'success' : 'unknown')),
    total,
    ...counts,
  };
}

export function mapAzurePolicyStatus(status) {
  switch (normalizeText(status).toLowerCase()) {
    case 'approved':
      return 'success';
    case 'rejected':
    case 'broken':
      return 'failure';
    case 'queued':
    case 'running':
      return 'pending';
    default:
      return 'unknown';
  }
}

export function mapAzureBuildState(build) {
  const status = normalizeText(build?.status).toLowerCase();
  if (status === 'inprogress' || status === 'notstarted' || status === 'postponed') {
    return 'pending';
  }
  const result = normalizeText(build?.result).toLowerCase();
  if (result === 'succeeded') {
    return 'success';
  }
  if (result === 'failed' || result === 'canceled') {
    return 'failure';
  }
  if (result === 'none' || result === 'partiallysucceeded') {
    return 'pending';
  }
  return 'unknown';
}

export function mapAzurePrStatusState(status) {
  switch (normalizeText(status?.state).toLowerCase()) {
    case 'succeeded':
      return 'success';
    case 'failed':
    case 'error':
      return 'failure';
    case 'pending':
    case 'notset':
      return 'pending';
    default:
      return 'unknown';
  }
}

function mapPolicyCheckRun(evaluation) {
  const name = normalizeText(evaluation?.evaluationPolicyConfig?.type?.displayName) || 'Policy';
  const state = mapAzurePolicyStatus(evaluation?.status);
  const detailsUrl = normalizeText(evaluation?._links?.web?.href) || normalizeText(evaluation?.context?.url) || undefined;
  return {
    id: Number.isFinite(Number(evaluation?.evaluationId)) ? Number(evaluation.evaluationId) : undefined,
    name,
    app: APP_INFO,
    status: state === 'pending' ? 'in_progress' : (state === 'unknown' ? 'unknown' : 'completed'),
    conclusion: state,
    detailsUrl,
    output: {
      title: name,
      summary: normalizeText(evaluation?.context?.message) || normalizeText(evaluation?.configuration?.settings?.displayName) || undefined,
    },
  };
}

function mapBuildCheckRun(build) {
  const name = normalizeText(build?.definition?.name) || normalizeText(build?.buildNumber) || 'Build';
  const state = mapAzureBuildState(build);
  const detailsUrl = normalizeText(build?._links?.web?.href) || normalizeText(build?.links?.web?.href) || normalizeText(build?.url) || undefined;
  return {
    id: Number.isFinite(Number(build?.id)) ? Number(build.id) : undefined,
    name,
    app: APP_INFO,
    status: normalizeText(build?.status) || (state === 'pending' ? 'inProgress' : 'completed'),
    conclusion: state,
    detailsUrl,
    output: {
      title: normalizeText(build?.buildNumber) || name,
      summary: normalizeText(build?.reason) || undefined,
      text: normalizeText(build?.sourceBranch) || undefined,
    },
  };
}

function mapPrStatusCheckRun(status) {
  const contextName = normalizeText(status?.context?.name);
  const contextGenre = normalizeText(status?.context?.genre);
  const name = contextName || contextGenre || normalizeText(status?.description) || 'Status';
  const state = mapAzurePrStatusState(status);
  return {
    name,
    app: APP_INFO,
    status: state === 'pending' ? 'pending' : (state === 'unknown' ? 'unknown' : 'completed'),
    conclusion: state,
    detailsUrl: normalizeText(status?.targetUrl) || undefined,
    output: {
      title: name,
      summary: normalizeText(status?.description) || undefined,
    },
  };
}

export async function loadAzureDevOpsChecks({ client, repo, pullRequestId }) {
  const repoId = encodeURIComponent(repo.repositoryId || repo.repo);
  const project = encodeURIComponent(repo.project);
  const prId = encodeURIComponent(pullRequestId);

  const [policiesPayload, buildsPayload, statusesPayload] = await Promise.all([
    client.request(`/${project}/_apis/git/policy/evaluations`, {
      query: { artifactId: `vstfs:///CodeReview/CodeReviewId/${pullRequestId}` },
    }).catch(() => ({ value: [] })),
    client.request(`/${project}/_apis/build/builds`, {
      query: {
        queryOrder: 'queueTimeDescending',
        branchName: `refs/pull/${pullRequestId}/merge`,
      },
    }).catch(() => ({ value: [] })),
    client.request(`/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}/statuses`).catch(() => ({ value: [] })),
  ]);

  const policyRuns = (Array.isArray(policiesPayload?.value) ? policiesPayload.value : []).map(mapPolicyCheckRun);
  const buildRuns = (Array.isArray(buildsPayload?.value) ? buildsPayload.value : []).map(mapBuildCheckRun);
  const statusRuns = (Array.isArray(statusesPayload?.value) ? statusesPayload.value : []).map(mapPrStatusCheckRun);
  const checkRuns = [...policyRuns, ...buildRuns, ...statusRuns].filter((run) => normalizeText(run.name));

  const checksSummary = summarizeChecks(checkRuns.map((run) => normalizeCheckState(run.conclusion)));
  const policiesApproved = policyRuns.every((run) => run.conclusion === 'success');
  const hasBuildFailure = buildRuns.some((run) => run.conclusion === 'failure');

  return {
    checks: checksSummary.total > 0 ? checksSummary : null,
    checkRuns,
    canMerge: policiesApproved && !hasBuildFailure,
  };
}
