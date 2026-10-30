import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The contracts package root, where the live and generic texts live (docs/). */
export const contractsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../contracts");
/** A text file of the contracts package, by its path inside it ("docs/…"). */
export const read = (file: string): string => fs.readFileSync(path.join(contractsDir, file), "utf8");
export const readBytes = (file: string): Buffer => fs.readFileSync(path.join(contractsDir, file));
