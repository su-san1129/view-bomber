export const textExtensions = [
  "txt",
  "text",
  "log",
  "ini",
  "cfg",
  "conf",
  "yaml",
  "yml",
  "toml",
  "xml",
  "sql",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "bat",
  "cmd",
  "c",
  "h",
  "cpp",
  "hpp",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "css",
  "scss",
  "less",
  "swift",
  "kt",
  "dart",
  "lua",
  "php",
  "r",
  "properties",
  "editorconfig",
  "gitignore",
  "ndjson"
];

export const textSpecialFileNames = [
  "dockerfile",
  "makefile",
  "gnumakefile",
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
  ".gitignore",
  ".editorconfig"
];

function getLowerFileName(filePath: string): string {
  const rawName = filePath.split(/[/\\]/).pop() ?? "";
  return rawName.toLowerCase();
}

export function isTextSpecialFileName(filePath: string): boolean {
  return textSpecialFileNames.includes(getLowerFileName(filePath));
}
