import type { NextRequest } from 'next/server';
import { handlers } from '@/auth';

// Com a config lazy do NextAuth, desestruturar `handlers` na carga do módulo não entrega funções
// que o Next reconheça como método da rota (a requisição cai no proxy /api/[...path]); resolve na chamada.
export const GET = (req: NextRequest) => handlers.GET(req);
export const POST = (req: NextRequest) => handlers.POST(req);
