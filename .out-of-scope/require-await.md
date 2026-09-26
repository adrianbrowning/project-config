# require-await

The shared ESLint config does not enable `require-await` or `@typescript-eslint/require-await`, and it won't.

## Why this is out of scope

An `async` function with no `await` is sometimes the right thing to write. Marking a function `async` guarantees it returns a promise and turns a synchronous `throw` into a rejection, even when the body never awaits anything. TypeScript already tells callers the function is async, and that's enough.

The config also enables `@typescript-eslint/promise-function-async` as an error. That rule requires any function that returns a promise to be marked `async`, including one that just passes along another call's promise:

```ts
// promise-function-async requires the `async` keyword here...
async function load(id: string): Promise<User> {
  return fetchUser(id); // ...and require-await would then flag it for having no `await`
}
```

Enabling `require-await` would contradict that rule. Code would have to choose between adding a pointless `await` and dropping `async`, which `promise-function-async` forbids.

The decision is also recorded in a comment in the shared config (`src/eslint.ts`), in the list of rules that are deliberately not enabled.

## Prior requests

- #11: "require-await"
