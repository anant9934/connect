/**
 * sqlRunner.ts
 * In-browser SQL engine powered by sql.js (WebAssembly) with client-side fallback.
 * Pre-seeded with a comprehensive Academic University Database.
 */

declare global {
  interface Window {
    initSqlJs?: (config: { locateFile: (file: string) => string }) => Promise<any>;
  }
}

export interface SqlQueryResult {
  columns: string[];
  values: any[][];
  rowCount: number;
  executionTimeMs: number;
  error?: string;
}

export interface TableColumn {
  name: string;
  type: string;
  pk: boolean;
  notNull: boolean;
}

export interface TableSchema {
  name: string;
  columns: TableColumn[];
  rowCount: number;
}

const SQL_JS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/';

export const SAMPLE_ACADEMIC_SCHEMA_SQL = `
-- Academic University Management System Schema
DROP TABLE IF EXISTS enrollments;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS instructors;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS departments;

CREATE TABLE departments (
    dept_id VARCHAR(10) PRIMARY KEY,
    dept_name VARCHAR(100) NOT NULL,
    building VARCHAR(50),
    budget NUMERIC(12, 2)
);

CREATE TABLE instructors (
    instructor_id INT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    dept_name VARCHAR(100),
    salary NUMERIC(10, 2),
    FOREIGN KEY (dept_name) REFERENCES departments(dept_name)
);

CREATE TABLE courses (
    course_id VARCHAR(10) PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    dept_name VARCHAR(100),
    credits INT DEFAULT 3,
    FOREIGN KEY (dept_name) REFERENCES departments(dept_name)
);

CREATE TABLE students (
    student_id INT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    dept_name VARCHAR(100),
    tot_credits INT DEFAULT 0,
    FOREIGN KEY (dept_name) REFERENCES departments(dept_name)
);

CREATE TABLE enrollments (
    enrollment_id INT PRIMARY KEY,
    student_id INT,
    course_id VARCHAR(10),
    semester VARCHAR(10),
    year INT,
    grade VARCHAR(2),
    FOREIGN KEY (student_id) REFERENCES students(student_id),
    FOREIGN KEY (course_id) REFERENCES courses(course_id)
);

-- Seed Data
INSERT INTO departments (dept_id, dept_name, building, budget) VALUES
('CS', 'Computer Science', 'Turing Hall', 1200000.00),
('EE', 'Electrical Eng', 'Tesla Lab', 950000.00),
('MATH', 'Mathematics', 'Euler Center', 650000.00),
('PHYS', 'Physics', 'Newton Hall', 700000.00),
('BIO', 'Biology', 'Darwin Complex', 800000.00);

INSERT INTO instructors (instructor_id, name, dept_name, salary) VALUES
(101, 'Dr. Alan Turing', 'Computer Science', 95000.00),
(102, 'Dr. Claude Shannon', 'Electrical Eng', 92000.00),
(103, 'Dr. Ada Lovelace', 'Computer Science', 98000.00),
(104, 'Dr. Carl Gauss', 'Mathematics', 87000.00),
(105, 'Dr. Marie Curie', 'Physics', 94000.00),
(106, 'Dr. Richard Feynman', 'Physics', 91000.00);

INSERT INTO courses (course_id, title, dept_name, credits) VALUES
('CS101', 'Intro to Programming & C++', 'Computer Science', 4),
('CS201', 'Data Structures & Algorithms', 'Computer Science', 4),
('CS301', 'Database Management Systems', 'Computer Science', 3),
('CS350', 'Operating Systems', 'Computer Science', 4),
('EE200', 'Digital Circuits', 'Electrical Eng', 3),
('MATH201', 'Discrete Mathematics', 'Mathematics', 3),
('MATH301', 'Linear Algebra & Calculus', 'Mathematics', 4),
('PHYS101', 'Classical Mechanics', 'Physics', 4);

INSERT INTO students (student_id, name, dept_name, tot_credits) VALUES
(2001, 'Alex Mercer', 'Computer Science', 48),
(2002, 'Sara Connor', 'Computer Science', 64),
(2003, 'Bruce Wayne', 'Electrical Eng', 82),
(2004, 'Diana Prince', 'Physics', 90),
(2005, 'Peter Parker', 'Physics', 36),
(2006, 'Clark Kent', 'Mathematics', 52);

INSERT INTO enrollments (enrollment_id, student_id, course_id, semester, year, grade) VALUES
(1, 2001, 'CS101', 'Fall', 2025, 'A'),
(2, 2001, 'CS201', 'Spring', 2026, 'A'),
(3, 2001, 'CS301', 'Fall', 2026, 'A-'),
(4, 2002, 'CS101', 'Fall', 2025, 'B+'),
(5, 2002, 'CS201', 'Spring', 2026, 'A'),
(6, 2003, 'EE200', 'Fall', 2025, 'A'),
(7, 2004, 'PHYS101', 'Spring', 2025, 'A+'),
(8, 2005, 'PHYS101', 'Fall', 2025, 'B'),
(9, 2005, 'MATH201', 'Spring', 2026, 'A-'),
(10, 2006, 'MATH201', 'Fall', 2025, 'A');
`;

let sqlDbInstance: any = null;
let sqlJsModule: any = null;

async function loadSqlJsScript(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (window.initSqlJs) return;

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${SQL_JS_CDN}sql-wasm.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load sql.js from CDN'));
    document.head.appendChild(script);
  });
}

export async function getSqlDatabase(): Promise<any> {
  if (sqlDbInstance) {
    return sqlDbInstance;
  }

  await loadSqlJsScript();

  if (!window.initSqlJs) {
    throw new Error('sql.js is not available in browser environment');
  }

  if (!sqlJsModule) {
    sqlJsModule = await window.initSqlJs({
      locateFile: (file: string) => `${SQL_JS_CDN}${file}`,
    });
  }

  const db = new sqlJsModule.Database();
  db.run(SAMPLE_ACADEMIC_SCHEMA_SQL);
  sqlDbInstance = db;
  return db;
}

export async function executeSqlQuery(sql: string): Promise<SqlQueryResult[]> {
  const startTime = performance.now();

  try {
    const db = await getSqlDatabase();
    const cleanSql = sql.trim();
    if (!cleanSql) {
      return [{
        columns: [],
        values: [],
        rowCount: 0,
        executionTimeMs: 0,
      }];
    }

    const results = db.exec(cleanSql);
    const duration = Math.round(performance.now() - startTime);

    if (!results || results.length === 0) {
      // DDL or DML without returning rows (INSERT, UPDATE, DELETE, CREATE)
      return [{
        columns: ['Status'],
        values: [['Query executed successfully']],
        rowCount: 0,
        executionTimeMs: duration,
      }];
    }

    return results.map((res: any) => ({
      columns: res.columns || [],
      values: res.values || [],
      rowCount: (res.values || []).length,
      executionTimeMs: duration,
    }));
  } catch (err: any) {
    const duration = Math.round(performance.now() - startTime);
    return [{
      columns: ['Error'],
      values: [],
      rowCount: 0,
      executionTimeMs: duration,
      error: err.message || String(err),
    }];
  }
}

export async function getDatabaseSchema(): Promise<TableSchema[]> {
  try {
    const db = await getSqlDatabase();
    const tableRes = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;`);
    if (!tableRes || tableRes.length === 0 || !tableRes[0].values) {
      return [];
    }

    const tableNames: string[] = tableRes[0].values.map((v: any[]) => v[0]);
    const schemas: TableSchema[] = [];

    for (const tableName of tableNames) {
      const colRes = db.exec(`PRAGMA table_info(${tableName});`);
      const countRes = db.exec(`SELECT COUNT(*) FROM ${tableName};`);
      const rowCount = countRes && countRes[0]?.values?.[0]?.[0] ? Number(countRes[0].values[0][0]) : 0;

      const columns: TableColumn[] = [];
      if (colRes && colRes[0]?.values) {
        for (const col of colRes[0].values) {
          // cid, name, type, notnull, dflt_value, pk
          columns.push({
            name: col[1],
            type: col[2] || 'TEXT',
            notNull: col[3] === 1,
            pk: col[5] === 1,
          });
        }
      }

      schemas.push({
        name: tableName,
        columns,
        rowCount,
      });
    }

    return schemas;
  } catch (e) {
    console.warn('Failed to introspect SQL schema:', e);
    return [];
  }
}

export async function resetSqlDatabase(): Promise<void> {
  if (sqlDbInstance) {
    try {
      sqlDbInstance.close();
    } catch (e) {
      // ignore close errors
    }
    sqlDbInstance = null;
  }
  await getSqlDatabase();
}
