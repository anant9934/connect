// Compiles every C++ curriculum exercise with a real Clang (WebAssembly) and checks that:
//  - the starter code compiles (so students start from something that builds), and
//  - a reference solution passes every visible and hidden test.
// Opt-in, because it downloads the compiler (~105 MB):
//   npm install --no-save @yowasp/clang@22.0.0-git20542-10 && node test/verify_cpp_curriculum.mjs
import { register } from 'node:module';
import { WASI } from 'node:wasi';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) { try { return await n(s + '.ts', c); } catch {} } return n(s, c); }`));
const { OOP_MODULES, DSA_MODULES } = await import('../features/lab/curriculum/cpp.ts');
const { runClang } = await import('@yowasp/clang');

const REFERENCE = {
  'Top Student': `#include <iostream>
#include <iomanip>
#include <string>
using namespace std;
class Student { public: string name; int marks; Student(string n, int m) : name(n), marks(m) {} };
int main() { int n; cin >> n; string top; int best = -1; double sum = 0;
  for (int i = 0; i < n; i++) { string nm; int m; cin >> nm >> m; Student s(nm, m); sum += s.marks; if (s.marks > best) { best = s.marks; top = s.name; } }
  cout << "Top: " << top << endl << fixed << setprecision(2) << "Average: " << sum / n << endl; }`,
  'Validated Bank Account': `#include <iostream>
#include <string>
using namespace std;
class BankAccount { long long balance; public: BankAccount(long long o) : balance(o) {}
  bool deposit(long long a) { if (a <= 0) return false; balance += a; return true; }
  bool withdraw(long long a) { if (a <= 0 || a > balance) return false; balance -= a; return true; }
  long long getBalance() const { return balance; } };
int main() { long long o; int q; cin >> o >> q; BankAccount acc(o); int r = 0;
  while (q--) { string op; long long a; cin >> op >> a; if (!(op == "deposit" ? acc.deposit(a) : acc.withdraw(a))) r++; }
  cout << "Balance: " << acc.getBalance() << endl << "Rejected: " << r << endl; }`,
  'Employees and Managers': `#include <iostream>
#include <string>
#include <vector>
using namespace std;
class Employee { protected: string name; long long salary; public: Employee(string n, long long s) : name(n), salary(s) {}
  virtual long long pay() const { return salary; } string getName() const { return name; } virtual ~Employee() {} };
class Manager : public Employee { long long bonus; public: Manager(string n, long long s, long long b) : Employee(n, s), bonus(b) {}
  long long pay() const override { return salary + bonus; } };
int main() { int n; cin >> n; vector<Employee*> v;
  for (int i = 0; i < n; i++) { char k; string nm; long long s; cin >> k >> nm >> s; if (k == 'M') { long long b; cin >> b; v.push_back(new Manager(nm, s, b)); } else v.push_back(new Employee(nm, s)); }
  for (auto e : v) cout << e->getName() << " " << e->pay() << endl; }`,
  'Shape Areas': `#include <iostream>
#include <iomanip>
#include <string>
#include <vector>
using namespace std;
const double PI = 3.14159265358979;
class Shape { public: virtual double area() const = 0; virtual string kind() const = 0; virtual ~Shape() {} };
class Rectangle : public Shape { double w, h; public: Rectangle(double a, double b) : w(a), h(b) {} double area() const override { return w * h; } string kind() const override { return "Rectangle"; } };
class Circle : public Shape { double r; public: Circle(double a) : r(a) {} double area() const override { return PI * r * r; } string kind() const override { return "Circle"; } };
class Triangle : public Shape { double b, h; public: Triangle(double x, double y) : b(x), h(y) {} double area() const override { return 0.5 * b * h; } string kind() const override { return "Triangle"; } };
int main() { int n; cin >> n; vector<Shape*> v;
  for (int i = 0; i < n; i++) { char k; double a, b = 0; cin >> k >> a; if (k != 'C') cin >> b;
    if (k == 'R') v.push_back(new Rectangle(a, b)); else if (k == 'C') v.push_back(new Circle(a)); else v.push_back(new Triangle(a, b)); }
  double total = 0; Shape* best = nullptr; for (auto s : v) { total += s->area(); if (!best || s->area() > best->area()) best = s; }
  cout << fixed << setprecision(2) << "Total: " << total << endl << "Largest: " << best->kind() << endl; }`,
  'Maximum Subarray Sum': `#include <iostream>
#include <vector>
using namespace std;
int main() { int n; cin >> n; long long best, cur; cin >> best; cur = best;
  for (int i = 1; i < n; i++) { long long x; cin >> x; cur = max(x, cur + x); best = max(best, cur); } cout << best << endl; }`,
  'Reverse a Linked List': `#include <iostream>
using namespace std;
struct Node { int val; Node* next; Node(int v) : val(v), next(nullptr) {} };
int main() { int n; cin >> n; Node* h = nullptr; Node* t = nullptr;
  for (int i = 0; i < n; i++) { int v; cin >> v; Node* x = new Node(v); if (!h) h = t = x; else { t->next = x; t = x; } }
  Node* prev = nullptr; while (h) { Node* nx = h->next; h->next = prev; prev = h; h = nx; }
  for (Node* p = prev; p; p = p->next) cout << p->val << (p->next ? " " : ""); cout << endl; }`,
  'Balanced Brackets': `#include <iostream>
#include <stack>
#include <string>
using namespace std;
bool ok(const string& s) { stack<char> st; for (char c : s) { if (c == '(' || c == '[' || c == '{') st.push(c); else {
  if (st.empty()) return false; char o = st.top(); st.pop(); if ((c == ')' && o != '(') || (c == ']' && o != '[') || (c == '}' && o != '{')) return false; } } return st.empty(); }
int main() { int q; cin >> q; while (q--) { string s; cin >> s; cout << (ok(s) ? "YES" : "NO") << endl; } }`,
  'Counting-Out Game': `#include <iostream>
#include <queue>
#include <string>
using namespace std;
int main() { int n, k; cin >> n >> k; queue<string> q; for (int i = 0; i < n; i++) { string s; cin >> s; q.push(s); }
  string order; while (q.size() > 1) { for (int i = 1; i < k; i++) { q.push(q.front()); q.pop(); } if (!order.empty()) order += " "; order += q.front(); q.pop(); }
  cout << order << endl << "Winner: " << q.front() << endl; }`,
  'Build a BST': `#include <iostream>
using namespace std;
struct Node { int key; Node* l; Node* r; Node(int k) : key(k), l(nullptr), r(nullptr) {} };
Node* ins(Node* t, int k) { if (!t) return new Node(k); if (k < t->key) t->l = ins(t->l, k); else t->r = ins(t->r, k); return t; }
void in(Node* t, bool& f) { if (!t) return; in(t->l, f); cout << (f ? "" : " ") << t->key; f = false; in(t->r, f); }
int h(Node* t) { return t ? 1 + max(h(t->l), h(t->r)) : 0; }
int main() { int n; cin >> n; Node* r = nullptr; for (int i = 0; i < n; i++) { int k; cin >> k; r = ins(r, k); } bool f = true; in(r, f); cout << endl << "Height: " << h(r) << endl; }`,
  'Shortest Path by BFS': `#include <iostream>
#include <queue>
#include <vector>
using namespace std;
int main() { int n, m; cin >> n >> m; vector<vector<int>> g(n); for (int i = 0; i < m; i++) { int a, b; cin >> a >> b; g[a].push_back(b); g[b].push_back(a); }
  int s, t; cin >> s >> t; vector<int> d(n, -1); queue<int> q; d[s] = 0; q.push(s);
  while (!q.empty()) { int u = q.front(); q.pop(); for (int v : g[u]) if (d[v] < 0) { d[v] = d[u] + 1; q.push(v); } }
  cout << d[t] << endl; }`,
  'Binary Search Queries': `#include <iostream>
#include <vector>
using namespace std;
int main() { int n; cin >> n; vector<int> a(n); for (auto& x : a) cin >> x; int q; cin >> q;
  while (q--) { int x; cin >> x; int lo = 0, hi = n - 1, ans = -1; while (lo <= hi) { int mid = lo + (hi - lo) / 2; if (a[mid] == x) { ans = mid; break; } if (a[mid] < x) lo = mid + 1; else hi = mid - 1; } cout << ans << endl; } }`,
  'Merge Sort with Inversions': `#include <iostream>
#include <vector>
using namespace std;
long long ms(vector<int>& a, int lo, int hi) { if (hi - lo < 2) return 0; int mid = (lo + hi) / 2; long long c = ms(a, lo, mid) + ms(a, mid, hi);
  vector<int> t; int i = lo, j = mid; while (i < mid && j < hi) { if (a[i] <= a[j]) t.push_back(a[i++]); else { c += mid - i; t.push_back(a[j++]); } }
  while (i < mid) t.push_back(a[i++]); while (j < hi) t.push_back(a[j++]); for (int k = lo; k < hi; k++) a[k] = t[k - lo]; return c; }
int main() { int n; cin >> n; vector<int> a(n); for (auto& x : a) cin >> x; long long c = ms(a, 0, n);
  for (int i = 0; i < n; i++) cout << a[i] << (i + 1 < n ? " " : ""); cout << endl << "Inversions: " << c << endl; }`,
  'Longest Common Subsequence': `#include <iostream>
#include <string>
#include <vector>
using namespace std;
int main() { string a, b; cin >> a >> b; vector<vector<int>> d(a.size() + 1, vector<int>(b.size() + 1, 0));
  for (size_t i = 1; i <= a.size(); i++) for (size_t j = 1; j <= b.size(); j++) d[i][j] = a[i-1] == b[j-1] ? d[i-1][j-1] + 1 : max(d[i-1][j], d[i][j-1]);
  cout << d[a.size()][b.size()] << endl; }`,
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-curriculum-'));
const compile = async (src) => (await runClang(['clang++', '-std=c++17', '-O1', '-fno-exceptions', 'main.cpp', '-o', 'main.wasm'], { 'main.cpp': src }, { stdout: () => {}, stderr: () => {} }))['main.wasm'];
const run = async (wasm, input) => {
  const inFile = path.join(dir, 'in.txt'), outFile = path.join(dir, 'out.txt');
  fs.writeFileSync(inFile, input);
  const stdin = fs.openSync(inFile, 'r'), stdout = fs.openSync(outFile, 'w');
  const wasi = new WASI({ version: 'preview1', stdin, stdout, args: [] });
  wasi.start(await WebAssembly.instantiate(await WebAssembly.compile(wasm), { wasi_snapshot_preview1: wasi.wasiImport }));
  fs.closeSync(stdin); fs.closeSync(stdout);
  return fs.readFileSync(outFile, 'utf8');
};
const norm = (s) => s.replace(/\r\n/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').replace(/\n+$/, '');

let failures = 0;
for (const m of [...OOP_MODULES, ...DSA_MODULES]) {
  const ex = m.sampleExercise;
  try { await compile(ex.starterCode); } catch { console.log(`FAIL starter does not compile: ${ex.title}`); failures++; }
  const ref = REFERENCE[ex.title];
  if (!ref) { console.log(`FAIL no reference solution: ${ex.title}`); failures++; continue; }
  const wasm = await compile(ref);
  for (const tc of ex.testCases) {
    const got = norm(await run(wasm, tc.input));
    if (got !== norm(tc.expected_output)) { console.log(`FAIL ${ex.title}${tc.is_hidden ? ' (hidden)' : ''}: expected ${JSON.stringify(tc.expected_output)} got ${JSON.stringify(got)}`); failures++; }
  }
  console.log(`checked ${m.title}: ${ex.title} (${ex.testCases.length} tests)`);
}
console.log(failures === 0 ? 'ALL CURRICULUM TESTS PASS' : `${failures} FAILURES`);
process.exit(failures ? 1 : 0);
