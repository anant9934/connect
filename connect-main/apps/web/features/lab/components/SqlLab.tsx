'use client';

import React, { useState, useEffect } from 'react';
import {
  Database,
  Play,
  RotateCcw,
  Download,
  Table,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
} from 'lucide-react';
import {
  executeSqlQuery,
  getDatabaseSchema,
  resetSqlDatabase,
  type SqlQueryResult,
  type TableSchema,
  SAMPLE_ACADEMIC_SCHEMA_SQL,
} from '../runtimes/sqlRunner';

const QUICK_SQL_QUERIES = [
  {
    name: 'All Departments',
    sql: 'SELECT dept_name, building, budget FROM departments ORDER BY budget DESC;',
  },
  {
    name: 'Instructors & Salaries',
    sql: 'SELECT name, dept_name, salary FROM instructors WHERE salary > 90000 ORDER BY salary DESC;',
  },
  {
    name: 'Course-Instructor JOIN',
    sql: `SELECT c.course_id, c.title, c.dept_name, i.name AS instructor_name
FROM courses c
LEFT JOIN instructors i ON i.dept_name = c.dept_name
ORDER BY c.course_id;`,
  },
  {
    name: 'Enrollment Count by Student',
    sql: `SELECT s.name AS student_name, s.dept_name, COUNT(e.enrollment_id) AS total_courses
FROM students s
LEFT JOIN enrollments e ON e.student_id = s.student_id
GROUP BY s.student_id, s.name, s.dept_name
ORDER BY total_courses DESC;`,
  },
];

export const SqlLab: React.FC = () => {
  const [query, setQuery] = useState<string>(QUICK_SQL_QUERIES[0].sql);
  const [results, setResults] = useState<SqlQueryResult[] | null>(null);
  const [schema, setSchema] = useState<TableSchema[]>([]);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [selectedTable, setSelectedTable] = useState<string | null>('departments');

  const loadSchema = async () => {
    const s = await getDatabaseSchema();
    setSchema(s);
  };

  useEffect(() => {
    loadSchema();
  }, []);

  const handleRunQuery = async () => {
    setIsRunning(true);
    try {
      const res = await executeSqlQuery(query);
      setResults(res);
      await loadSchema();
    } finally {
      setIsRunning(false);
    }
  };

  const handleResetDb = async () => {
    await resetSqlDatabase();
    await loadSchema();
    setQuery(QUICK_SQL_QUERIES[0].sql);
    setResults(null);
  };

  const handleTableClick = (tableName: string) => {
    setSelectedTable(tableName);
    setQuery(`SELECT * FROM ${tableName} LIMIT 10;`);
  };

  const handleExportCSV = () => {
    if (!results || results.length === 0 || !results[0].columns) return;
    const res = results[0];
    const header = res.columns.join(',');
    const rows = res.values.map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','));
    const csvContent = [header, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `query_result_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-[#E0F2FE] text-[#0284C7]">
              Client-Side SQLite WASM
            </span>
            <span className="text-xs text-[#5E5A50]">Academic University Database</span>
          </div>
          <h2 className="text-xl font-extrabold text-[#17151F]">
            Interactive Relational Database Management Lab
          </h2>
          <p className="text-xs text-[#5E5A50] max-w-2xl">
            Execute SQL queries in-browser with zero server overhead. Inspect tables, schema structures, foreign keys, and perform multi-table JOINs and analytical aggregations.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleResetDb}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FAF9FC] border border-[#E4E2DB] hover:border-[#7444E8] text-xs font-semibold text-[#17151F] rounded-xl transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#5E5A50]" />
            Reset Database
          </button>
          <button
            type="button"
            onClick={handleRunQuery}
            disabled={isRunning}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#7444E8] hover:bg-[#6537D6] text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            {isRunning ? 'Running...' : 'Execute SQL'}
          </button>
        </div>
      </div>

      {/* Main Grid: Schema Browser & Query Editor */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Schema Explorer Sidebar */}
        <div className="p-5 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-[#E4E2DB]">
            <Database className="w-4 h-4 text-[#7444E8]" />
            <h3 className="text-sm font-bold text-[#17151F]">Schema Browser</h3>
          </div>

          <div className="space-y-3">
            {schema.map((tbl) => (
              <div
                key={tbl.name}
                onClick={() => handleTableClick(tbl.name)}
                className={`p-3 rounded-2xl border transition-all cursor-pointer ${
                  selectedTable === tbl.name
                    ? 'bg-[#F1EBFF]/50 border-[#7444E8]'
                    : 'bg-[#FAF9FC] border-[#E4E2DB] hover:border-[#7444E8]'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold text-[#17151F] mb-1">
                  <span className="flex items-center gap-1.5">
                    <Table className="w-3.5 h-3.5 text-[#7444E8]" />
                    {tbl.name}
                  </span>
                  <span className="text-[10px] text-[#5E5A50] font-normal">{tbl.rowCount} rows</span>
                </div>

                <div className="space-y-0.5 mt-2">
                  {tbl.columns.map((c) => (
                    <div key={c.name} className="flex items-center justify-between text-[11px] font-mono text-[#5E5A50]">
                      <span className={c.pk ? 'font-bold text-[#7444E8]' : ''}>
                        {c.name} {c.pk ? '(PK)' : ''}
                      </span>
                      <span className="text-[#9C988D] text-[10px]">{c.type}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Editor & Results Main Area */}
        <div className="lg:col-span-3 space-y-6">
          {/* Query Editor Box */}
          <div className="p-5 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-[#17151F]">SQL Query Editor</span>
              {/* Quick queries buttons */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-[#6B675C]">Quick queries:</span>
                {QUICK_SQL_QUERIES.map((q) => (
                  <button
                    key={q.name}
                    type="button"
                    onClick={() => setQuery(q.sql)}
                    className="px-2 py-1 text-[11px] font-medium rounded-lg bg-[#FAF9FC] border border-[#E4E2DB] hover:border-[#7444E8] text-[#17151F] transition-colors cursor-pointer"
                  >
                    {q.name}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={6}
              spellCheck={false}
              className="w-full p-3 font-mono text-xs text-[#17151F] bg-[#FAF9FC] border border-[#E4E2DB] rounded-xl resize-y outline-none focus:border-[#7444E8] leading-relaxed"
              placeholder="Write SQL statements here..."
            />
          </div>

          {/* Results Area */}
          <div className="p-5 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E4E2DB]">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#7444E8]" />
                <h3 className="text-sm font-bold text-[#17151F]">Query Execution Results</h3>
              </div>

              {results && results.length > 0 && !results[0].error && (
                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="flex items-center gap-1 text-xs font-semibold text-[#7444E8] hover:underline cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export to CSV
                </button>
              )}
            </div>

            {results ? (
              <div className="space-y-4">
                {results.map((res, idx) => (
                  <div key={idx} className="space-y-2">
                    {res.error ? (
                      <div className="p-3 rounded-xl bg-[#FFE9E9] border border-[#FBD2D2] text-[#9B2C2C] text-xs font-mono flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <div>{res.error}</div>
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-[#E4E2DB]">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-[#FAF9FC] border-b border-[#E4E2DB]">
                              {res.columns.map((c, i) => (
                                <th key={i} className="px-3.5 py-2 font-semibold text-[#5E5A50] border-r border-[#E4E2DB] last:border-r-0">
                                  {c}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {res.values.length === 0 ? (
                              <tr>
                                <td colSpan={res.columns.length || 1} className="px-3.5 py-4 text-center text-[#9C988D] italic">
                                  0 rows returned
                                </td>
                              </tr>
                            ) : (
                              res.values.map((row, rI) => (
                                <tr key={rI} className="border-b border-[#F0EEE8] hover:bg-[#F6F5F2] last:border-b-0">
                                  {row.map((val, cI) => (
                                    <td key={cI} className="px-3.5 py-2 font-mono text-[#17151F] border-r border-[#F0EEE8] last:border-r-0">
                                      {val === null ? <span className="text-[#9C988D]">NULL</span> : String(val)}
                                    </td>
                                  ))}
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                        <div className="px-3.5 py-1.5 bg-[#FAF9FC] border-t border-[#E4E2DB] text-[11px] text-[#5E5A50] text-right flex items-center justify-end gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{res.rowCount} row(s) returned in {res.executionTimeMs}ms</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-[#9C988D] italic">
                No active query executed. Click &quot;Execute SQL&quot; to inspect output.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
