// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Person, PersonDetail } from '@/lib/workforce';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn(), patchJson: vi.fn() }));
vi.mock('@/lib/client-api', async (orig) => ({ ...(await orig<typeof import('@/lib/client-api')>()), ...api }));

import { TeamWorkspace } from './team-workspace';

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/equipe');
});
afterEach(cleanup);

const person = (over: Partial<Person> = {}): Person => ({
  id: 'p1',
  cpf: '***.982.247-**',
  name: 'Ana Souza',
  socialName: null,
  birthDate: null,
  email: 'ana@oficina.com',
  phone: '(11) 98765-4321',
  hasLogin: true,
  status: 'active',
  version: 3,
  createdAt: '2025-02-01T12:00:00.000Z',
  anonymized: false,
  ...over,
});

const detail: PersonDetail = {
  ...person(),
  engagements: [
    {
      id: 'e1',
      kind: 'clt',
      status: 'active',
      unitId: 'u1',
      unitName: 'Matriz',
      admittedOn: '2025-02-01',
      terminatedOn: null,
      positions: [
        { positionKey: 'aux', positionName: 'Auxiliar', validFrom: '2025-02-01', validTo: '2025-08-31' },
        { positionKey: 'mec', positionName: 'Mecânica', validFrom: '2025-09-01', validTo: null },
      ],
    },
  ],
};

/** Responde por URL: a ficha devolve o detalhe e a lista (que toda escrita revalida) devolve uma página. */
const route = (d: PersonDetail = detail) => async (url: string) => (/\/people\/[^/?]+$/.test(url) ? d : { items: [person()], nextCursor: null });

const initial = (items: Person[], nextCursor: string | null = null) => ({
  filters: { q: '', status: 'active' as const },
  page: { items, nextCursor },
  units: [{ id: 'u1', name: 'Matriz', status: 'active' }],
  positions: [{ id: 'k1', key: 'mec', name: 'Mecânica', status: 'active' }],
});

function mount(props: { items?: Person[]; manage?: boolean; nextCursor?: string | null; openId?: string | null } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TeamWorkspace initial={initial(props.items ?? [person()], props.nextCursor ?? null)} access={{ manage: props.manage ?? true }} openId={props.openId ?? null} />
    </QueryClientProvider>,
  );
}

describe('TeamWorkspace', () => {
  it('lista a equipe com CPF mascarado, contato e o selo de acesso ao sistema', () => {
    mount({ items: [person(), person({ id: 'p2', name: 'Bruno Lima', cpf: '***.111.222-**', hasLogin: false, email: null, phone: null })] });
    const list = screen.getByRole('list');
    expect(within(list).getByText('Ana Souza')).toBeTruthy();
    expect(within(list).getByText('***.982.247-**')).toBeTruthy();
    expect(within(list).getByText('ana@oficina.com')).toBeTruthy();
    expect(within(list).getAllByText('Acessa o sistema')).toHaveLength(1);
    expect(screen.getByText('2 pessoas')).toBeTruthy();
  });

  it('mostra o nome social e marca quem está inativo', () => {
    mount({ items: [person({ socialName: 'Aninha', status: 'inactive' })] });
    expect(screen.getByText('Aninha')).toBeTruthy();
    expect(screen.getByText('(Ana Souza)')).toBeTruthy();
    expect(screen.getByText('Inativo')).toBeTruthy();
  });

  it('quem só lê não vê o botão de cadastrar', () => {
    mount({ manage: false });
    expect(screen.queryByRole('button', { name: /nova pessoa/i })).toBeNull();
    mount({ manage: true });
    expect(screen.getByRole('button', { name: /nova pessoa/i })).toBeTruthy();
  });

  it('lista vazia sem filtro convida a cadastrar; com filtro, a limpar', async () => {
    mount({ items: [] });
    expect(screen.getByText('Sua equipe começa aqui')).toBeTruthy();
    expect(screen.getByRole('button', { name: /cadastrar primeira pessoa/i })).toBeTruthy();
  });

  it('abre a ficha da pessoa com vínculo, unidade e a linha do tempo de funções', async () => {
    api.getJson.mockImplementation(route());
    mount();
    await userEvent.click(screen.getByRole('button', { name: /Ana Souza/ }));

    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText('Matriz')).toBeTruthy();
    expect(within(sheet).getByText('Em vigor')).toBeTruthy();
    expect(within(sheet).getAllByText('CLT').length).toBeGreaterThan(0);
    expect(within(sheet).getByText('Auxiliar')).toBeTruthy();
    expect(within(sheet).getAllByText('Mecânica').length).toBeGreaterThan(0);
    expect(within(sheet).getByText(/set\/2025 → atual/)).toBeTruthy();
    expect(api.getJson).toHaveBeenCalledWith('/api/workforce/people/p1', expect.any(String));
  });

  it('a ficha só oferece mudar função e encerrar vínculo a quem gerencia', async () => {
    api.getJson.mockImplementation(route());
    mount({ manage: false, openId: 'p1' });
    const sheet = await screen.findByRole('dialog');
    await within(sheet).findByText('Matriz');
    expect(within(sheet).queryByRole('button', { name: /encerrar vínculo/i })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: /editar/i })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: /^inativar$/i })).toBeNull();
  });

  it('encerrar o último vínculo de quem tem login avisa que o acesso será revogado e envia o motivo', async () => {
    api.getJson.mockImplementation(route());
    api.postJson.mockResolvedValue({ ...detail.engagements[0], status: 'terminated', lastActive: true });
    mount({ openId: 'p1' });
    const sheet = await screen.findByRole('dialog');
    await userEvent.click(await within(sheet).findByRole('button', { name: /encerrar vínculo/i }));

    expect(within(sheet).getByText(/último vínculo ativo/i)).toBeTruthy();
    await userEvent.type(within(sheet).getByLabelText('Motivo'), 'Pedido de demissão');
    await userEvent.click(within(sheet).getAllByRole('button', { name: /encerrar vínculo/i }).at(-1)!);

    await waitFor(() => expect(api.postJson).toHaveBeenCalled());
    const [url, body] = api.postJson.mock.calls[0]!;
    expect(url).toBe('/api/workforce/engagements/e1/terminate');
    expect(body).toMatchObject({ reason: 'Pedido de demissão' });
    expect(body.terminatedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('cadastro: recusa CPF inválido sem chamar a API e envia o CPF mascarado quando válido', async () => {
    api.postJson.mockResolvedValue(person({ id: 'new' }));
    api.getJson.mockImplementation(route({ ...detail, id: 'new', engagements: [] }));
    mount({ manage: true });
    await userEvent.click(screen.getByRole('button', { name: /nova pessoa/i }));
    const sheet = await screen.findByRole('dialog');

    await userEvent.type(within(sheet).getByLabelText('CPF'), '11111111111');
    await userEvent.type(within(sheet).getByLabelText('Nome completo'), 'Carla Dias');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cadastrar' }));
    expect(await within(sheet).findByText('CPF inválido')).toBeTruthy();
    expect(api.postJson).not.toHaveBeenCalled();

    await userEvent.clear(within(sheet).getByLabelText('CPF'));
    await userEvent.type(within(sheet).getByLabelText('CPF'), '52998224725');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cadastrar' }));
    await waitFor(() => expect(api.postJson).toHaveBeenCalled());
    expect(api.postJson.mock.calls[0]![1]).toMatchObject({ cpf: '529.982.247-25', name: 'Carla Dias', email: null, socialName: null });
  });

  it('há mais páginas: mostra "+" na contagem e o botão de carregar mais', () => {
    mount({ nextCursor: 'abc' });
    expect(screen.getByText('1+ pessoas')).toBeTruthy();
    expect(screen.getByRole('button', { name: /carregar mais/i })).toBeTruthy();
  });
});
