-- Quando o Fixer confirmou, pela última vez, o estado do certificado com o dfe-gateway (modo gateway).
-- Sem isso a tela não distingue "vence em 40 dias" de "faz uma semana que não conseguimos conferir".
ALTER TABLE "FiscalCredential" ADD COLUMN "mirroredAt" TIMESTAMP(3);
