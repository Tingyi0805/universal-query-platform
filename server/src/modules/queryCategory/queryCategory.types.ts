export type QueryCategoryRecord = {
  id: number;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  queryCount: number;
};

export type QueryCategoryInput = {
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};
