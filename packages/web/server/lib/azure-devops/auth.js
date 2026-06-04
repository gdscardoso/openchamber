import fs from 'fs';
import path from 'path';
import os from 'os';

const OPENCHAMBER_DATA_DIR = process.env.OPENCHAMBER_DATA_DIR
  ? path.resolve(process.env.OPENCHAMBER_DATA_DIR)
  : path.join(os.homedir(), '.config', 'openchamber');

const STORAGE_DIR = OPENCHAMBER_DATA_DIR;
const STORAGE_FILE = path.join(STORAGE_DIR, 'azure-devops-auth.json');

function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

function readJsonFile() {
  ensureStorageDir();
  if (!fs.existsSync(STORAGE_FILE)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(STORAGE_FILE, 'utf8').trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    console.error('Failed to read Azure DevOps auth file:', error);
    return null;
  }
}

function writeJsonFile(payload) {
  ensureStorageDir();
  const tmpFile = `${STORAGE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), 'utf8');
  try {
    fs.chmodSync(tmpFile, 0o600);
  } catch {
    // best-effort
  }
  fs.renameSync(tmpFile, STORAGE_FILE);
  try {
    fs.chmodSync(STORAGE_FILE, 0o600);
  } catch {
    // best-effort
  }
}

const normalizeOrganization = (value) => String(value || '').trim().replace(/^https?:\/\//, '').replace(/^dev\.azure\.com\//, '').replace(/\.visualstudio\.com.*$/, '').replace(/\/.*$/, '').toLowerCase();

function normalizeAuthEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const pat = typeof entry.pat === 'string' ? entry.pat : '';
  const organization = normalizeOrganization(entry.organization);
  if (!pat || !organization) return null;
  const accountId = typeof entry.accountId === 'string' && entry.accountId.trim()
    ? entry.accountId.trim()
    : organization;
  return {
    accountId,
    organization,
    pat,
    label: typeof entry.label === 'string' ? entry.label.trim() : '',
    user: entry.user && typeof entry.user === 'object' ? entry.user : null,
    createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : null,
    current: Boolean(entry.current),
  };
}

function normalizeAuthList(raw) {
  const list = (Array.isArray(raw) ? raw : [raw]).map(normalizeAuthEntry).filter(Boolean);
  if (!list.length) {
    return { list: [], changed: false };
  }
  let currentFound = false;
  let changed = false;
  list.forEach((entry) => {
    if (entry.current && !currentFound) {
      currentFound = true;
      return;
    }
    if (entry.current) {
      entry.current = false;
      changed = true;
    }
  });
  if (!currentFound) {
    list[0].current = true;
    changed = true;
  }
  return { list, changed };
}

function readAuthList() {
  const data = readJsonFile();
  if (!data) return [];
  const { list, changed } = normalizeAuthList(data);
  if (changed) writeJsonFile(list);
  return list;
}

function toAccount(entry) {
  return {
    id: entry.accountId,
    organization: entry.organization,
    label: entry.label || entry.organization,
    user: entry.user || null,
    current: Boolean(entry.current),
  };
}

export function getAzureDevOpsAuth() {
  const list = readAuthList();
  if (!list.length) return null;
  return list.find((entry) => entry.current) || list[0] || null;
}

export function getAzureDevOpsAuthAccounts() {
  return readAuthList().map(toAccount);
}

export function setAzureDevOpsAuth({ organization, pat, label, user, accountId }) {
  const normalizedOrganization = normalizeOrganization(organization);
  if (!normalizedOrganization) {
    throw new Error('organization is required');
  }
  if (!pat || typeof pat !== 'string') {
    throw new Error('pat is required');
  }

  const resolvedAccountId = typeof accountId === 'string' && accountId.trim()
    ? accountId.trim()
    : normalizedOrganization;
  const list = readAuthList();
  const existingIndex = list.findIndex((entry) => entry.accountId === resolvedAccountId);
  const nextEntry = {
    accountId: resolvedAccountId,
    organization: normalizedOrganization,
    pat,
    label: typeof label === 'string' ? label.trim() : '',
    user: user && typeof user === 'object' ? user : null,
    createdAt: Date.now(),
    current: true,
  };
  if (existingIndex >= 0) {
    list[existingIndex] = nextEntry;
  } else {
    list.push(nextEntry);
  }
  const currentIndex = existingIndex >= 0 ? existingIndex : list.length - 1;
  list.forEach((entry, index) => {
    entry.current = index === currentIndex;
  });
  writeJsonFile(list);
  return nextEntry;
}

export function activateAzureDevOpsAuth(accountId) {
  const id = typeof accountId === 'string' ? accountId.trim() : '';
  if (!id) return false;
  const list = readAuthList();
  const index = list.findIndex((entry) => entry.accountId === id);
  if (index === -1) return false;
  list.forEach((entry, idx) => {
    entry.current = idx === index;
  });
  writeJsonFile(list);
  return true;
}

export function clearAzureDevOpsAuth() {
  const list = readAuthList();
  if (!list.length) return true;
  const remaining = list.filter((entry) => !entry.current);
  if (!remaining.length) {
    if (fs.existsSync(STORAGE_FILE)) fs.unlinkSync(STORAGE_FILE);
    return true;
  }
  remaining.forEach((entry, index) => {
    entry.current = index === 0;
  });
  writeAuthList(remaining);
  return true;
}

function writeAuthList(list) {
  writeJsonFile(list);
}

export const AZURE_DEVOPS_AUTH_FILE = STORAGE_FILE;
