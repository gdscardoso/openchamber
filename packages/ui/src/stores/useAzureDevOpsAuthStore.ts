import { create } from 'zustand';
import type { AzureDevOpsAuthStatus, RuntimeAPIs } from '@/lib/api/types';
import { runtimeFetch } from '@/lib/runtime-fetch';

type AzureDevOpsAuthStatusWithError = AzureDevOpsAuthStatus & { error?: string };

type AzureDevOpsAuthStore = {
  status: AzureDevOpsAuthStatusWithError | null;
  isLoading: boolean;
  hasChecked: boolean;
  setStatus: (status: AzureDevOpsAuthStatusWithError | null) => void;
  refreshStatus: (
    runtimeAzureDevOps?: RuntimeAPIs['azureDevOps'],
    options?: { force?: boolean }
  ) => Promise<AzureDevOpsAuthStatusWithError | null>;
};

const fetchStatus = async (
  runtimeAzureDevOps?: RuntimeAPIs['azureDevOps']
): Promise<AzureDevOpsAuthStatusWithError> => {
  if (runtimeAzureDevOps) {
    return runtimeAzureDevOps.authStatus();
  }

  const response = await runtimeFetch('/api/azure-devops/auth/status', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const payload = (await response.json().catch(() => null)) as AzureDevOpsAuthStatusWithError | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error || response.statusText || 'Failed to load Azure DevOps status');
  }
  return payload;
};

let inFlightAuthRefresh: Promise<AzureDevOpsAuthStatusWithError | null> | null = null;

export const useAzureDevOpsAuthStore = create<AzureDevOpsAuthStore>((set, get) => ({
  status: null,
  isLoading: false,
  hasChecked: false,
  setStatus: (status) => set({ status, hasChecked: true }),
  refreshStatus: async (runtimeAzureDevOps, options) => {
    const { hasChecked, status } = get();
    if (hasChecked && !options?.force) {
      return status;
    }
    if (inFlightAuthRefresh) return inFlightAuthRefresh;

    set({ isLoading: true });
    inFlightAuthRefresh = (async () => {
      try {
        const payload = await fetchStatus(runtimeAzureDevOps);
        set({ status: payload, isLoading: false, hasChecked: true });
        return payload;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({ status: { connected: false, error: message }, isLoading: false, hasChecked: true });
        return null;
      }
    })().finally(() => {
      inFlightAuthRefresh = null;
    });

    return inFlightAuthRefresh;
  },
}));
