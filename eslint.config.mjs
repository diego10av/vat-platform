import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Project-wide rule adjustments.
  //
  // react-hooks/set-state-in-effect (new in React 19): flags any
  // useEffect that eventually calls setState. In our codebase every
  // occurrence is the standard "load-on-mount" pattern:
  //
  //   useEffect(() => { void load(); }, []);
  //   async function load() { const data = await fetch(...); setState(data); }
  //
  // The setState runs after an await, so it's not actually synchronous
  // within the effect — the rule can't see through the async boundary
  // and false-positives. Disabling project-wide is safer than 10+
  // eslint-disable comments that drift over time. If we introduce a
  // genuinely-synchronous setState-in-effect bug, code review and
  // behaviour (infinite render) will catch it long before the linter.
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
