import { describe, expect, it } from 'vitest';
import { makeEvent } from '../testing.js';
import { route } from './rules.js';

const cfg = { brand: { name: 'Oficina <Silva>', color: '#C2410C' }, webhooks: [] as never[] };

describe('route', () => {
  it('status_changed avisa o cliente (e-mail normalizado)', () => {
    const [i] = route(makeEvent(), cfg);
    expect(i).toMatchObject({ channel: 'email', recipientKind: 'customer', recipient: 'joao@x.com', template: 'customer.status_changed' });
    expect(i.message.subject).toContain('OS #7');
    expect(i.message.html).toContain('Oficina &lt;Silva&gt;'); // escapa HTML
  });

  it('mensagem do cliente avisa a equipe, não o próprio cliente', () => {
    const intents = route(makeEvent({ type: 'order.message_posted', actor: { kind: 'customer' }, data: { body: 'oi' } }), cfg);
    expect(intents.map((i) => [i.channel, i.recipientKind, i.recipient])).toEqual([
      ['email', 'staff', 'ana@oficina.com'],
      ['inapp', 'staff', 'ana@oficina.com'],
    ]);
    expect(intents[1].message).toMatchObject({ subject: 'João enviou uma mensagem', text: 'oi', body: { severity: 'info', orderNumber: 7 } });
  });

  it('mensagem da oficina avisa só o cliente', () => {
    const intents = route(makeEvent({ type: 'order.message_posted', data: { body: 'oi' } }), cfg);
    expect(intents.map((i) => i.recipientKind)).toEqual(['customer']); // cliente não recebe in-app
  });

  it('sem e-mail cadastrado não gera notificação', () => {
    const e = makeEvent();
    e.order.customer.email = null;
    expect(route(e, cfg)).toEqual([]);
  });

  it('checklist só alerta a equipe quando o cliente marca ISSUE', () => {
    const ok = makeEvent({ type: 'order.checklist_item_answered', actor: { kind: 'customer' }, data: { status: 'OK' } });
    const issue = makeEvent({ type: 'order.checklist_item_answered', actor: { kind: 'customer' }, data: { status: 'ISSUE', label: 'Freio' } });
    expect(route(ok, cfg)).toEqual([]);
    expect(route(issue, cfg).map((i) => i.channel)).toEqual(['email', 'inapp']);
  });

  it('evento de tipo desconhecido não quebra', () => {
    expect(route(makeEvent({ type: 'order.algo_novo' }), cfg)).toEqual([]);
  });

  it('webhooks recebem o evento cru conforme o curinga', () => {
    const hooks = [
      { url: 'https://a.test', secret: 'xxxxxxxx', events: ['order.*'] },
      { url: 'https://b.test', secret: 'xxxxxxxx', events: ['order.created'] },
    ];
    const intents = route(makeEvent(), { ...cfg, webhooks: hooks }).filter((i) => i.channel === 'webhook');
    expect(intents.map((i) => i.recipient)).toEqual(['https://a.test']);
  });
});

describe('route (whatsapp)', () => {
  const wa = { ...cfg, whatsapp: true };
  const withPhone = (over: Parameters<typeof makeEvent>[0] = {}) => {
    const e = makeEvent(over);
    e.order.customer.phone = '11987654321';
    return e;
  };
  const whats = (e: ReturnType<typeof makeEvent>, c = wa) => route(e, c).filter((i) => i.channel === 'whatsapp');

  it('order.created envia o link do portal por template', () => {
    const e = withPhone({ type: 'order.created' });
    const [i] = whats(e);
    expect(i).toMatchObject({ recipientKind: 'customer', recipient: '11987654321', template: 'os_portal_link' });
    expect(i.message.body).toMatchObject({ type: 'template', template: 'os_portal_link', variables: ['7', 'Oficina <Silva>', e.order.portalUrl] });
  });

  it('status_changed envia o status; status sem texto conhecido não envia', () => {
    const [i] = whats(withPhone({ data: { to: 'COMPLETED' } }));
    expect(i).toMatchObject({ template: 'os_status_update' });
    expect((i.message.body as { variables: string[] }).variables[1]).toBe('Veículo pronto para retirada');
    expect(whats(withPhone({ data: { to: 'QUOTE' } }))).toEqual([]);
  });

  it('whatsapp_linked confirma o vínculo com texto livre (janela de 24h recém-aberta), sem template', () => {
    const e = withPhone({ type: 'order.whatsapp_linked', actor: { kind: 'customer' }, data: { result: 'linked' } });
    const intents = whats(e);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ ruleId: 'linked.customer.whatsapp', recipient: '11987654321' });
    const body = intents[0]!.message.body as { type: string; text: string };
    expect(body.type).toBe('text');
    expect(body.text).toContain('#7');
    expect(body.text).toContain('VW Gol');
  });

  it('whatsapp_linked sem resultado "linked" (ou o conflito) não envia nada ao cliente', () => {
    expect(whats(withPhone({ type: 'order.whatsapp_linked', data: { result: 'other' } }))).toEqual([]);
    expect(whats(withPhone({ type: 'order.whatsapp_link_conflict', data: { reason: 'customer_phone' } }))).toEqual([]);
  });

  it('sem telefone, ou com o canal desligado, não gera intenção', () => {
    expect(whats(makeEvent({ type: 'order.created' }))).toEqual([]);
    expect(whats(withPhone({ type: 'order.created' }), { ...cfg, whatsapp: false })).toEqual([]);
    expect(whats(withPhone({ type: 'order.message_posted', data: { body: 'oi' } }))).toEqual([]);
  });
});
