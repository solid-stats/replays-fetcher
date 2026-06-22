export type SourceTransport = "direct" | "ssh";

// Runtime tuple of the SourceTransport members. `satisfies` keeps it in lockstep
// with the union (a member added to the type but missing here fails to compile).
// config.ts feeds this same tuple to z.enum, so the type, the runtime validator,
// and the values can never drift (CORR-01).
export const SOURCE_TRANSPORTS = [
  "direct",
  "ssh",
] as const satisfies readonly SourceTransport[];
