import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-azure-auth-'));
process.env.OPENCHAMBER_DATA_DIR = tempRoot;

const auth = await import('./auth.js');

describe('Azure DevOps auth storage', () => {
  beforeEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(tempRoot, { recursive: true });
  });

  it('stores PAT accounts without exposing PAT in account summaries', () => {
    auth.setAzureDevOpsAuth({ organization: 'Org', pat: 'secret-pat', label: 'Work' });
    const current = auth.getAzureDevOpsAuth();
    expect(current.pat).toBe('secret-pat');
    expect(current.organization).toBe('org');
    expect(auth.getAzureDevOpsAuthAccounts()).toEqual([
      expect.objectContaining({ id: 'org', organization: 'org', label: 'Work', current: true }),
    ]);
    expect(auth.getAzureDevOpsAuthAccounts()[0]).not.toHaveProperty('pat');
  });

  it('activates one account at a time', () => {
    auth.setAzureDevOpsAuth({ organization: 'one', pat: 'pat-one' });
    auth.setAzureDevOpsAuth({ organization: 'two', pat: 'pat-two' });
    expect(auth.getAzureDevOpsAuth().organization).toBe('two');
    expect(auth.activateAzureDevOpsAuth('one')).toBe(true);
    expect(auth.getAzureDevOpsAuth().organization).toBe('one');
  });
});
