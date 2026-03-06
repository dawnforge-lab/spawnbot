/**
 * Mermaid Flowchart Parser — converts Mermaid flowchart syntax to a Flow graph.
 *
 * Supports: flowchart/graph directives, node shapes ([], (), {}),
 * edge labels (-->|label| and -- label -->), comments (%%),
 * and auto-classification of begin/end/task/decision nodes.
 */

/**
 * @typedef {{ id: string, label: string, kind: 'begin'|'end'|'task'|'decision' }} FlowNode
 * @typedef {{ src: string, dst: string, label: string|null }} FlowEdge
 * @typedef {{ nodes: Map<string, FlowNode>, edges: Map<string, FlowEdge[]>, beginId: string, endId: string }} Flow
 */

// Directives to strip (styling, interaction, subgraphs)
const STRIP_PREFIXES = ['classDef', 'classdef', 'style', 'linkStyle', 'linkstyle', 'click', 'subgraph', 'end'];

// Node shape patterns: id["label"], id(label), id{label}, id([label]), id(["label"])
const NODE_PATTERN = /^([A-Za-z_][\w]*)\s*(\[["']?|{["']?|\([\["']?)/;

/**
 * Parse a Mermaid flowchart string into a Flow graph.
 * @param {string} source — raw Mermaid source
 * @returns {Flow}
 */
export function parseMermaid(source) {
  const lines = source.split('\n');
  const rawNodes = new Map();   // id → { id, label, shape }
  const rawEdges = [];          // [{ src, dst, label }]

  for (let line of lines) {
    // Strip comments
    const commentIdx = line.indexOf('%%');
    if (commentIdx !== -1) line = line.slice(0, commentIdx);
    line = line.trim();
    if (!line) continue;

    // Skip flowchart/graph directive
    if (/^(flowchart|graph)\s/i.test(line)) continue;

    // Skip styling directives
    const firstWord = line.split(/\s/)[0];
    if (STRIP_PREFIXES.includes(firstWord)) continue;

    // Parse line for nodes and edges
    parseLine(line, rawNodes, rawEdges);
  }

  // Build flow
  return buildFlow(rawNodes, rawEdges);
}

/**
 * Parse a single line for node definitions and edges.
 */
function parseLine(line, nodes, edges) {
  // Split on arrows: -->, --->, ====>, -- label -->, -->|label|
  // We need to handle: A --> B, A -->|label| B, A -- label --> B
  const segments = splitOnArrows(line);

  if (segments.length < 2) {
    // Single node definition (no arrow)
    const node = parseNodeDef(line.trim());
    if (node) nodes.set(node.id, node);
    return;
  }

  // Process chain: A --> B --> C (creates edges A→B, B→C)
  for (let i = 0; i < segments.length - 1; i++) {
    const srcDef = segments[i].node.trim();
    const dstDef = segments[i + 1].node.trim();
    const label = segments[i].edgeLabel || null;

    const srcNode = parseNodeDef(srcDef);
    const dstNode = parseNodeDef(dstDef);

    if (srcNode) nodes.set(srcNode.id, nodes.get(srcNode.id) || srcNode);
    if (dstNode) nodes.set(dstNode.id, nodes.get(dstNode.id) || dstNode);

    if (srcNode && dstNode) {
      edges.push({ src: srcNode.id, dst: dstNode.id, label });
    }
  }
}

/**
 * Split a line on arrow patterns, extracting edge labels.
 * Returns: [{ node: string, edgeLabel: string|null }, ...]
 */
function splitOnArrows(line) {
  const results = [];
  // Match arrows with optional labels:
  //   -->|label|  or  -- label -->  or  --> or ---> or ===>
  const arrowPattern = /\s*(?:--+>|==+>|--+\s+([^-]+?)\s*--+>|--+>)\s*\|([^|]*)\|\s*|\s*(--+>|==+>)\s*/g;

  // Simpler approach: find all arrows and split
  const parts = [];
  let lastIdx = 0;

  // Combined pattern for all arrow types with labels
  const fullPattern = /\s*(?:(-+>|=+>)\|([^|]+)\||(--?\s+([^-\n]+?)\s*-+>)|(-+>|=+>))\s*/g;
  let match;

  while ((match = fullPattern.exec(line)) !== null) {
    const before = line.slice(lastIdx, match.index);
    let label = null;

    if (match[2]) {
      // -->|label| format
      label = match[2].trim();
    } else if (match[4]) {
      // -- label --> format
      label = match[4].trim();
    }

    parts.push({ node: before, edgeLabel: label });
    lastIdx = match.index + match[0].length;
  }

  // Remaining text after last arrow
  if (lastIdx < line.length) {
    parts.push({ node: line.slice(lastIdx), edgeLabel: null });
  } else if (parts.length > 0) {
    // Edge case: line ends with arrow (shouldn't happen in valid Mermaid)
  }

  return parts.length >= 2 ? parts : [{ node: line, edgeLabel: null }];
}

/**
 * Parse a node definition: id["label"], id(label), id{label}, etc.
 * Returns { id, label, shape } or null.
 */
function parseNodeDef(text) {
  text = text.trim();
  if (!text) return null;

  // Try shaped nodes: id["label"], id(label), id{label}, id([label]), id(["label"])
  const shaped = /^([A-Za-z_][\w]*)\s*(\[|\(|\{)(\[?"?)(.+?)("?\]?)(\]|\)|\})\s*$/.exec(text);
  if (shaped) {
    const id = shaped[1];
    const openBracket = shaped[2];
    let label = shaped[4].trim();

    // Strip surrounding quotes
    label = label.replace(/^["']|["']$/g, '');

    let shape = 'rect';
    if (openBracket === '(') shape = 'round';
    if (openBracket === '{') shape = 'diamond';

    // Check for ([...]) — stadium shape (used for begin/end)
    if (text.includes('([') || text.includes('(["')) shape = 'stadium';

    return { id, label, shape };
  }

  // Bare node (just an ID)
  const bare = /^([A-Za-z_][\w]*)$/.exec(text);
  if (bare) {
    return { id: bare[1], label: bare[1], shape: 'rect' };
  }

  return null;
}

/**
 * Build a validated Flow from raw nodes and edges.
 */
function buildFlow(rawNodes, rawEdges) {
  const nodes = new Map();
  const edgeMap = new Map();

  // Count outgoing edges per node
  const outCount = new Map();
  for (const edge of rawEdges) {
    outCount.set(edge.src, (outCount.get(edge.src) || 0) + 1);
  }

  // Count incoming edges per node
  const inCount = new Map();
  for (const edge of rawEdges) {
    inCount.set(edge.dst, (inCount.get(edge.dst) || 0) + 1);
  }

  // Classify nodes
  let beginId = null;
  let endId = null;

  for (const [id, raw] of rawNodes) {
    let kind = 'task';
    const labelLower = raw.label.toLowerCase();

    // Begin: label matches or stadium shape with no incoming edges
    if (
      labelLower === 'begin' || labelLower === 'start' ||
      (raw.shape === 'stadium' && !inCount.get(id))
    ) {
      kind = 'begin';
      if (beginId) throw new FlowParseError(`Multiple begin nodes: "${beginId}" and "${id}"`);
      beginId = id;
    }
    // End: label matches or stadium shape with no outgoing edges
    else if (
      labelLower === 'end' || labelLower === 'finish' ||
      (raw.shape === 'stadium' && !outCount.get(id))
    ) {
      kind = 'end';
      if (endId) throw new FlowParseError(`Multiple end nodes: "${endId}" and "${id}"`);
      endId = id;
    }
    // Decision: multiple outgoing edges or diamond shape
    else if ((outCount.get(id) || 0) > 1 || raw.shape === 'diamond') {
      kind = 'decision';
    }

    nodes.set(id, { id, label: raw.label, kind });
  }

  if (!beginId) throw new FlowParseError('No begin node found (use BEGIN, Start, or ([...]) shape)');
  if (!endId) throw new FlowParseError('No end node found (use END, Finish, or ([...]) shape)');

  // Build edge map
  for (const edge of rawEdges) {
    if (!edgeMap.has(edge.src)) edgeMap.set(edge.src, []);
    edgeMap.get(edge.src).push(edge);
  }

  // Validate decision nodes have labeled edges
  for (const [id, node] of nodes) {
    if (node.kind === 'decision') {
      const outEdges = edgeMap.get(id) || [];
      const unlabeled = outEdges.filter(e => !e.label);
      if (unlabeled.length > 0) {
        throw new FlowParseError(
          `Decision node "${id}" has ${unlabeled.length} unlabeled edge(s). All outgoing edges from decision nodes must have labels.`
        );
      }
    }
  }

  // Validate reachability: END must be reachable from BEGIN
  const visited = new Set();
  const stack = [beginId];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const edge of edgeMap.get(cur) || []) {
      stack.push(edge.dst);
    }
  }

  if (!visited.has(endId)) {
    throw new FlowParseError(`End node "${endId}" is not reachable from begin node "${beginId}"`);
  }

  return { nodes, edges: edgeMap, beginId, endId };
}

export class FlowParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FlowParseError';
  }
}
