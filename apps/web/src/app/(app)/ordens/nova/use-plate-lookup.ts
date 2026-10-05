import { useCallback, useRef, useState } from 'react';
import { normalizePlate } from '@/lib/masks';

export type PlateData = { brand?: string; model?: string; year?: string; color?: string };
type Status = { kind: 'idle' } | { kind: 'loading' } | { kind: 'found' } | { kind: 'error'; message: string };

/**
 * Consulta de placa. Respostas fora de ordem são descartadas (digitou outra placa enquanto a anterior
 * ainda consultava); só a última consulta pode preencher o formulário.
 */
export function usePlateLookup(onData: (plate: string, data: PlateData) => void) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const seq = useRef(0);

  const lookup = useCallback(
    async (raw: string) => {
      const plate = normalizePlate(raw);
      if (plate.length !== 7) return setStatus({ kind: 'error', message: 'Informe a placa completa.' });
      const mine = ++seq.current;
      setStatus({ kind: 'loading' });
      try {
        const res = await fetch(`/api/vehicles/plate-lookup/${plate}`);
        const body = await res.json().catch(() => ({}));
        if (mine !== seq.current) return;
        if (!res.ok) return setStatus({ kind: 'error', message: body.message ?? 'Falha na consulta.' });
        const d = body.result?.basico?.dados ?? {};
        onData(plate, {
          brand: d.marca,
          model: d.modelo,
          year: d.anoModelo ? String(d.anoModelo) : d.ano ? String(d.ano) : undefined,
          color: d.cor,
        });
        setStatus({ kind: 'found' });
      } catch {
        if (mine === seq.current) setStatus({ kind: 'error', message: 'Falha de rede.' });
      }
    },
    [onData],
  );

  const reset = useCallback(() => {
    seq.current++;
    setStatus({ kind: 'idle' });
  }, []);

  return { status, lookup, reset };
}
