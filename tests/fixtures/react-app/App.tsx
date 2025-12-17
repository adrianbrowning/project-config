/**
 * Sample React component for testing DOM + React config
 */

import { useCallback, useState } from 'react';

type CounterProps = Readonly<{
  initialCount?: number;
}>;

export function Counter({ initialCount = 0 }: CounterProps) {
  const [count, setCount] = useState(initialCount);
  const increment = useCallback(() => setCount(c => c + 1), []);
  const decrement = useCallback(() => setCount(c => c - 1), []);
  const reset = useCallback(() => setCount(0), []);

  return (
    <div>
      <h1>Count: {count}</h1>
      <button type="button" onClick={increment}>Increment</button>
      <button type="button" onClick={decrement}>Decrement</button>
      <button type="button" onClick={reset}>Reset</button>
    </div>
  );
}

export function App() {
  return (
    <main>
      <h1>React App</h1>
      <Counter />
    </main>
  );
}

export default App;
