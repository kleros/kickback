import { isAddress, type Address } from "viem";

/** An event created from this browser: a convenience list, kept in local storage only. */
export interface BrowserDeployment {
  address: Address;
  chainId: number;
  block: number;
  name: string;
}
export const DEPLOYMENTS_KEY = "kickback.organise.deployments.v1";
export interface DeploymentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readDeployments(storage?: DeploymentStorage): BrowserDeployment[] {
  try {
    const rows: unknown = JSON.parse((storage ?? globalThis.localStorage).getItem(DEPLOYMENTS_KEY) ?? "[]");
    if (!Array.isArray(rows)) return [];
    return rows.filter(
      (row): row is BrowserDeployment =>
        !!row &&
        typeof row === "object" &&
        isAddress(row.address) &&
        Number.isSafeInteger(row.chainId) &&
        row.chainId > 0 &&
        Number.isSafeInteger(row.block) &&
        row.block >= 0 &&
        typeof row.name === "string",
    );
  } catch {
    return [];
  }
}

export function saveDeployment(deployment: BrowserDeployment, storage?: DeploymentStorage): boolean {
  try {
    const target = storage ?? globalThis.localStorage;
    const rows = readDeployments(target).filter(
      (r) => r.chainId !== deployment.chainId || r.address.toLowerCase() !== deployment.address.toLowerCase(),
    );
    target.setItem(DEPLOYMENTS_KEY, JSON.stringify([deployment, ...rows]));
    return true;
  } catch {
    return false;
  }
}
