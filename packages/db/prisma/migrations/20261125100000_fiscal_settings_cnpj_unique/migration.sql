-- Um CNPJ pertence a UMA organização. O dfe-gateway dá um dono por CNPJ, mas o Fixer é um tenant só lá e ele não distingue organizações: duas com o mesmo
-- CNPJ dividiriam a mesma assinatura e o mesmo cursor de documentos (quem consome primeiro confirma, e a outra deixa de recebê-los) e o certificado de uma
-- substituiria o da outra. Aditiva. NULL (organização sem CNPJ ainda) pode repetir.
-- O índice ignora RLS: vale entre organizações. Se já existir CNPJ repetido, a criação falha e nada é alterado (resolva antes: cada CNPJ fica numa organização).
CREATE UNIQUE INDEX "tenant_fiscal_settings_cnpj_key" ON "tenant_fiscal_settings"("cnpj");
