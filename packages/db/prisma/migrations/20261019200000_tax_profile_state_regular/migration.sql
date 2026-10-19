-- Situação do contribuinte na SEFAZ estadual (PE: RICMS art. 393-A): decide o percentual da antecipação do ICMS na entrada
-- interestadual do Simples Nacional. NULL = não informado; o livro de custo usa o pior caso (contribuinte irregular).
ALTER TABLE "tenant_tax_profile" ADD COLUMN "stateTaxRegular" BOOLEAN;
