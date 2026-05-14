import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export type AccessibilityConstraint =
  | 'universality'
  | 'reflexivity'
  | 'symmetry'
  | 'transitivity'
  | 'euclidity'
  | 'seriality';

export type ParsedArgument = {
  normalizedInput: string;
  parser: any;
  premises: any[];
  conclusion: any;
  isModal: boolean;
  isPropositional: boolean;
  hasEquality: boolean;
};

export type ProofOptions = {
  constraints?: AccessibilityConstraint[];
  debug?: boolean;
  trace?: boolean;
  log?: (line: string) => void;
};

export type ProofResult = {
  input: string;
  normalizedInput: string;
  premises: string[];
  conclusion: string;
  constraints: AccessibilityConstraint[];
  isValid: boolean;
  isModal: boolean;
  isPropositional: boolean;
  hasEquality: boolean;
  freeVariableTreeText: string;
  sentenceTreeText: string;
  countermodel: string | null;
  countermodelHtml: string | null;
};

type VanillaRuntime = {
  Parser: new () => any;
  Prover: new (initFormulas: any[], parser: any, constraints?: AccessibilityConstraint[]) => any;
  SenTree: new (fvTree: any, parser: any) => any;
  renderSymbols: (input: string) => string;
};

const UMSU_WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'umsu-web');
const UMSU_WEB_FILES = ['array', 'formula', 'parser', 'equality', 'modelfinder', 'sentree', 'prover', 'index'];

let runtime: VanillaRuntime | null = null;
let runtimeLog: (line?: string, tracelog?: unknown) => void = () => {};

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function htmlToText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getRuntime(): VanillaRuntime {
  if (runtime) {
    return runtime;
  }

  const context = vm.createContext({
    console,
    performance,
    setTimeout,
    clearTimeout,
    window: {},
    document: {
      forms: [{ flaField: { value: '' } }],
      getElementById: () => ({ style: {}, innerHTML: '', innerText: '' }),
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    self: {},
    log: (line?: string, tracelog?: unknown) => runtimeLog(line, tracelog),
  });

  for (const name of UMSU_WEB_FILES) {
    const filename = join(UMSU_WEB_DIR, `${name}.js`);
    const code = readFileSync(filename, 'utf8');
    vm.runInContext(code, context, { filename });
  }

  const loaded = context as unknown as VanillaRuntime;
  for (const name of ['Parser', 'Prover', 'SenTree', 'renderSymbols'] as const) {
    if (typeof loaded[name] !== 'function') {
      throw new Error(`Vanilla UMSU runtime did not expose ${name}.`);
    }
  }

  runtime = loaded;
  return loaded;
}

export class VanillaUmsuEngine {
  normalizeInput(input: string) {
    return getRuntime().renderSymbols(input.trim());
  }

  parse(input: string): ParsedArgument {
    const { Parser } = getRuntime();
    const normalizedInput = this.normalizeInput(input);
    const parser = new Parser();
    const [premises, conclusion] = parser.parseInput(normalizedInput);

    return {
      normalizedInput,
      parser,
      premises,
      conclusion,
      isModal: Boolean(parser.isModal),
      isPropositional: Boolean(parser.isPropositional),
      hasEquality: Boolean(parser.hasEquality),
    };
  }

  prove(input: string, options: ProofOptions = {}): ProofResult {
    const { Prover, SenTree } = getRuntime();
    const previousLog = runtimeLog;
    runtimeLog = options.debug || options.trace
      ? (line?: string, tracelog?: unknown) => {
          if (options.trace || !tracelog) {
            (options.log ?? console.error)(String(line ?? ''));
          }
        }
      : () => {};

    try {
      const parsed = this.parse(input);
      const constraints = [...(options.constraints ?? [])];
      const initFormulas = parsed.premises.concat([parsed.conclusion.negate()]);
      const prover = new Prover(initFormulas, parsed.parser, constraints);

      prover.pauseLength = 0;
      prover.computationLength = Number.POSITIVE_INFINITY;

      let finished = false;
      let treeClosed = false;

      prover.onfinished = (closed: unknown) => {
        finished = true;
        treeClosed = Boolean(closed);
      };

      prover.start();

      if (!finished) {
        throw new Error('The vanilla UMSU prover did not finish synchronously.');
      }

      const sentenceTree = new SenTree(prover.tree, parsed.parser);
      const countermodel = prover.counterModel ? String(prover.counterModel).trim() : null;
      const countermodelHtml =
        prover.counterModel && typeof prover.counterModel.toHTML === 'function'
          ? String(prover.counterModel.toHTML())
          : null;

      return {
        input,
        normalizedInput: parsed.normalizedInput,
        premises: parsed.premises.map((formula) => String(formula)),
        conclusion: String(parsed.conclusion),
        constraints,
        isValid: treeClosed,
        isModal: parsed.isModal,
        isPropositional: parsed.isPropositional,
        hasEquality: parsed.hasEquality,
        freeVariableTreeText: htmlToText(String(prover.tree)),
        sentenceTreeText: htmlToText(String(sentenceTree)),
        countermodel,
        countermodelHtml,
      };
    } catch (error) {
      throw toError(error);
    } finally {
      runtimeLog = previousLog;
    }
  }
}

export function parseConstraintList(values: string[]) {
  const allowed = new Set<AccessibilityConstraint>([
    'universality',
    'reflexivity',
    'symmetry',
    'transitivity',
    'euclidity',
    'seriality',
  ]);

  const parsed: AccessibilityConstraint[] = [];
  for (const value of values) {
    for (const part of value.split(',')) {
      const constraint = part.trim() as AccessibilityConstraint;
      if (!constraint) {
        continue;
      }
      if (!allowed.has(constraint)) {
        throw new Error(`Unknown accessibility constraint: ${constraint}`);
      }
      parsed.push(constraint);
    }
  }
  return parsed;
}
