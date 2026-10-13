-- Nome da oficina (razão social) enviado pelo control plane, para o seletor de organização da web.
ALTER TABLE "OrgProfile" ADD COLUMN "name" TEXT;
