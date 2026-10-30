import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { expect } from "chai";

import { DEFAULT_LOCAL_NODE_URL, localNodeUrl, nodeAddress } from "../tasks/localNode";

const PKG = path.join(__dirname, "..");
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : sources(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

describe("local node address", function () {
  it("LOCAL_NODE_URL sets the clients' URL and the host and port local-node binds", function () {
    expect(localNodeUrl({})).to.equal(DEFAULT_LOCAL_NODE_URL);
    expect(nodeAddress(localNodeUrl({}))).to.deep.equal({ hostname: "127.0.0.1", port: 8545 });
    expect(nodeAddress(localNodeUrl({ LOCAL_NODE_URL: "http://127.0.0.1:8547" }))).to.deep.equal({
      hostname: "127.0.0.1",
      port: 8547,
    });
    expect(nodeAddress("http://localhost")).to.deep.equal({ hostname: "localhost", port: 80 });
    expect(() => nodeAddress("ws://127.0.0.1:8545")).to.throw(/http:\/\//);
  });

  it("the local-node scripts take the port from LOCAL_NODE_URL, not a fixed --port", function () {
    const { scripts } = json(path.join(PKG, "package.json"));
    expect(scripts["local-node"]).to.equal("hardhat local-node");
    expect(scripts["local-node:mainnet-fork"]).to.equal("HARDHAT_FORK=mainnet hardhat local-node");
  });

  it("every environment variable the package reads is declared to turbo", function () {
    const root = json(path.join(PKG, "..", "..", "turbo.json"));
    const own = json(path.join(PKG, "turbo.json"));
    const declared = new Set<string>([...(root.globalEnv ?? []), ...(root.globalPassThroughEnv ?? [])]);
    for (const t of [...Object.values(root.tasks), ...Object.values(own.tasks)] as Record<string, string[]>[])
      for (const name of [...(t.env ?? []), ...(t.passThroughEnv ?? [])]) declared.add(name);
    const files = [
      path.join(PKG, "hardhat.config.ts"),
      ...["tasks", "scripts", "local", "abis", "test"].flatMap((d) => sources(path.join(PKG, d))),
    ];
    const read = new Set<string>();
    for (const f of files)
      for (const m of readFileSync(f, "utf8").matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) read.add(m[1]!);
    expect([...read].filter((name) => !declared.has(name))).to.deep.equal([]);
    expect(read).to.include("LOCAL_NODE_URL");
  });
});
