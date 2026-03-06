/**
 * Flow Runner — executes a parsed Flow graph by calling wire.prompt() for each node.
 *
 * Task nodes: full LLM turn with a specific instruction.
 * Decision nodes: LLM chooses a branch via <choice>LABEL</choice>.
 * Begin/End: control flow markers (no LLM turn).
 */

import { EventEmitter } from 'events';

/**
 * @param {string} text — LLM response text
 * @returns {string|null} — extracted choice label or null
 */
function parseChoice(text) {
  const match = /<choice>(.*?)<\/choice>/is.exec(text);
  return match ? match[1].trim() : null;
}

/**
 * Case-insensitive edge label match.
 * @param {Array} edges — outgoing edges from a decision node
 * @param {string} choice — label the LLM chose
 * @returns {object|null} — matching edge or null
 */
function matchEdge(edges, choice) {
  if (!choice) return null;
  const lower = choice.toLowerCase();
  return edges.find(e => e.label && e.label.toLowerCase() === lower) || null;
}

export class FlowRunner extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.wire — WireClient instance
   * @param {object} opts.flow — parsed Flow graph from parseMermaid()
   * @param {string} opts.name — flow name (for logging)
   * @param {number} [opts.maxMoves=200] — safety limit on LLM turns
   * @param {number} [opts.maxRetries=2] — retries per decision before failing
   */
  constructor({ wire, flow, name, maxMoves = 200, maxRetries = 2 }) {
    super();
    this.wire = wire;
    this.flow = flow;
    this.name = name || 'unnamed';
    this.maxMoves = maxMoves;
    this.maxRetries = maxRetries;
    this.responses = [];
  }

  /**
   * Execute the flow from BEGIN to END.
   * @returns {{ completed: boolean, moves: number, responses: Array }}
   */
  async run() {
    let currentId = this.flow.beginId;
    let moves = 0;

    this.emit('start', { name: this.name, beginId: currentId });

    while (moves < this.maxMoves) {
      const node = this.flow.nodes.get(currentId);
      if (!node) {
        throw new FlowRunError(`Node "${currentId}" not found in flow "${this.name}"`);
      }

      // END — flow complete
      if (node.kind === 'end') {
        this.emit('end', { name: this.name, moves, responses: this.responses });
        return { completed: true, moves, responses: this.responses };
      }

      // BEGIN — skip to first connected node
      if (node.kind === 'begin') {
        const edges = this.flow.edges.get(currentId);
        if (!edges || edges.length === 0) {
          throw new FlowRunError(`Begin node "${currentId}" has no outgoing edges`);
        }
        currentId = edges[0].dst;
        continue;
      }

      // TASK or DECISION — execute an LLM turn
      const prompt = this._buildPrompt(node);
      this.emit('node_start', { nodeId: currentId, kind: node.kind, label: node.label });

      let responseText;
      try {
        const contentParts = [];
        const onContent = (data) => {
          if (data.type === 'text' && data.text) contentParts.push(data.text);
        };
        this.wire.on('content', onContent);
        try {
          const result = await this.wire.prompt(prompt);
          const streamed = contentParts.join('');
          responseText = streamed || this._extractResponse(result);
        } finally {
          this.wire.removeListener('content', onContent);
        }
      } catch (err) {
        throw new FlowRunError(`Wire prompt failed at node "${currentId}": ${err.message}`);
      }

      this.responses.push({ nodeId: currentId, label: node.label, response: responseText });
      moves++;

      this.emit('node_end', { nodeId: currentId, kind: node.kind, response: responseText, moves });

      if (node.kind === 'decision') {
        currentId = await this._resolveDecision(currentId, responseText);
      } else {
        // Task node — follow the single outgoing edge
        const edges = this.flow.edges.get(currentId);
        if (!edges || edges.length === 0) {
          throw new FlowRunError(`Task node "${currentId}" has no outgoing edge`);
        }
        currentId = edges[0].dst;
      }
    }

    throw new FlowRunError(`Flow "${this.name}" exceeded max moves (${this.maxMoves})`);
  }

  /**
   * Resolve a decision node: parse choice from response, retry if needed.
   */
  async _resolveDecision(nodeId, responseText) {
    const edges = this.flow.edges.get(nodeId) || [];
    const labels = edges.map(e => e.label).filter(Boolean);

    // Try to match from the initial response
    const choice = parseChoice(responseText);
    const edge = matchEdge(edges, choice);

    if (edge) {
      this.emit('decision', { nodeId, choice: edge.label });
      return edge.dst;
    }

    // Retry with explicit hint
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const retryPrompt = `[FLOW] Your choice "${choice || '(none)'}" didn't match any branch. Available branches:\n${labels.map(l => `- ${l}`).join('\n')}\n\nReply with exactly <choice>LABEL</choice> where LABEL is one of the options above.`;

      this.emit('decision_retry', { nodeId, attempt: attempt + 1, invalidChoice: choice });

      let retryText;
      try {
        const retryParts = [];
        const onRetryContent = (data) => {
          if (data.type === 'text' && data.text) retryParts.push(data.text);
        };
        this.wire.on('content', onRetryContent);
        try {
          const retryResult = await this.wire.prompt(retryPrompt);
          const retryStreamed = retryParts.join('');
          retryText = retryStreamed || this._extractResponse(retryResult);
        } finally {
          this.wire.removeListener('content', onRetryContent);
        }
      } catch (err) {
        throw new FlowRunError(`Wire prompt failed during decision retry at "${nodeId}": ${err.message}`);
      }

      const retryChoice = parseChoice(retryText);
      const retryEdge = matchEdge(edges, retryChoice);

      if (retryEdge) {
        this.emit('decision', { nodeId, choice: retryEdge.label });
        return retryEdge.dst;
      }
    }

    throw new FlowRunError(
      `Flow stuck at decision node "${nodeId}": no valid choice after ${this.maxRetries} retries. Available: ${labels.join(', ')}`
    );
  }

  /**
   * Build the prompt string for a node.
   */
  _buildPrompt(node) {
    if (node.kind === 'decision') {
      const edges = this.flow.edges.get(node.id) || [];
      const labels = edges.map(e => e.label).filter(Boolean);

      return [
        `[FLOW decision "${node.label}"]`,
        '',
        node.label,
        '',
        'Available branches:',
        ...labels.map(l => `- ${l}`),
        '',
        'Evaluate the situation, then choose a branch and reply with <choice>LABEL</choice>.',
      ].join('\n');
    }

    // Task node
    return `[FLOW step "${node.label}"] ${node.label}`;
  }

  /**
   * Extract text response from Wire turn result.
   */
  _extractResponse(result) {
    if (!result) return '';

    if (result.content) {
      return result.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
    }

    if (result.text) return result.text;
    if (typeof result === 'string') return result;

    return JSON.stringify(result);
  }
}

export class FlowRunError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FlowRunError';
  }
}
