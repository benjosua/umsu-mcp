import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import {
  CHECKER_CONSTRAINTS,
  CHECKER_EXAMPLES,
  CONSTRAINT_GUIDE,
  SYNTAX_GUIDE,
  UPSTREAM_GUIDE,
  getExample,
  parseArgument,
  proveArgument,
  successResult,
  summarizeProof,
  validateConstraints,
} from './checker.ts';

const constraintEnum = z.enum(CHECKER_CONSTRAINTS);

const proveOutputSchema = {
  input: z.string(),
  normalizedInput: z.string(),
  premises: z.array(z.string()),
  conclusion: z.string(),
  constraints: z.array(constraintEnum),
  isValid: z.boolean(),
  isModal: z.boolean(),
  isPropositional: z.boolean(),
  hasEquality: z.boolean(),
  freeVariableTreeText: z.string(),
  sentenceTreeText: z.string(),
  countermodel: z.string().nullable(),
  countermodelHtml: z.string().nullable(),
};

const parseOutputSchema = {
  input: z.string(),
  normalizedInput: z.string(),
  premises: z.array(z.string()),
  conclusion: z.string(),
  isModal: z.boolean(),
  isPropositional: z.boolean(),
  hasEquality: z.boolean(),
};

type ServerOptions = {
  name?: string;
  version?: string;
};

function buildExampleText() {
  return CHECKER_EXAMPLES.map((example) =>
    [
      `${example.title} (${example.id})`,
      `input: ${example.input}`,
      `constraints: ${example.constraints.join(', ') || '(none)'}`,
      `summary: ${example.summary}`,
    ].join('\n'),
  ).join('\n\n');
}

export function createUmsuMcpServer(options: ServerOptions = {}) {
  const server = new McpServer({
    name: options.name ?? 'umsu-tree-checker',
    version: options.version ?? '0.1.0',
    websiteUrl: 'https://github.com/modelcontextprotocol/typescript-sdk',
  }, {
    capabilities: {
      logging: {},
    },
  });

  server.registerTool(
    'parse_argument',
    {
      title: 'Parse UMSU Argument',
      description: 'Parse a UMSU formula or argument and report its shape without running the prover.',
      inputSchema: {
        input: z.string().min(1).describe('UMSU formula or argument text'),
      },
      outputSchema: parseOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ input }) => {
      try {
        const parsed = parseArgument(input);
        return {
          content: [
            {
              type: 'text',
              text: [
                `Normalized input: ${parsed.normalizedInput}`,
                `Premises: ${parsed.premises.length ? parsed.premises.join('; ') : '(none)'}`,
                `Conclusion: ${parsed.conclusion}`,
                `Modal: ${parsed.isModal ? 'yes' : 'no'}`,
                `Propositional: ${parsed.isPropositional ? 'yes' : 'no'}`,
                `Equality: ${parsed.hasEquality ? 'yes' : 'no'}`,
              ].join('\n'),
            },
          ],
          structuredContent: parsed,
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'prove_argument',
    {
      title: 'Prove UMSU Argument',
      description:
        'Run the full UMSU tableau checker and return validity, sentence tree, free-variable tree, and countermodel when available.',
      inputSchema: {
        input: z.string().min(1).describe('UMSU formula or argument text'),
        constraints: z
          .array(constraintEnum)
          .optional()
          .describe('Accessibility constraints for modal problems'),
      },
      outputSchema: proveOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ input, constraints }, extra) => {
      try {
        await server.sendLoggingMessage(
          {
            level: 'info',
            data: `Running checker for: ${input}`,
          },
          extra.sessionId,
        );

        return successResult(proveArgument(input, constraints));
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'interactive_prove_argument',
    {
      title: 'Interactive UMSU Proof',
      description: 'Collect a formula and optional modal constraints through form elicitation, then run the checker.',
      inputSchema: {
        input: z.string().optional().describe('Optional prefilled UMSU formula or argument text'),
        constraints: z
          .array(constraintEnum)
          .optional()
          .describe('Optional prefilled accessibility constraints'),
      },
      outputSchema: proveOutputSchema,
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ input, constraints }) => {
      try {
        const elicited = await server.server.elicitInput({
          mode: 'form',
          message: 'Provide the UMSU argument you want to check.',
          requestedSchema: {
            type: 'object',
            properties: {
              input: {
                type: 'string',
                title: 'Formula or argument',
                description: 'Use the original UMSU syntax, optionally with |= for arguments.',
                default: input ?? '',
              },
              constraints: {
                type: 'array',
                title: 'Modal constraints',
                description: 'Leave empty for non-modal problems.',
                items: {
                  type: 'string',
                  enum: [...CHECKER_CONSTRAINTS],
                },
                default: constraints ?? [],
              },
            },
            required: ['input'],
          },
        });

        if (elicited.action !== 'accept' || !elicited.content?.input) {
          return {
            content: [
              {
                type: 'text',
                text: 'Proof request cancelled.',
              },
            ],
          };
        }

        const elicitedInput = String(elicited.content.input);
        const elicitedConstraints = Array.isArray(elicited.content.constraints)
          ? elicited.content.constraints.map((value) => String(value))
          : [];

        return successResult(proveArgument(elicitedInput, validateConstraints(elicitedConstraints)));
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'explain_proof_with_sampling',
    {
      title: 'Explain Proof With Sampling',
      description:
        'Run the checker, then ask the connected client model to explain the result in plain language using MCP sampling.',
      inputSchema: {
        input: z.string().min(1).describe('UMSU formula or argument text'),
        constraints: z.array(constraintEnum).optional(),
        focus: z
          .string()
          .optional()
          .describe('Optional focus for the explanation, for example branch closure or countermodel meaning'),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ input, constraints, focus }) => {
      try {
        const result = proveArgument(input, constraints);
        const sampled = await server.server.createMessage({
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: [
                  'Explain this UMSU tableau-checker result to a logic student.',
                  focus ? `Focus on: ${focus}` : '',
                  '',
                  summarizeProof(result),
                  '',
                  'Sentence tree:',
                  result.sentenceTreeText,
                  '',
                  'Free-variable tree:',
                  result.freeVariableTreeText,
                ]
                  .filter(Boolean)
                  .join('\n'),
              },
            },
          ],
          maxTokens: 700,
        });

        return {
          content: [
            {
              type: 'text',
              text: sampled.content.type === 'text' ? sampled.content.text : 'Client returned non-text sampling output.',
            },
            {
              type: 'resource',
              resource: {
                uri: `umsu://proof-explanations/${encodeURIComponent(result.normalizedInput)}`,
                mimeType: 'application/json',
                text: JSON.stringify(result, null, 2),
              },
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text:
                error instanceof Error
                  ? `Sampling explanation failed: ${error.message}`
                  : `Sampling explanation failed: ${String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'list_modal_constraints',
    {
      title: 'List Modal Constraints',
      description: 'Return the modal accessibility constraints understood by the checker.',
      outputSchema: {
        constraints: z.array(constraintEnum),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: CHECKER_CONSTRAINTS.join(', '),
        },
      ],
      structuredContent: {
        constraints: [...CHECKER_CONSTRAINTS],
      },
    }),
  );

  server.registerResource(
    'syntax-guide',
    'umsu://docs/syntax',
    {
      title: 'UMSU Syntax Guide',
      description: 'Quick syntax notes for the original UMSU tree checker language.',
      mimeType: 'text/plain',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/plain',
          text: SYNTAX_GUIDE,
        },
      ],
    }),
  );

  server.registerResource(
    'constraint-guide',
    'umsu://docs/constraints',
    {
      title: 'Modal Constraint Guide',
      description: 'Lists the accessibility constraints supported by the checker.',
      mimeType: 'text/plain',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/plain',
          text: CONSTRAINT_GUIDE,
        },
      ],
    }),
  );

  server.registerResource(
    'upstream-basis',
    'umsu://docs/upstream',
    {
      title: 'Upstream Basis',
      description: 'Explains how this server maps to the original UMSU checker in the local workspace.',
      mimeType: 'text/plain',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/plain',
          text: UPSTREAM_GUIDE,
        },
      ],
    }),
  );

  server.registerResource(
    'examples-index',
    'umsu://docs/examples',
    {
      title: 'UMSU Examples',
      description: 'Starter examples for the checker.',
      mimeType: 'text/plain',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/plain',
          text: buildExampleText(),
        },
      ],
    }),
  );

  server.registerResource(
    'example-entry',
    new ResourceTemplate('umsu://examples/{exampleId}', {
      list: async () => ({
        resources: CHECKER_EXAMPLES.map((example) => ({
          uri: `umsu://examples/${example.id}`,
          name: `example-${example.id}`,
          title: example.title,
          mimeType: 'application/json',
          description: example.summary,
        })),
      }),
      complete: {
        exampleId: async (value) =>
          CHECKER_EXAMPLES.map((example) => example.id).filter((id) => id.startsWith(value)),
      },
    }),
    {
      title: 'UMSU Example Entry',
      description: 'A structured example that can be fed into the checker directly.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const exampleId = String(variables.exampleId ?? '');
      const example = getExample(exampleId);

      if (!example) {
        throw new Error(`Unknown example "${exampleId}".`);
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(example, null, 2),
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'tableau_tutor',
    {
      title: 'Tableau Tutor',
      description: 'Prompt template for walking through a proof or countermodel with the checker.',
      argsSchema: {
        input: z.string().describe('UMSU formula or argument text'),
        constraints: z.array(constraintEnum).optional(),
      },
    },
    ({ input, constraints }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Use the UMSU checker to analyze this argument.',
              `Input: ${input}`,
              `Constraints: ${constraints?.join(', ') || '(none)'}`,
              'First call `prove_argument`, then explain either why the branches close or what the countermodel means.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'countermodel_drill',
    {
      title: 'Countermodel Drill',
      description: 'Prompt template for focusing on invalid arguments and their countermodels.',
      argsSchema: {
        input: z.string().describe('UMSU formula or argument text'),
        constraints: z.array(constraintEnum).optional(),
      },
    },
    ({ input, constraints }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Check whether this UMSU argument is invalid.',
              `Input: ${input}`,
              `Constraints: ${constraints?.join(', ') || '(none)'}`,
              'If it is invalid, unpack the countermodel in plain language.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'syntax_helper',
    {
      title: 'Syntax Helper',
      description: 'Prompt template that reminds a model to use the syntax guide and examples before proving.',
      argsSchema: {
        userQuestion: z.string().describe('Question about the checker syntax or input language'),
      },
    },
    ({ userQuestion }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: userQuestion,
          },
        },
        {
          role: 'assistant',
          content: {
            type: 'resource',
            resource: {
              uri: 'umsu://docs/syntax',
              mimeType: 'text/plain',
              text: SYNTAX_GUIDE,
            },
          },
        },
        {
          role: 'assistant',
          content: {
            type: 'resource',
            resource: {
              uri: 'umsu://docs/examples',
              mimeType: 'text/plain',
              text: buildExampleText(),
            },
          },
        },
      ],
    }),
  );

  return server;
}
