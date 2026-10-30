-- Item de nota casado sozinho no catálogo global (GTIN ou código do fabricante). Aditiva: nada é removido nem reescrito.
ALTER TYPE "ItemResolution" ADD VALUE IF NOT EXISTS 'AUTO_CATALOG';
