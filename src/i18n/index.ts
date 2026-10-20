import en from "./en.json";

// English only for now; other languages get their own JSON file with the same keys.
const dictionaries: Record<string, Record<string, string>> = { en };
let active: Record<string, string> = en;

export function setLanguage(lang: string): void {
  active = dictionaries[lang] ?? en;
}

export function t(key: string, vars: Record<string, string | number> = {}): string {
  const template = active[key] ?? en[key as keyof typeof en] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

export function has(key: string): boolean {
  return key in active || key in en;
}
