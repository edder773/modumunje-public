import { PRIVATE_DIAGRAMS } from "./private-diagrams.synthetic";

const dimensions = new Map<string, { width: number; height: number }>();

// Add only dimensions of assets already authorized in this question response.
// The complete diagram registry and SVG bodies remain on the server.
export function withPrivateDiagramDimensions(assets: unknown): unknown[] {
  if (!Array.isArray(assets)) return [];
  return assets.map(asset => {
    if (!asset || typeof asset !== "object" || typeof asset.sha256 !== "string"
      || !String(asset.path).startsWith("assets/skct-personal/")) return asset;
    const url = `/api/private-diagrams/skct/${asset.sha256}.svg`;
    const diagram = PRIVATE_DIAGRAMS[url];
    if (!diagram) return asset;
    let size = dimensions.get(url);
    if (!size) {
      const tag = diagram.svg.match(/<svg\b[^>]*>/u)?.[0] ?? "";
      const width = Number(tag.match(/\bwidth="([0-9.]+)"/u)?.[1]);
      const height = Number(tag.match(/\bheight="([0-9.]+)"/u)?.[1]);
      if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return asset;
      size = { width, height };
      dimensions.set(url, size);
    }
    return { ...asset, ...size };
  });
}
