/**
 * Sample React component for testing DOM + React config
 */

import { useCallback, useState } from "react";

type CounterProps = Readonly<{
  initialCount?: number;
}>;

export function Counter({ initialCount = 0 }: CounterProps) {
  const [ count, setCount ] = useState(initialCount);
  const increment = useCallback(() => setCount(c => c + 1), []);
  const decrement = useCallback(() => setCount(c => c - 1), []);
  const reset = useCallback(() => setCount(0), []);

  return (
    <div>
      <h1>{"Count: "}{count}</h1>
      <button onClick={increment} type="button">{"Increment"}</button>
      <button onClick={decrement} type="button">{"Decrement"}</button>
      <button onClick={reset} type="button">{"Reset"}</button>
    </div>
  );
}

export function App() {
  return (
    <main>
      <h1>{"React App"}</h1>
      <Counter />
    </main>
  );
}

export default App;
