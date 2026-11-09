'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  RotateCcw,
  Copy,
  Check,
  Download,
  Maximize2,
  Minimize2,
  Terminal,
  Eye,
  AlertCircle,
  CheckCircle2,
  Clock,
  Sparkles,
  Loader2,
} from 'lucide-react';
import type { SupportedLanguage } from '../types';
import { STARTER_CODE_BY_LANGUAGE } from '../runtimes/starterTemplates';
import { runPythonCode, preloadPython } from '../runtimes/pythonRunner';
import { executeSqlQuery, type SqlQueryResult } from '../runtimes/sqlRunner';
import { buildSandboxedHtmlDoc } from '../runtimes/htmlPreview';
import { runOnServer, type ServerRunResult } from '../api';
import { CLANG_DOWNLOAD_MB, runCppInBrowser } from '../runtimes/cppBrowser';
import { listOrganizations } from '@/features/institution/api';

interface CodeEditorProps {
  initialLanguage?: SupportedLanguage;
  initialCode?: string;
  allowedLanguages?: SupportedLanguage[];
  onCodeChange?: (code: string) => void;
  onExecute?: (result: { stdout: string; stderr: string; durationMs: number; status: string }) => void;
  showStdin?: boolean;
  showPreview?: boolean;
  readOnly?: boolean;
  height?: string;
  /** Institution whose code runner runs C++ and Java; defaults to the user's first institution. */
  orgId?: string;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  initialLanguage = 'cpp',
  initialCode,
  allowedLanguages = ['cpp', 'python', 'java', 'html', 'css', 'javascript', 'sql'],
  onCodeChange,
  onExecute,
  showStdin = true,
  showPreview = true,
  readOnly = false,
  height = '520px',
  orgId,
}) => {
  const [language, setLanguage] = useState<SupportedLanguage>(initialLanguage);

  // Start downloading the Python runtime as soon as Python is selected, so Run is fast.
  useEffect(() => {
    if (language === 'python') preloadPython();
  }, [language]);
  const [code, setCode] = useState<string>(initialCode || STARTER_CODE_BY_LANGUAGE[initialLanguage] || '');

  // HTML/CSS/JS sub-tabs if web preview mode
  const [htmlCode, setHtmlCode] = useState<string>(STARTER_CODE_BY_LANGUAGE.html);
  const [cssCode, setCssCode] = useState<string>(STARTER_CODE_BY_LANGUAGE.css);
  const [jsCode, setJsCode] = useState<string>(STARTER_CODE_BY_LANGUAGE.javascript);
  const [webTab, setWebTab] = useState<'html' | 'css' | 'javascript'>('html');

  const [stdin, setStdin] = useState<string>('');
  const [stdout, setStdout] = useState<string>('');
  const [stderr, setStderr] = useState<string>('');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  // True when the last C++ run happened in the browser sandbox rather than the official runner.
  const [practiceRun, setPracticeRun] = useState(false);
  // First-run compiler download, shown so a slow campus connection does not look like a frozen IDE.
  const [compilerStatus, setCompilerStatus] = useState<{ cached: boolean; percent: number | null } | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [sqlResults, setSqlResults] = useState<SqlQueryResult[] | null>(null);
  const [activeConsoleTab, setActiveConsoleTab] = useState<'output' | 'input' | 'preview'>('output');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewIframeRef = useRef<HTMLIFrameElement>(null);

  // Sync initial code if props update
  useEffect(() => {
    if (initialCode !== undefined) {
      setCode(initialCode);
    }
  }, [initialCode]);

  // Update parent when code changes
  const handleCodeChange = (newVal: string) => {
    setCode(newVal);
    onCodeChange?.(newVal);

    if (language === 'html') setHtmlCode(newVal);
    if (language === 'css') setCssCode(newVal);
    if (language === 'javascript') setJsCode(newVal);
  };

  const handleLanguageChange = (newLang: SupportedLanguage) => {
    setLanguage(newLang);
    const starter = STARTER_CODE_BY_LANGUAGE[newLang] || '';
    setCode(starter);
    onCodeChange?.(starter);
    setStdout('');
    setStderr('');
    setSqlResults(null);
    if (newLang === 'html' || newLang === 'css' || newLang === 'javascript') {
      setActiveConsoleTab('preview');
    } else {
      setActiveConsoleTab('output');
    }
  };

  const handleResetCode = () => {
    const starter = STARTER_CODE_BY_LANGUAGE[language] || '';
    handleCodeChange(starter);
    setStdout('');
    setStderr('');
    setSqlResults(null);
  };

  const handleCopyCode = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const extensions: Record<SupportedLanguage, string> = {
      cpp: 'cpp',
      python: 'py',
      java: 'java',
      html: 'html',
      css: 'css',
      javascript: 'js',
      sql: 'sql',
    };
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `solution.${extensions[language] || 'txt'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Keyboard Tab Indentation & Run Shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleRun();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;

      const newCode = code.substring(0, start) + '    ' + code.substring(end);
      handleCodeChange(newCode);

      setTimeout(() => {
        target.selectionStart = target.selectionEnd = start + 4;
      }, 0);
    }
  };

  // Execution dispatcher
  const handleRun = async () => {
    setIsRunning(true);
    setStdout('');
    setStderr('');
    setSqlResults(null);
    const startMs = performance.now();

    try {
      if (language === 'python') {
        setActiveConsoleTab('output');
        const res = await runPythonCode(code, stdin);
        setStdout(res.stdout);
        setStderr(res.stderr);
        setExecutionTime(res.durationMs);
        onExecute?.({
          stdout: res.stdout,
          stderr: res.stderr,
          durationMs: res.durationMs,
          status: res.status,
        });
      } else if (language === 'sql') {
        setActiveConsoleTab('output');
        const results = await executeSqlQuery(code);
        setSqlResults(results);
        const dur = Math.round(performance.now() - startMs);
        setExecutionTime(dur);
        const hasErr = results.some((r) => !!r.error);
        if (hasErr) {
          const errs = results.filter((r) => r.error).map((r) => r.error).join('\n');
          setStderr(errs);
        } else {
          setStdout(`Executed successfully: ${results.length} query block(s).`);
        }
        onExecute?.({
          stdout: `Executed ${results.length} statements`,
          stderr: hasErr ? 'SQL execution encountered errors' : '',
          durationMs: dur,
          status: hasErr ? 'error' : 'passed',
        });
      } else if (language === 'html' || language === 'css' || language === 'javascript') {
        setActiveConsoleTab('preview');
        const dur = Math.round(performance.now() - startMs);
        setExecutionTime(dur);
        setStdout('Live preview updated.');
      } else {
        // C++ and Java compile and run on the institution's isolated code runner. Without one,
        // C++ falls back to a practice run in a browser sandbox; Java has no browser fallback.
        setActiveConsoleTab('output');
        setPracticeRun(false);
        const langName = language === 'cpp' ? 'C++' : 'Java';
        const org = orgId ?? (await listOrganizations().catch(() => []))[0]?.id;
        let res: ServerRunResult | null = null;
        let serverUnavailable = !org;
        if (org) {
          try {
            res = await runOnServer(org, language as 'cpp' | 'java', code, stdin);
          } catch (err) {
            const codeName = (err as { code?: string }).code;
            if (codeName === 'RUNNER_NOT_CONFIGURED' || codeName === 'RUNNER_UNAVAILABLE') serverUnavailable = true;
            else throw err;
          }
        }
        if (!res && serverUnavailable && language === 'cpp') {
          setPracticeRun(true);
          setStdout('Compiling…');
          let browser;
          try {
            browser = await runCppInBrowser(code, stdin, {
              onLoading: (cached) => setCompilerStatus({ cached, percent: null }),
              onProgress: (done, total) => setCompilerStatus((s) => ({ cached: s?.cached ?? false, percent: Math.floor((done / Math.max(total, 1)) * 100) })),
              onCompiled: () => { setCompilerStatus(null); setStdout('Running…'); },
            });
          } finally {
            setCompilerStatus(null);
          }
          res = { status: browser.status, stdout: browser.stdout, stderr: browser.stderr, compileOutput: browser.compileOutput, exitCode: browser.exitCode, timeMs: Math.round(browser.runMs) };
        }
        if (!res) {
          const msg = `${langName} runs on your institution's code runner, and none is set up yet. Editing and submitting still work; faculty review the code.`;
          setStderr(msg);
          setExecutionTime(0);
          onExecute?.({ stdout: '', stderr: msg, durationMs: 0, status: 'error' });
          return;
        }
        setExecutionTime(res.timeMs);
        setStdout(res.stdout);
        const problem =
          res.status === 'compile_error' ? `Compilation error:\n${res.compileOutput}`
          : res.status === 'time_limit' ? `Time limit exceeded. ${res.stderr}`.trim()
          : res.status === 'memory_limit' ? 'Memory limit exceeded.'
          : res.status === 'runtime_error' ? `Runtime error (exit ${res.exitCode}).\n${res.stderr}`
          : res.stderr;
        setStderr(problem);
        onExecute?.({ stdout: res.stdout, stderr: problem, durationMs: res.timeMs, status: res.status === 'ok' ? 'passed' : 'error' });
      }
    } catch (err: any) {
      setStderr(err.message || String(err));
    } finally {
      setIsRunning(false);
    }
  };

  // Listen for console logs posted from preview iframe with strict origin/source validation
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      // Validate that message strictly originates from our preview iframe contentWindow
      if (!previewIframeRef.current || e.source !== previewIframeRef.current.contentWindow) {
        return;
      }
      if (e.data && e.data.type === 'CONNECT_LAB_CONSOLE') {
        const line = `[${String(e.data.level).toUpperCase()}] ${String(e.data.text)}\n`;
        setStdout((prev) => (prev.length < 65536 ? prev + line : prev));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const isWebLanguage = language === 'html' || language === 'css' || language === 'javascript';
  const previewDoc = buildSandboxedHtmlDoc({
    html: htmlCode,
    css: cssCode,
    javascript: jsCode,
  });

  return (
    <div
      className={`flex flex-col border border-[#E4E2DB] rounded-2xl bg-[#FFFFFF] shadow-sm overflow-hidden transition-all duration-200 ${
        isFullscreen ? 'fixed inset-4 z-50 shadow-2xl h-[calc(100vh-32px)]' : ''
      }`}
      style={{ height: isFullscreen ? 'calc(100vh - 32px)' : height }}
    >
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2.5 bg-[#FAF9FC] border-b border-[#E4E2DB] gap-2">
        <div className="flex items-center gap-2">
          {/* Language Selector */}
          <select
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value as SupportedLanguage)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#FFFFFF] border border-[#E4E2DB] text-[#17151F] hover:border-[#7444E8] focus:outline-none focus:ring-1 focus:ring-[#7444E8] cursor-pointer"
          >
            {allowedLanguages.map((lang) => (
              <option key={lang} value={lang}>
                {lang === 'cpp'
                  ? 'C++ (17/20)'
                  : lang === 'python'
                  ? 'Python 3.12 (WASM)'
                  : lang === 'java'
                  ? 'Java 21'
                  : lang === 'html'
                  ? 'HTML5'
                  : lang === 'css'
                  ? 'CSS3'
                  : lang === 'javascript'
                  ? 'JavaScript (ES6)'
                  : 'SQLite (WASM)'}
              </option>
            ))}
          </select>

          {/* Web Subtabs if in Web mode */}
          {isWebLanguage && (
            <div className="flex items-center gap-1 bg-[#F6F5F2] p-1 rounded-lg border border-[#E4E2DB]">
              {(['html', 'css', 'javascript'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    setWebTab(tab);
                    setLanguage(tab);
                    if (tab === 'html') setCode(htmlCode);
                    if (tab === 'css') setCode(cssCode);
                    if (tab === 'javascript') setCode(jsCode);
                  }}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                    webTab === tab
                      ? 'bg-[#FFFFFF] text-[#7444E8] shadow-xs font-semibold'
                      : 'text-[#5E5A50] hover:text-[#17151F]'
                  }`}
                >
                  {tab.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          {/* Runtime badge */}
          <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full bg-[#F1EBFF] text-[#7444E8]">
            <Sparkles className="w-3 h-3" />
            {language === 'python' || language === 'sql' ? 'Zero-latency In-Browser WASM' : isWebLanguage ? 'Live Sandboxed DOM' : 'Compiler Engine'}
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopyCode}
            title="Copy code"
            className="p-1.5 rounded-lg text-[#5E5A50] hover:text-[#17151F] hover:bg-[#F6F5F2] transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-[#2DBE74]" /> : <Copy className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            title="Download code"
            className="p-1.5 rounded-lg text-[#5E5A50] hover:text-[#17151F] hover:bg-[#F6F5F2] transition-colors"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleResetCode}
            title="Reset to starter template"
            className="p-1.5 rounded-lg text-[#5E5A50] hover:text-[#17151F] hover:bg-[#F6F5F2] transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            className="p-1.5 rounded-lg text-[#5E5A50] hover:text-[#17151F] hover:bg-[#F6F5F2] transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* Run Button */}
          <button
            type="button"
            onClick={handleRun}
            disabled={isRunning || readOnly}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#7444E8] hover:bg-[#6537D6] text-[#FFFFFF] text-xs font-semibold rounded-lg shadow-xs disabled:opacity-50 transition-all cursor-pointer"
          >
            <Play className={`w-3.5 h-3.5 fill-current ${isRunning ? 'animate-pulse' : ''}`} />
            {isRunning ? 'Running...' : 'Run Code'}
          </button>
        </div>
      </div>

      {/* Editor & Console Split Body */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Code Input Panel */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#FFFFFF] border-b md:border-b-0 md:border-r border-[#E4E2DB]">
          <div className="relative flex-1 flex overflow-hidden">
            {/* Line numbers column */}
            <div
              className="w-10 py-3 pr-2 text-right bg-[#FAF9FC] text-[#9C988D] text-xs font-mono select-none border-r border-[#F0EEE8] overflow-hidden"
              aria-hidden="true"
            >
              {code.split('\n').map((_, i) => (
                <div key={i} className="leading-6">
                  {i + 1}
                </div>
              ))}
            </div>

            {/* Code TextArea */}
            <textarea
              ref={textareaRef}
              value={code}
              onChange={(e) => handleCodeChange(e.target.value)}
              onKeyDown={handleKeyDown}
              readOnly={readOnly}
              spellCheck={false}
              className="flex-1 p-3 font-mono text-xs text-[#17151F] bg-[#FFFFFF] resize-none outline-none leading-6 selection:bg-[#F1EBFF] selection:text-[#7444E8]"
              placeholder="Write your code here..."
            />
          </div>
        </div>

        {/* Output & Console Panel */}
        <div className="w-full md:w-[42%] flex flex-col bg-[#FAF9FC] min-w-0 overflow-hidden">
          {/* Console Header Tabs */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#E4E2DB] bg-[#F6F5F2]">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveConsoleTab('output')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                  activeConsoleTab === 'output'
                    ? 'bg-[#FFFFFF] text-[#7444E8] font-semibold shadow-xs'
                    : 'text-[#5E5A50] hover:text-[#17151F]'
                }`}
              >
                <Terminal className="w-3 h-3" />
                Console
              </button>
              {showStdin && (
                <button
                  type="button"
                  onClick={() => setActiveConsoleTab('input')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                    activeConsoleTab === 'input'
                      ? 'bg-[#FFFFFF] text-[#7444E8] font-semibold shadow-xs'
                      : 'text-[#5E5A50] hover:text-[#17151F]'
                  }`}
                >
                  Input (stdin)
                </button>
              )}
              {isWebLanguage && showPreview && (
                <button
                  type="button"
                  onClick={() => setActiveConsoleTab('preview')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                    activeConsoleTab === 'preview'
                      ? 'bg-[#FFFFFF] text-[#7444E8] font-semibold shadow-xs'
                      : 'text-[#5E5A50] hover:text-[#17151F]'
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  Live Preview
                </button>
              )}
            </div>

            {/* Execution timing */}
            {executionTime !== null && (
              <span className="flex items-center gap-1 text-[11px] text-[#5E5A50]">
                <Clock className="w-3 h-3" />
                {executionTime}ms
              </span>
            )}
          </div>

          {/* Console View Area */}
          <div className="flex-1 p-3 overflow-auto font-mono text-xs">
            {activeConsoleTab === 'output' && (
              <div className="space-y-3">
                {practiceRun && language === 'cpp' && (
                  <p data-testid="practice-run-label" className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF4D1] text-[#6B4E00] px-2.5 py-0.5 text-[11px] font-bold font-sans">
                    Practice run (browser sandbox) · not an official grade
                  </p>
                )}
                {compilerStatus && (
                  <div data-testid="compiler-status" role="status" aria-live="polite" className="neu-pill inline-flex flex-col gap-1.5 px-3 py-2 font-sans text-[11px] text-[#17171A] max-w-full">
                    <span className="flex items-start gap-1.5 font-semibold">
                      <Loader2 className="w-3.5 h-3.5 shrink-0 mt-px animate-spin text-[#7444E8]" aria-hidden="true" />
                      <span>
                        {compilerStatus.cached
                          ? 'Loading the C++ compiler saved in this browser…'
                          : `Downloading C++ WebAssembly compiler (~${CLANG_DOWNLOAD_MB} MB, cached for future runs)…`}
                      </span>
                      {!compilerStatus.cached && compilerStatus.percent !== null && (
                        <span className="ml-auto pl-2 tabular-nums text-[#5A2FC7]">{compilerStatus.percent}%</span>
                      )}
                    </span>
                    {!compilerStatus.cached && (
                      <span className="block h-1.5 w-full rounded-full bg-[#ECE8F8] overflow-hidden" aria-hidden="true">
                        <span className="block h-full rounded-full bg-[#7444E8]" style={{ width: `${compilerStatus.percent ?? 0}%` }} />
                      </span>
                    )}
                  </div>
                )}
                {stdout && (
                  <div className="text-[#17151F] whitespace-pre-wrap leading-relaxed">
                    {stdout}
                  </div>
                )}
                {stderr && (
                  <div className="p-2.5 rounded-lg bg-[#FFE9E9] border border-[#FBD2D2] text-[#9B2C2C] whitespace-pre-wrap flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>{stderr}</div>
                  </div>
                )}
                {/* SQL Table Formatter */}
                {sqlResults && sqlResults.length > 0 && (
                  <div className="space-y-4">
                    {sqlResults.map((res, blockIdx) => (
                      <div key={blockIdx} className="overflow-x-auto rounded-lg border border-[#E4E2DB] bg-[#FFFFFF]">
                        {res.error ? (
                          <div className="p-2 text-xs text-[#9B2C2C] bg-[#FFE9E9]">{res.error}</div>
                        ) : (
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="bg-[#FAF9FC] border-b border-[#E4E2DB]">
                                {res.columns.map((col, cIdx) => (
                                  <th key={cIdx} className="px-3 py-1.5 font-semibold text-[#5E5A50] border-r border-[#E4E2DB] last:border-r-0">
                                    {col}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {res.values.length === 0 ? (
                                <tr>
                                  <td colSpan={res.columns.length || 1} className="px-3 py-2 text-[#9C988D] italic">
                                    0 rows returned
                                  </td>
                                </tr>
                              ) : (
                                res.values.map((row, rIdx) => (
                                  <tr key={rIdx} className="border-b border-[#F0EEE8] hover:bg-[#F6F5F2]">
                                    {row.map((val, cellIdx) => (
                                      <td key={cellIdx} className="px-3 py-1.5 border-r border-[#F0EEE8] last:border-r-0 text-[#17151F]">
                                        {val === null ? <span className="text-[#9C988D]">NULL</span> : String(val)}
                                      </td>
                                    ))}
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        )}
                        <div className="px-3 py-1 bg-[#FAF9FC] border-t border-[#E4E2DB] text-[10px] text-[#5E5A50] text-right">
                          {res.rowCount} row(s) in {res.executionTimeMs}ms
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!stdout && !stderr && (!sqlResults || sqlResults.length === 0) && (
                  <div className="text-[#9C988D] italic py-8 text-center font-sans">
                    Click &quot;Run Code&quot; or press Ctrl+Enter to execute.
                  </div>
                )}
              </div>
            )}

            {activeConsoleTab === 'input' && (
              <textarea
                value={stdin}
                onChange={(e) => setStdin(e.target.value)}
                placeholder="Enter standard input lines here (provided to input() or std::cin)..."
                className="w-full h-full p-2 text-xs font-mono text-[#17151F] bg-[#FFFFFF] border border-[#E4E2DB] rounded-lg resize-none outline-none focus:border-[#7444E8]"
              />
            )}

            {activeConsoleTab === 'preview' && isWebLanguage && (
              <div className="w-full h-full bg-[#FFFFFF] rounded-lg border border-[#E4E2DB] overflow-hidden">
                <iframe
                  ref={previewIframeRef}
                  srcDoc={previewDoc}
                  title="HTML/CSS/JS Live Preview"
                  sandbox="allow-scripts"
                  className="w-full h-full border-0"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
