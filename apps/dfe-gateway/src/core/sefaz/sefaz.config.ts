/** Endereços e opções do cliente SEFAZ. Tudo vem de variável de ambiente: nenhuma URL fica no código. */
export interface SefazConfig {
  requestTimeoutMs: number;
  /** URL do `NFeDistribuicaoDFe` por ambiente; ausente = o ambiente não sincroniza. */
  distUrl: { PRODUCTION?: string; HOMOLOGATION?: string };
  /** URL do `NFeRecepcaoEvento` (manifestação do destinatário) por ambiente. */
  eventUrl: { PRODUCTION?: string; HOMOLOGATION?: string };
  /** Versão do SOAP do serviço de eventos. Conferir no WSDL. */
  eventSoap: '1.1' | '1.2';
  /** PEM com a cadeia ICP-Brasil dos servidores da SEFAZ (o repositório de CAs do Node não a inclui). */
  caPem?: string;
}
