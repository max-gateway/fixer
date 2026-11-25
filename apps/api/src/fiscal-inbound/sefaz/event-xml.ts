import { X509Certificate } from 'node:crypto';
import { SignedXml } from 'xml-crypto';

/**
 * Evento de Manifestação do Destinatário (NT 2020.001 v1.00, item 4.3). Só a Ciência da Operação é
 * emitida pelo sistema; confirmação, desconhecimento e "não realizada" são decisões humanas (D9).
 */
export const EVENT_CIENCIA = '210210';
export const DESC_CIENCIA = 'Ciencia da Operacao';

/** Código do órgão de recepção: o Ambiente Nacional atende a manifestação de todas as UF. */
const COD_ORGAO_AN = '91';
const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';

/** `Id` do infEvento: "ID" + tpEvento + chave + nSeqEvento com 2 dígitos (54 posições, P07 da NT). */
export const eventId = (tpEvento: string, accessKey: string, seq = 1) => `ID${tpEvento}${accessKey}${String(seq).padStart(2, '0')}`;

/**
 * `AAAA-MM-DDThh:mm:ss-03:00`. O Brasil não tem horário de verão desde 2019, então o deslocamento é fixo.
 * A SEFAZ rejeita data de evento no futuro (578, tolerância de 5 min), por isso `skewMs` recua um pouco.
 */
export function brtTimestamp(now: Date, skewMs = 30_000): string {
  const shifted = new Date(now.getTime() - skewMs - 3 * 3_600_000);
  return `${shifted.toISOString().slice(0, 19)}-03:00`;
}

export interface CienciaParams {
  tpAmb: 1 | 2;
  /** CNPJ (14 posições) do destinatário: autor do evento. */
  cnpj: string;
  accessKey: string;
  now: Date;
}

/** `<evento>` sem assinatura, em uma linha só: a SEFAZ rejeita espaços/quebras entre as tags (588). */
export function buildCienciaEvent(p: CienciaParams): string {
  return (
    `<evento versao="1.00"><infEvento Id="${eventId(EVENT_CIENCIA, p.accessKey)}">` +
    `<cOrgao>${COD_ORGAO_AN}</cOrgao><tpAmb>${p.tpAmb}</tpAmb><CNPJ>${p.cnpj}</CNPJ><chNFe>${p.accessKey}</chNFe>` +
    `<dhEvento>${brtTimestamp(p.now)}</dhEvento><tpEvento>${EVENT_CIENCIA}</tpEvento><nSeqEvento>1</nSeqEvento>` +
    `<verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>${DESC_CIENCIA}</descEvento></detEvento>` +
    '</infEvento></evento>'
  );
}

/** Lote de 1 a 20 eventos (P04 da NT). `idLote` é só controle do autor: a SEFAZ não o usa. */
export function buildEnvEvento(idLote: string, events: string[]): string {
  if (events.length < 1 || events.length > 20) throw new Error('Um lote de eventos tem de 1 a 20 eventos');
  return `<envEvento xmlns="${NFE_NS}" versao="1.00"><idLote>${idLote}</idLote>${events.join('')}</envEvento>`;
}

/** Certificado em base64 DER sem cabeçalho PEM nem quebras, como o padrão de assinatura da NF-e pede. */
function certBase64(certPem: string): string {
  return new X509Certificate(certPem).raw.toString('base64');
}

/**
 * Assina cada `infEvento` do envelope (XMLDSig enveloped) no padrão da NF-e: C14N 1.0, RSA-SHA1, digest
 * SHA1, transforms [enveloped-signature, C14N] e `KeyInfo/X509Data/X509Certificate` só com o certificado do
 * titular. SHA-1 aqui não é escolha: é o que o "padrão do Projeto" exige (rejeição 298 se divergir).
 * A assinatura é aplicada no envelope já montado, para o digest refletir o contexto de namespace real.
 */
export function signEnvEvento(envEvento: string, keyPem: string, certPem: string, eventIds: string[]): string {
  const x509 = certBase64(certPem);
  let xml = envEvento;
  for (const id of eventIds) {
    const sig = new SignedXml({
      privateKey: keyPem,
      signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
      canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
      getKeyInfoContent: () => `<X509Data><X509Certificate>${x509}</X509Certificate></X509Data>`,
    });
    sig.addReference({
      xpath: `//*[@Id='${id}']`,
      transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'],
      digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    });
    sig.computeSignature(xml, { location: { reference: `//*[@Id='${id}']`, action: 'after' }, prefix: undefined });
    xml = sig.getSignedXml();
  }
  return xml;
}
