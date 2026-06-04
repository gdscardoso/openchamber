import { getRemoteUrl } from '../../git/index.js';

const stripGitSuffix = (value) => value.endsWith('.git') ? value.slice(0, -4) : value;
const cleanPart = (value) => decodeURIComponent(String(value || '').trim());

function buildRef({ organization, project, repo, remoteUrl }) {
  if (!organization || !repo) return null;
  const webUrl = project
    ? `https://dev.azure.com/${organization}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}`
    : `https://${organization}.visualstudio.com/_git/${encodeURIComponent(repo)}`;
  return {
    provider: 'azure-devops',
    organization,
    project: project || null,
    repo,
    url: remoteUrl,
    webUrl,
  };
}

export const parseAzureDevOpsRemoteUrl = (raw) => {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;

  let match = value.match(/^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/(.+)$/i);
  if (match) {
    return buildRef({ organization: cleanPart(match[1]), project: cleanPart(match[2]), repo: cleanPart(stripGitSuffix(match[3])), remoteUrl: value });
  }

  match = value.match(/^ssh:\/\/git@ssh\.dev\.azure\.com\/v3\/([^/]+)\/([^/]+)\/(.+)$/i);
  if (match) {
    return buildRef({ organization: cleanPart(match[1]), project: cleanPart(match[2]), repo: cleanPart(stripGitSuffix(match[3])), remoteUrl: value });
  }

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).map(cleanPart);

    if (hostname === 'dev.azure.com') {
      const organization = cleanPart(url.username || parts[0]);
      const offset = url.username && parts[0]?.toLowerCase() === organization.toLowerCase() ? 1 : (url.username ? 0 : 1);
      const project = parts[offset];
      const marker = parts[offset + 1];
      const repo = parts[offset + 2];
      if (organization && project && marker === '_git' && repo) {
        return buildRef({ organization, project, repo: stripGitSuffix(repo), remoteUrl: value });
      }
    }

    if (hostname.endsWith('.visualstudio.com')) {
      const organization = hostname.slice(0, -'.visualstudio.com'.length);
      if (parts[0] === '_git' && parts[1]) {
        return buildRef({ organization, project: null, repo: stripGitSuffix(parts[1]), remoteUrl: value });
      }
      if (parts[0] && parts[1] === '_git' && parts[2]) {
        return buildRef({ organization, project: parts[0], repo: stripGitSuffix(parts[2]), remoteUrl: value });
      }
    }
  } catch {
    return null;
  }

  return null;
};

export async function resolveAzureDevOpsRepoFromDirectory(directory, remoteName = 'origin', client = null) {
  const remoteUrl = await getRemoteUrl(directory, remoteName).catch(() => null);
  if (!remoteUrl) {
    return { repo: null, remoteUrl: null };
  }
  const parsed = parseAzureDevOpsRemoteUrl(remoteUrl);
  if (!parsed) {
    return { repo: null, remoteUrl };
  }
  if (!client || !parsed.project) {
    return { repo: parsed, remoteUrl };
  }

  const metadata = await client.request(`/${encodeURIComponent(parsed.project)}/_apis/git/repositories/${encodeURIComponent(parsed.repo)}`).catch(() => null);
  if (!metadata) {
    return { repo: parsed, remoteUrl };
  }
  return {
    remoteUrl,
    repo: {
      ...parsed,
      repositoryId: metadata.id,
      repo: metadata.name || parsed.repo,
      defaultBranch: metadata.defaultBranch || null,
      webUrl: metadata.webUrl || parsed.webUrl,
      url: metadata.remoteUrl || parsed.url,
      project: metadata.project?.name || parsed.project,
      projectId: metadata.project?.id || null,
    },
  };
}
