// Public build has no private diagrams or asset URL registry.
export const PRIVATE_DIAGRAMS: Readonly<Record<string, { scope: 'skct' | 'ipe'; svg: string }>> = Object.freeze({});
export const SKCT_PRIVATE_DIAGRAM_URLS: Readonly<Record<string, string>> = Object.freeze({});
export const IPE_PRIVATE_DIAGRAM_URLS: Readonly<Record<string, string>> = Object.freeze({});
