import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { task } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

/** The protocol: the factory organisers create events from, the fixed event code each event clones, the case writer. */
const PROTOCOL = ["PresenceFactory", "PresenceEvent", "PresenceCaseWriter"] as const;
/** Test stand-ins the app and the simulations deploy on a local chain. */
const MOCKS = ["MockKlerosLiquid", "MockArbitrableProxy", "TestWallet", "GasBurners", "TestToken"] as const;

export const DEPLOYMENTS_DIR = path.join(__dirname, "..", "deployments-live");

/** One file per network in deployments-live/ (the file name is the network key, e.g. ethereum.json). */
export function readDeployments(dir = DEPLOYMENTS_DIR) {
  const out: Record<string, unknown> = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort())
    out[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
  return out;
}

const idOf = (name: string) => name[0]!.toLowerCase() + name.slice(1);

export async function exportAbis(
  hre: HardhatRuntimeEnvironment,
  { deploymentsDir = DEPLOYMENTS_DIR, outputDir = path.join(__dirname, "..", "generated") } = {},
) {
  await hre.run("compile", { quiet: true });
  const lines: string[] = [];
  for (const name of [...PROTOCOL, ...MOCKS]) {
    let artifact;
    try {
      artifact = await hre.artifacts.readArtifact(name);
    } catch {
      if ((PROTOCOL as readonly string[]).includes(name)) throw new Error(`${name} did not compile`);
      continue;
    }
    lines.push(
      `export const ${idOf(name)}Abi = ${JSON.stringify(artifact.abi)} as const;`,
      `export const ${idOf(name)}Bytecode = "${artifact.bytecode}" as const;`,
      "",
    );
  }
  const deployments = readDeployments(deploymentsDir);
  const { sepolia: sepoliaKleros, ...protocol } = deployments;

  const file = path.join(outputDir, "index.ts");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    [
      "// Written by `hardhat export-abis`; do not edit.",
      "",
      ...lines,
      "/** The protocol on each network it is deployed on (deployments-live/<network>.json), by network key. */",
      `export const deployments = ${JSON.stringify(protocol)} as const;`,
      "",
      "/** Kleros Court v1 test deployments (no protocol yet): sepolia = KlerosLiquid + Dispute Resolver. */",
      `export const testnets = ${JSON.stringify({ sepolia: sepoliaKleros ?? null })} as const;`,
      "",
    ].join("\n"),
  );
  console.log("Wrote %s", path.relative(process.cwd(), file));

  const docs = path.join(outputDir, "docs.ts");
  const text = (name: string) => JSON.stringify(readFileSync(path.join(__dirname, "..", "docs", name), "utf8"));
  writeFileSync(
    docs,
    [
      "// Written by `hardhat export-abis` from docs/; do not edit.",
      "",
      "/** The jurors' rules every event shares (docs/attendance-policy.md), pinned on IPFS before the protocol is deployed. */",
      `export const policyText = ${text("attendance-policy.md")};`,
      "/** The case description template (docs/metaevidence.template.json); the case writer fills it for each case. */",
      `export const caseTemplateText = ${text("metaevidence.template.json")};`,
      "",
    ].join("\n"),
  );
  console.log("Wrote %s", path.relative(process.cwd(), docs));
}

task("export-abis", "Writes generated/index.ts (ABIs, bytecode, deployments) and generated/docs.ts").setAction(
  async (_args, hre) => {
    await exportAbis(hre);
  },
);
