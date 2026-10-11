import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { normalizePlate } from '@/lib/masks';

export type PlateData = { brand?: string; model?: string; year?: string; color?: string };
/** Dados técnicos devolvidos pela consulta (não persistidos no cadastro do veículo; só exibidos). */
export type PlateSpecs = {
  motor?: string;
  cilindradas?: number;
  potencia?: number;
  combustivel?: string;
  lotacao?: number;
  tipo?: string;
  especie?: string;
  origem?: string;
  local?: string;
  chassi?: string;
  anoFabricacao?: number;
  anoModelo?: number;
  cached?: boolean;
};
type Status = { kind: 'idle' } | { kind: 'loading' } | { kind: 'found'; specs: PlateSpecs } | { kind: 'error'; message: string };

/** Erro com mensagem já própria para o usuário (vinda da API), distinto de falha de rede. */
class LookupError extends Error {}

const num =(v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/**
 * Consulta de placa. Respostas fora de ordem são descartadas (digitou outra placa enquanto a anterior
 * ainda consultava); só a última consulta pode preencher o formulário.
 */
export function usePlateLookup(onData: (plate: string, data: PlateData) => void) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const seq = useRef(0);
  const queryClient = useQueryClient();

  const lookup = useCallback(
    async (raw: string) => {
      const plate = normalizePlate(raw);
      if (plate.length !== 7) return setStatus({ kind: 'error', message: 'Informe a placa completa.' });
      const mine = ++seq.current;
      setStatus({ kind: 'loading' });
      try {
        // fetchQuery deduplica consultas simultâneas e reaproveita placas já consultadas (cache de 10 min).
        const body = await queryClient.fetchQuery({
          queryKey: ['plate-lookup', plate],
          staleTime: 10 * 60_000,
          queryFn: async () => {
            const res = await fetch(`/api/vehicles/plate-lookup/${plate}`);
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new LookupError(json.message ?? 'Falha na consulta.');
            return json;
          },
        });
        if (mine !== seq.current) return;
        const d = body.result?.basico?.dados ?? {};
        onData(plate, {
          brand: d.marca,
          model: d.modelo,
          year: d.anoModelo ? String(d.anoModelo) : d.ano ? String(d.ano) : undefined,
          color: d.cor,
        });
        setStatus({
          kind: 'found',
          specs: {
            motor: str(d.motor),
            cilindradas: num(d.cilindradas),
            potencia: num(d.potencia),
            combustivel: str(d.combustivel),
            lotacao: num(d.lotacao),
            tipo: str(d.tipoVeiculo) ?? str(d.tipo),
            especie: str(d.especie),
            origem: str(d.procedencia) ?? str(d.origem),
            local: [str(d.municipio), str(d.uf)].filter(Boolean).join(' - ') || undefined,
            chassi: str(d.final_chassi),
            anoFabricacao: num(d.ano),
            anoModelo: num(d.anoModelo),
            cached: body.cached === true,
          },
        });
      } catch (e) {
        if (mine === seq.current) setStatus({ kind: 'error', message: e instanceof LookupError ? e.message : 'Falha de rede.' });
      }
    },
    [onData, queryClient],
  );

  const reset = useCallback(() => {
    seq.current++;
    setStatus({ kind: 'idle' });
  }, []);

  return { status, lookup, reset };
}
