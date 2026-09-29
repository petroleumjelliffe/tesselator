// The unit tests read fixtures with Node's fs; @types/node is not a dependency, so type the one call they use.
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
}
