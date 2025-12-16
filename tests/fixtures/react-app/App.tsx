/**
 * Sample React component for testing DOM + React config
 */

import { useState } from 'react';

type CounterProps = {
  initialCount?: number;
};

export function Counter({ initialCount = 0 }: CounterProps) {
  const [count, setCount] = useState(initialCount);

  return (
    <div>
      <h1>Count: {count}</h1>
      <button onClick={() => setCount(c => c + 1)}>Increment</button>
      <button onClick={() => setCount(c => c - 1)}>Decrement</button>
      <button onClick={() => setCount(0)}>Reset</button>
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
