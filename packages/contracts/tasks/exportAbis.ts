import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { task } from "hardhat/config";

import { LIVE_DIR, liveBuild } from "../scripts/liveBuild";

/** Test stand-ins the app and the simulations deploy on a local chain. */
const MOCKS = [
  "MockKlerosLiquid",
  "MockArbitrableProxy",
  "TestWallet",
  "GasBurners",
  "TestToken",
] as const;

export function fingerprint(code: string, immutables: [number, number][]): `0x${string}` {
  const bytes = Buffer.from(code.replace(/^0x/, ""), "hex");
  for (const [start, length] of immutables) bytes.fill(0, start, start + length);
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

task("export-abis", "Writes generated/index.ts: ABIs, the live build of TruthPaysKickback and its code fingerprint")
  .setAction(async (_args, hre) => {
    await hre.run("compile", { quiet: true });
    const live = liveBuild();
    const deployment = JSON.parse(readFileSync(path.join(LIVE_DIR, "deployment.json"), "utf8"));

    const mocks: string[] = [];
    for (const name of MOCKS) {
      let artifact;
      try {
        artifact = await hre.artifacts.readArtifact(name);
      } catch {
        continue;
      }
      const id = name[0]!.toLowerCase() + name.slice(1);
      mocks.push(
        `export const ${id}Abi = ${JSON.stringify(artifact.abi)} as const;`,
        `export const ${id}Bytecode = "${artifact.bytecode}" as const;`,
        "",
      );
    }

    const file = path.join(__dirname, "..", "generated", "index.ts");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      [
        "// Written by `hardhat export-abis`; do not edit.",
        "",
        "/** TruthPaysKickback v7 as verified on Etherscan: the ABI, creation code and runtime fingerprint of the live build. */",
        `export const kickbackAbi = ${JSON.stringify(live.abi)} as const;`,
        `export const kickbackBytecode = "${live.bytecode}" as const;`,
        "/** [start, length] byte ranges of the immutables in the runtime code, zeroed before fingerprinting */",
        `export const kickbackImmutables = ${JSON.stringify(live.immutables)} as const;`,
        "/** SHA-256 of the runtime code with its immutables zeroed: equal for every deployment of this build */",
        `export const kickbackFingerprint = "${fingerprint(live.deployedBytecode, live.immutables)}" as const;`,
        "",
        "/** The Truth Pays event on Ethereum mainnet. */",
        "export const liveEvent = {",
        `  chainId: ${deployment.chainId},`,
        `  address: "${deployment.contract}",`,
        `  deployBlock: ${deployment.deployBlock},`,
        `  owner: "${deployment.owner}",`,
        `  disputeResolver: "${deployment.constructor.disputeResolver}",`,
        `  arbitrator: "${deployment.constructor.arbitrator}",`,
        `  policyURI: "${deployment.constructor.policyURI}",`,
        "} as const;",
        "",
        ...mocks,
      ].join("\n"),
    );
    console.log("Wrote %s", path.relative(process.cwd(), file));
  });
