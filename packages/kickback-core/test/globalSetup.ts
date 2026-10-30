// One Hardhat node for the chain tests, on a free port so several runs can share a machine.
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

import type { TestProject } from "vitest/node";

import { contractsDir } from "./docs";

declare module "vitest" {
  export interface ProvidedContext {
    rpcUrl: string;
  }
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer().once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

export default async function setup(project: TestProject) {
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  // HARDHAT_FORK unset: a plain local chain (chainId 31337) even when the shell has it set
  const node = spawn(path.join(contractsDir, "node_modules/.bin/hardhat"), ["node", "--port", String(port)], {
    cwd: contractsDir,
    env: { ...process.env, HARDHAT_FORK: "" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  node.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  const exited = new Promise<void>((resolve) => node.once("exit", () => resolve()));
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) break;
    } catch {
      // not listening yet
    }
    if (node.exitCode !== null || Date.now() > deadline) {
      node.kill();
      throw new Error(`The Hardhat node did not start: ${stderr}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  project.provide("rpcUrl", rpcUrl);
  return async () => {
    node.kill("SIGTERM");
    await exited;
  };
}
