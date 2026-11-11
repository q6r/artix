import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // eslint-config-next 16 turns the React Compiler rules on as errors. This code base predates
    // them, so they stay visible as warnings and are worked off file by file. They flag patterns
    // that run fine today (state synced in effects, components declared during render), not bugs.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Separate Node (CommonJS) service with its own package.json; CI runs `node --check` on it.
    "container-agent/**",
    // The Rust crate.
    "backend/**",
  ]),
]);

export default eslintConfig;
