import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import "./ManagementListToolbar.css";

export function ManagementListToolbar({
  search,
  onSearch,
  filters,
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  compact = false,
}: {
  search: string;
  onSearch: (value: string) => void;
  filters?: ReactNode;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(search);

  useEffect(() => setDraft(search), [search]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSearch(draft.trim());
  }

  const safeTotalPages = Math.max(1, totalPages);

  return (
    <div className={`management-list-tools${compact ? " compact" : ""}`}>
      <form className="management-list-search" onSubmit={submit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="搜尋代碼、名稱或關鍵字"
        />
        <button className="secondary-button" type="submit">搜尋</button>
        {search && (
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setDraft("");
              onSearch("");
            }}
          >
            清除
          </button>
        )}
      </form>

      <div className="management-list-filters">
        {filters}
        <label>
          <span>每頁</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
      </div>

      <div className="management-list-pagination">
        <span>共 {total} 筆</span>
        <button
          className="secondary-button"
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          上一頁
        </button>
        <strong>{page} / {safeTotalPages}</strong>
        <button
          className="secondary-button"
          type="button"
          disabled={page >= safeTotalPages}
          onClick={() => onPageChange(page + 1)}
        >
          下一頁
        </button>
      </div>
    </div>
  );
}
