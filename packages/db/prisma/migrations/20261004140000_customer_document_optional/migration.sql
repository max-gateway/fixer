-- AlterTable: OS pode ser aberta só com o telefone; o CPF/CNPJ vem do portal do cliente.
ALTER TABLE "Customer" ALTER COLUMN "document" DROP NOT NULL;
