import { z } from 'zod';

/**
 * Structured-output schemas. The API only accepts closed objects (`additionalProperties: false`),
 * so open node/edge/data records travel as JSON strings and are parsed + validated locally.
 */
export const AiPatchOpSchema = z.object({
  op: z.enum(['add', 'update', 'remove', 'move', 'addEdge', 'updateEdge', 'removeEdge']),
  id: z
    .string()
    .nullable()
    .describe(
      'Target node id (update, remove, move) or edge id (updateEdge, removeEdge). Null otherwise.',
    ),
  node: z
    .string()
    .nullable()
    .describe(
      'add only: the complete node as a JSON object string with id, kind, parentId, order, title and kind-specific fields.',
    ),
  data: z
    .string()
    .nullable()
    .describe('update / updateEdge only: the fields to change as a JSON object string.'),
  edge: z
    .string()
    .nullable()
    .describe(
      'addEdge only: the edge as a JSON object string with id, kind, source, target and optional label, isDefault, order.',
    ),
  parentId: z.string().nullable().describe('move only: new parent id, or null for the root.'),
  order: z.number().nullable().describe('move only: new integer order among siblings.'),
});
export type AiPatchOp = z.infer<typeof AiPatchOpSchema>;

export const AiPatchSchema = z.object({ ops: z.array(AiPatchOpSchema) });
export type AiPatch = z.infer<typeof AiPatchSchema>;

export const ProposalOutputSchema = z.object({
  rationale: z
    .string()
    .describe('Two to five sentences: what changes and why it improves the skill.'),
  patch: AiPatchSchema,
});

export const CritiqueOutputSchema = z.object({
  summary: z.string().describe('Two to four sentences on the overall quality and the top fixes.'),
  findings: z.array(
    z.object({
      severity: z.enum(['error', 'warning', 'info']),
      rule: z.string().describe("Rule slug of the form 'ai/<kebab-slug>'."),
      message: z.string().describe('One or two sentences: what is wrong and why it matters.'),
      nodeId: z.string().nullable().describe('The node concerned, when there is one.'),
      patch: AiPatchSchema.nullable().describe(
        'A concrete fix, when one can be expressed as a patch.',
      ),
    }),
  ),
});

export const TriggerQuerySchema = z.object({
  query: z.string(),
  should_trigger: z.boolean(),
});

export const DescribeOutputSchema = z.object({
  candidates: z
    .array(z.object({ description: z.string(), rationale: z.string() }))
    .describe('Three candidate descriptions with different structures.'),
  triggerQueries: z.array(TriggerQuerySchema),
});

export const TriggerQueriesOutputSchema = z.object({ queries: z.array(TriggerQuerySchema) });

export const InterviewOutputSchema = z.object({
  question: z.string().nullable().describe('The single next question to ask, or null when done.'),
  patch: AiPatchSchema.nullable().describe(
    'Graph changes justified by what is known so far, or null.',
  ),
  rationale: z.string().nullable(),
  confidence: z
    .number()
    .describe('0..1: confidence that the graph captures the user intent so far.'),
  done: z.boolean(),
});

export const ImproveDescriptionOutputSchema = z.object({
  description: z.string(),
  reasoning: z.string(),
});

export const GradingOutputSchema = z.object({
  expectations: z.array(
    z.object({
      text: z.string().describe('The expectation, verbatim.'),
      passed: z.boolean(),
      evidence: z
        .string()
        .describe(
          'Quoted transcript/output text or a precise description of what was found or missing.',
        ),
    }),
  ),
});

export const AlignTraceOutputSchema = z.object({
  visits: z.array(
    z.object({
      nodeId: z.string(),
      turn: z.number(),
      evidence: z.string(),
      confidence: z.number(),
    }),
  ),
});
