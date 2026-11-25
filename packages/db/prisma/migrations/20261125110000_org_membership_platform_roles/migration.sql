-- Papéis de plataforma da pessoa por organização, projetados do control plane (dono do dado). Aditiva; vazio = nenhum papel, então vínculos existentes
-- só ganham acesso a serviços da plataforma depois da primeira projeção (sync do diretório ou evento member_ready). Fecha por padrão.
ALTER TABLE "OrgMembership" ADD COLUMN "platformRoles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
