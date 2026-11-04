-- Origem do vínculo organização-pessoa. Aditiva. Linhas existentes ficam `local` de propósito: o sync do diretório só remove `control_plane`,
-- então nada que já existe é apagado; o vínculo vira `control_plane` na primeira vez que o control plane o lista (ou no próximo member_ready).
ALTER TABLE "OrgMembership" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'local';
