import { getAzureDevOpsAuth } from './auth.js';

const API_VERSION = '7.1';

function encodePathPart(value) {
  return encodeURIComponent(String(value || '').trim());
}

export function createAzureDevOpsClient(auth = getAzureDevOpsAuth()) {
  if (!auth?.pat || !auth.organization) {
    return null;
  }

  const request = async (path, options = {}) => {
    const organization = encodePathPart(options.organization || auth.organization);
    const relativePath = String(path || '').startsWith('/') ? path : `/${path}`;
    const url = new URL(`https://dev.azure.com/${organization}${relativePath}`);
    if (!url.searchParams.has('api-version')) {
      url.searchParams.set('api-version', API_VERSION);
    }
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`:${auth.pat}`).toString('base64')}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const error = new Error(data?.message || data?.error?.message || response.statusText || 'Azure DevOps request failed');
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  };

  return {
    auth,
    request,
    async getProfile() {
      return request('/_apis/profile/profiles/me');
    },
  };
}

export function isAzureDevOpsAuthInvalid(error) {
  return error?.status === 401 || error?.status === 403;
}

export function normalizeAzureBranchRef(value) {
  const branch = String(value || '').trim().replace(/^refs\/heads\//, '').replace(/^heads\//, '');
  return branch ? `refs/heads/${branch}` : '';
}
