/**
 * Markdown follows punctuation-sensitive emphasis rules. In Korean prose,
 * `**PGA(Process Global Area)**는` can therefore remain literal because the
 * closing marker follows `)` and is immediately followed by a Korean letter.
 *
 * Repair only paired bold markers that the Markdown parser left as plain text.
 * Code blocks and inline code are represented by non-text nodes, so technical
 * asterisks inside them remain untouched.
 */
export function remarkRepairBoldMarkers() {
  return function repairBoldMarkers(tree) {
    visit(tree);
  };
}

function visit(node) {
  if (!Array.isArray(node.children)) return;

  const repairedChildren = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      repairedChildren.push(...repairText(child.value));
      continue;
    }

    visit(child);
    repairedChildren.push(child);
  }

  node.children = repairedChildren;
}

function repairText(value) {
  const markerPattern = /\*\*([^\n]+?)\*\*/g;
  const nodes = [];
  let cursor = 0;
  let match;

  while ((match = markerPattern.exec(value)) !== null) {
    const emphasizedText = match[1].trim();
    if (!emphasizedText) continue;

    if (match.index > cursor) {
      nodes.push({ type: "text", value: value.slice(cursor, match.index) });
    }
    nodes.push({
      type: "strong",
      children: [{ type: "text", value: emphasizedText }],
    });
    cursor = markerPattern.lastIndex;
  }

  if (cursor === 0) return [{ type: "text", value }];
  if (cursor < value.length) {
    nodes.push({ type: "text", value: value.slice(cursor) });
  }
  return nodes;
}
