const EXCLUDED_FIELDS = ["CreatedAt", "UpdatedAt"];

export function transformRows(
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  return rows.map((row) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (EXCLUDED_FIELDS.includes(key)) continue;
      const newKey = key === "Id" ? "№ заявки" : key;
      result[newKey] = value;
    }
    return result;
  });
}