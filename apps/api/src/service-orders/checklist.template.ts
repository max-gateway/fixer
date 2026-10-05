/**
 * Checklist padrão de entrada do veículo, copiado para cada ordem nova.
 * Redigido como afirmações que o cliente confirma ("OK") ou contesta ("ISSUE" + observação)
 * no portal, e que ficam registradas como prova do estado em que o carro chegou.
 */
export const DEFAULT_CHECKLIST: { section: string; label: string }[] = [
  { section: 'Exterior', label: 'A lataria não tem riscos ou amassados além dos já conhecidos' },
  { section: 'Exterior', label: 'Pneus e rodas estão sem danos aparentes' },
  { section: 'Exterior', label: 'Vidros e retrovisores estão sem trincas' },
  { section: 'Interior', label: 'Nenhuma luz de alerta está acesa no painel' },
  { section: 'Interior', label: 'Retirei os pertences de valor de dentro do veículo' },
  { section: 'Interior', label: 'Estepe, macaco e triângulo estão no porta-malas' },
  { section: 'Entrega', label: 'Deixei a chave reserva e/ou o documento do veículo, se solicitado' },
  { section: 'Entrega', label: 'Autorizo a oficina a testar o veículo em via pública' },
];
