import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"],
        },
      },
    },
    rules: {
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          brands: ["Anthropic", "ChatGPT", "Chatting with AI Plus", "OAuth", "OpenAI"],
          acronyms: ["AI", "API", "CLI", "ID"],
        },
      ],
    },
  },
]);
