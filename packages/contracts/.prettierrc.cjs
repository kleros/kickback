const base = require("@kickback/prettier-config");

/** @type {import("prettier").Config} */
module.exports = {
  ...base,
  overrides: [
    {
      files: "*.sol",
      options: {
        plugins: ["prettier-plugin-solidity"],
      },
    },
  ],
};
