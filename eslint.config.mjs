import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import i18next from "eslint-plugin-i18next";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The staff app is translated (src/lib/i18n): words on its screens come
  // from t("…"), never typed into the screen, or they stay English in every
  // language. Not the pages only Kikai or a salon's clients see (admin, the
  // public booking pages, the sales funnel, the legal pages), which are
  // English on purpose.
  {
    files: ["src/app/**/*.tsx", "src/components/**/*.tsx"],
    ignores: [
      "src/app/admin/**",
      "src/components/admin/**",
      "src/components/usage/admin-usage-table.tsx",
      "src/app/s/**",
      "src/components/online-booking/**",
      "src/components/funnel/**",
      "src/app/privacy-policy/**",
      "src/app/terms-of-service/**",
      "src/app/data-deletion/**",
      // Kikai's own receptionist lab.
      "src/app/receptionist/**",
      "src/components/receptionist/**",
      // What clients see: the website chat, rebooking links.
      "src/app/embed/**",
      "src/app/r/**",
      "src/components/rebook/**",
      // Drawn when the app itself has failed, with nothing to translate with.
      "src/app/global-error.tsx",
    ],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-only",
          "jsx-attributes": {
            include: ["placeholder", "title", "alt", "aria-label", "aria-description", "label", "description", "hint", "heading", "confirmLabel", "emptyText"],
          },
          // Arguments that are code, not words: date patterns, class names,
          // addresses, keys.
          callees: {
            exclude: [
              "i18n(ext)?", "t", "require", "format", "day", "cn", "clsx", "withAsOrg", "apiFetch", "fetch",
              "encodeURIComponent", "includes", "startsWith", "endsWith", "indexOf", "replace", "split", "join",
              "get", "set", "has", "addEventListener", "removeEventListener", "getElementById", "querySelector",
              "matchMedia", "toLocaleDateString", "toLocaleString", "toLocaleTimeString", "Intl.*", "useState",
            ],
          },
          words: {
            exclude: [
              // Symbols, numbers, phone numbers and single letters.
              "[0-9\\s!-/:-@[-`{-~·×…–—•→←↑↓✓✕+£©]+",
              ".",
              // Code words that never reach the screen ("day", "weekly",
              // "numeric"), and constants.
              "[a-z][a-zA-Z0-9_]*",
              "[A-Z_-]+",
              // The product's name, and example addresses ("yoursalon.co.uk",
              // "you@company.co.uk").
              "Kikai",
              "©\\s*Kikai",
              "[^\\s@]*@?[a-z0-9-]+(\\.[a-z0-9-]+)+",
              "…@[a-z0-9.-]+",
            ],
          },
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
