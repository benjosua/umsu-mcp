import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  VanillaUmsuEngine,
  type AccessibilityConstraint,
  type ProofResult,
} from './vanilla-umsu.ts';

export const CHECKER_CONSTRAINTS = [
  'universality',
  'reflexivity',
  'symmetry',
  'transitivity',
  'euclidity',
  'seriality',
] as const satisfies readonly AccessibilityConstraint[];

export type CheckerConstraint = (typeof CHECKER_CONSTRAINTS)[number];

export type ExampleRecord = {
  id: string;
  title: string;
  input: string;
  constraints: CheckerConstraint[];
  summary: string;
};

export const CHECKER_EXAMPLES: readonly ExampleRecord[] = [
  {
    id: 'propositional-valid',
    title: 'Simple propositional validity',
    input: 'p∨q, ¬p |= q',
    constraints: [],
    summary: 'A small propositional argument that closes immediately.',
  },
  {
    id: 'predicate-valid',
    title: 'Predicate tautology',
    input: '∀x(Fx→Fx)',
    constraints: [],
    summary: 'A quantified formula that the checker proves valid.',
  },
  {
    id: 'modal-reflexive',
    title: 'Modal axiom T',
    input: '□p→p',
    constraints: ['reflexivity'],
    summary: 'Requires reflexive accessibility to validate.',
  },
  {
    id: 'modal-invalid',
    title: 'Bare modal implication',
    input: '□p→p',
    constraints: [],
    summary: 'Without a frame constraint, the checker can return a countermodel.',
  },
  {
    id: 'equality',
    title: 'Identity reflexivity',
    input: '∀x(x=x)',
    constraints: [],
    summary: 'Shows the equality fragment of the original UMSU syntax.',
  },
] as const;

const engine = new VanillaUmsuEngine();
const constraintSet = new Set<string>(CHECKER_CONSTRAINTS);

export function validateConstraints(values: readonly string[] | undefined): CheckerConstraint[] {
  if (!values) {
    return [];
  }

  const parsed: CheckerConstraint[] = [];
  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!constraintSet.has(value)) {
      throw new Error(
        `Unknown accessibility constraint "${value}". Allowed values: ${CHECKER_CONSTRAINTS.join(', ')}.`,
      );
    }
    parsed.push(value as CheckerConstraint);
  }

  return parsed;
}

export function parseArgument(input: string) {
  const parsed = engine.parse(input);

  return {
    input,
    normalizedInput: parsed.normalizedInput,
    premises: parsed.premises.map((formula) => String(formula)),
    conclusion: String(parsed.conclusion),
    isModal: parsed.isModal,
    isPropositional: parsed.isPropositional,
    hasEquality: parsed.hasEquality,
  };
}

export function proveArgument(input: string, constraints?: readonly string[]): ProofResult {
  return engine.prove(input, {
    constraints: validateConstraints(constraints),
  });
}

export function summarizeProof(result: ProofResult) {
  const lines = [
    `${result.isValid ? 'VALID' : 'INVALID'}: ${result.normalizedInput}`,
    `Premises: ${result.premises.length ? result.premises.join('; ') : '(none)'}`,
    `Conclusion: ${result.conclusion}`,
    `Mode: ${result.isModal ? 'modal' : result.isPropositional ? 'propositional' : 'predicate / mixed'}`,
    `Equality: ${result.hasEquality ? 'yes' : 'no'}`,
  ];

  if (result.constraints.length) {
    lines.push(`Constraints: ${result.constraints.join(', ')}`);
  }

  if (!result.isValid && result.countermodel) {
    lines.push('', `Countermodel: ${result.countermodel}`);
  }

  return lines.join('\n');
}

export function proofToResource(result: ProofResult) {
  const encodedInput = encodeURIComponent(result.normalizedInput);

  return {
    uri: `umsu://proof-result/${encodedInput}`,
    mimeType: 'application/json',
    text: JSON.stringify(result, null, 2),
  };
}

export function successResult(result: ProofResult): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: summarizeProof(result),
      },
      {
        type: 'resource',
        resource: proofToResource(result),
      },
    ],
    structuredContent: result,
  };
}

export function getExample(id: string) {
  return CHECKER_EXAMPLES.find((example) => example.id === id) ?? null;
}

export const SYNTAX_GUIDE = [
  'UMSU Tree Checker Syntax',
  '',
  'The server uses the original umsu.de / wo/tpg formula language by loading the local vanilla UMSU browser scripts directly.',
  '',
  'Highlights:',
  '- Propositional formulas: p, q, ¬p, p∧q, p∨q, p→q, p↔q',
  '- Predicate formulas: Fa, Rab, ∀xFx, ∃x(Gx→Hx)',
  '- Equality: a=b, ∀x(x=x)',
  '- Modal formulas: □p, ◇q, □(p→q)',
  '- Arguments: premise1, premise2 |= conclusion',
  '',
  'Examples:',
  '- p∨q, ¬p |= q',
  '- ∀x(Fx→Gx), Fa |= Ga',
  '- □p→p   with constraint reflexivity',
].join('\n');

export const CONSTRAINT_GUIDE = [
  'Accessibility Constraints',
  '',
  ...CHECKER_CONSTRAINTS.map((constraint) => `- ${constraint}`),
  '',
  'Use constraints only for modal arguments or modal formulas.',
].join('\n');

export const UPSTREAM_GUIDE = [
  'Upstream Basis',
  '',
  'This MCP package is built in the tanren workspace against the local UMSU TypeScript rewrite,',
  'which mirrors the original `umsu-web` git submodule and keeps upstream parity tests.',
  '',
  'Relevant local paths:',
  '- ../umsu-web',
].join('\n');
