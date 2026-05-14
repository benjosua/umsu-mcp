import { parseArgument, proveArgument } from './checker.ts';

const parsed = parseArgument('p∨q, ¬p |= q');
const proved = proveArgument('□p→p', ['reflexivity']);

console.log(
  JSON.stringify(
    {
      parsed,
      proved: {
        isValid: proved.isValid,
        normalizedInput: proved.normalizedInput,
        constraints: proved.constraints,
        hasCountermodel: Boolean(proved.countermodel),
      },
    },
    null,
    2,
  ),
);
