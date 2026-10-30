import { libraryConfig } from "@kickback/eslint-config/library";

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: [".prettierrc.cjs", "artifacts/**", "cache/**", "generated/**", "deployments/**"],
  },
  ...libraryConfig,
];
