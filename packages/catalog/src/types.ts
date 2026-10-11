export type ServiceActionCode =
  | 'SUBSTITUIR'
  | 'REVISAR'
  | 'REGULAR'
  | 'DIAGNOSTICAR'
  | 'LIMPAR'
  | 'REPARAR'
  | 'INSTALAR'
  | 'REMOVER';

export interface ComponentEntry {
  code: string;
  name: string;
  parentCode?: string;
}

export interface FiscalProfileEntry {
  code: string;
  lc116Item: string;
  nbs?: string;
  cnae?: string;
  issWithheld: boolean;
  verified: boolean;
}

export interface DefinitionEntry {
  code: string; // ACTION:COMPONENTE
  action: ServiceActionCode;
  componentCode: string;
  fiscalProfileCode?: string;
  nfseTextTemplate?: string;
}

export interface VariantEntry {
  level: 'MAKE' | 'MODEL' | 'FAMILY' | 'VERSION';
  key: string;
  parentKey?: string;
  make: string;
  model?: string;
  engine?: string;
  fuel?: string;
  fipeCode?: string;
}

export interface SuggestedPartEntry {
  definitionCode: string;
  variantKey?: string;
  partCategory: string;
  quantity: number;
  optional: boolean;
}

export interface Catalog {
  version: string;
  components: ComponentEntry[];
  fiscalProfiles: FiscalProfileEntry[];
  definitions: DefinitionEntry[];
  variants: VariantEntry[];
  suggestedParts: SuggestedPartEntry[];
  /** Modelos de mais de uma palavra, para o resolvedor de variantes. */
  multiWordModels: string[];
}
