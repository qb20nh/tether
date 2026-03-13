import { onTestFinished, test as vitestTest, type TestContext } from 'vitest';

type NodeStyleTestContext = {
  after: (cleanup: () => void | Promise<void>) => void;
  skip: (note?: string) => never;
};

type NodeStyleTestFn = (context: NodeStyleTestContext) => void | Promise<void>;
type NodeStyleTestOptions = {
  concurrency?: boolean;
};

const toNodeStyleContext = (context: TestContext): NodeStyleTestContext => ({
  after: (cleanup) => {
    onTestFinished(async () => {
      await cleanup();
    });
  },
  skip: (note) => context.skip(note),
});

type NodeStyleTest = {
  (name: string, fn: NodeStyleTestFn): void;
  (name: string, options: NodeStyleTestOptions, fn: NodeStyleTestFn): void;
};

function test(name: string, fn: NodeStyleTestFn): void;
function test(name: string, options: NodeStyleTestOptions, fn: NodeStyleTestFn): void;
function test(name: string, optionsOrFn: NodeStyleTestOptions | NodeStyleTestFn, maybeFn?: NodeStyleTestFn): void {
  const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;
  if (typeof fn !== 'function') {
    throw new TypeError('test requires a callback');
  }

  vitestTest(name, (context) => fn(toNodeStyleContext(context)));
}

export default test as NodeStyleTest;
