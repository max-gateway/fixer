'use client';

import { useEffect, useState } from 'react';

/** O valor só "assenta" depois de `ms` sem mudar (busca que não dispara uma consulta por tecla). */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
