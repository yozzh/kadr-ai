/// <reference types="vite/client" />

declare module "node:fs" {
  export function readFileSync(path: string | URL, encoding: string): string;
}


interface ImportMetaEnv {
  readonly VITE_CONVEX_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
