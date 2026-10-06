export type QueryDefinitionRecord = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string;
  datasetId: number;
  datasetName?: string;
  sortOrder: number;
  allowExcelExport: boolean;
  isPublished: boolean;
  isActive: boolean;
  publishedAtUtc: string | null;
};

export type QueryDefinitionInput = {
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string;
  datasetId: number;
  sortOrder: number;
  allowExcelExport: boolean;
  isActive: boolean;
};
