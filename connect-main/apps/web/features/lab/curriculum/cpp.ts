// The C++ OOP and DSA practical curriculum: one module per core topic, each with lessons and an
// exercise that reads real input, a starter that compiles, and visible and hidden tests.
// Reference solutions live in test/verify_cpp_curriculum.mjs, which compiles and runs every
// test against them, so a test here is never wrong.
import type { PilotCourseMeta } from '../types';

type Module = PilotCourseMeta['modules'][number];
type Difficulty = Module['sampleExercise']['difficulty'];
type Test = { input: string; expected_output: string; is_hidden: boolean };

const mod = (order: number, title: string, description: string, lessons: string[], ex: { title: string; problem: string; difficulty: Difficulty; starterCode: string; testCases: Test[] }): Module => ({
  order, title, description, lessons, sampleExercise: { ...ex, language: 'cpp' },
});
const t = (input: string, expected_output: string, is_hidden = false): Test => ({ input, expected_output, is_hidden });

export const OOP_MODULES: Module[] = [
  mod(1, 'Classes & Objects', 'Defining classes, member variables and functions, constructors, and creating objects.',
    ['Class anatomy and member functions', 'Constructors and initialisation lists', 'Arrays of objects'], {
      title: 'Top Student', difficulty: 'beginner',
      problem: 'Read n, then n lines of "name marks". Store each as a Student object. Print "Top: <name>" for the highest marks (the first one on a tie) and "Average: <avg>" with two decimals.',
      starterCode: `#include <iostream>
#include <iomanip>
#include <string>
#include <vector>
using namespace std;

class Student {
public:
    string name;
    int marks;
    Student(string n, int m) : name(n), marks(m) {}
};

int main() {
    int n;
    cin >> n;
    vector<Student> students;
    for (int i = 0; i < n; i++) {
        string name; int marks;
        cin >> name >> marks;
        students.push_back(Student(name, marks));
    }
    // TODO: find the top student and the average
    cout << "Top: " << "?" << endl;
    cout << fixed << setprecision(2) << "Average: " << 0.0 << endl;
    return 0;
}`,
      testCases: [t('3\nAsha 91\nRavi 78\nMeera 85\n', 'Top: Asha\nAverage: 84.67'), t('2\nZoya 60\nAmit 60\n', 'Top: Zoya\nAverage: 60.00'), t('1\nKiran 100\n', 'Top: Kiran\nAverage: 100.00', true)],
    }),
  mod(2, 'Encapsulation', 'Private state behind a public interface, validation in member functions, and const correctness.',
    ['Access specifiers', 'Invariants and validation', 'Const member functions'], {
      title: 'Validated Bank Account', difficulty: 'easy',
      problem: 'Read the opening balance, then q operations ("deposit x" or "withdraw x"). Keep the balance private. Reject non-positive amounts and withdrawals larger than the balance. Print "Balance: <b>" and "Rejected: <count>".',
      starterCode: `#include <iostream>
#include <string>
using namespace std;

class BankAccount {
private:
    long long balance;
public:
    BankAccount(long long opening) : balance(opening) {}
    bool deposit(long long amount) {
        // TODO: reject amounts that are not positive
        return false;
    }
    bool withdraw(long long amount) {
        // TODO: reject non-positive amounts and overdrafts
        return false;
    }
    long long getBalance() const { return balance; }
};

int main() {
    long long opening; int q;
    cin >> opening >> q;
    BankAccount account(opening);
    int rejected = 0;
    for (int i = 0; i < q; i++) {
        string op; long long amount;
        cin >> op >> amount;
        bool ok = op == "deposit" ? account.deposit(amount) : account.withdraw(amount);
        if (!ok) rejected++;
    }
    cout << "Balance: " << account.getBalance() << endl;
    cout << "Rejected: " << rejected << endl;
    return 0;
}`,
      testCases: [t('100\n4\ndeposit 50\nwithdraw 30\nwithdraw 500\ndeposit -5\n', 'Balance: 120\nRejected: 2'), t('0\n2\nwithdraw 1\ndeposit 10\n', 'Balance: 10\nRejected: 1'), t('500\n3\nwithdraw 500\nwithdraw 1\ndeposit 0\n', 'Balance: 0\nRejected: 2', true)],
    }),
  mod(3, 'Inheritance', 'Base and derived classes, protected members, constructor chaining and code reuse.',
    ['Public inheritance', 'Calling base constructors', 'Overriding behaviour'], {
      title: 'Employees and Managers', difficulty: 'easy',
      problem: 'Read n lines, each "E name salary" or "M name salary bonus". Model Employee as a base class and Manager as a derived class whose pay is salary plus bonus. Print "<name> <pay>" for each, in input order.',
      starterCode: `#include <iostream>
#include <string>
#include <vector>
using namespace std;

class Employee {
protected:
    string name;
    long long salary;
public:
    Employee(string n, long long s) : name(n), salary(s) {}
    virtual long long pay() const { return salary; }
    string getName() const { return name; }
    virtual ~Employee() {}
};

// TODO: class Manager : public Employee, with a bonus added to pay()

int main() {
    int n;
    cin >> n;
    vector<Employee*> staff;
    for (int i = 0; i < n; i++) {
        char kind; string name; long long salary;
        cin >> kind >> name >> salary;
        if (kind == 'M') {
            long long bonus; cin >> bonus;
            staff.push_back(new Employee(name, salary)); // TODO: make a Manager
        } else {
            staff.push_back(new Employee(name, salary));
        }
    }
    for (Employee* e : staff) cout << e->getName() << " " << e->pay() << endl;
    for (Employee* e : staff) delete e;
    return 0;
}`,
      testCases: [t('3\nE Asha 50000\nM Ravi 60000 15000\nE Meera 42000\n', 'Asha 50000\nRavi 75000\nMeera 42000'), t('1\nM Dev 1000 1\n', 'Dev 1001'), t('2\nM A 0 0\nE B 7\n', 'A 0\nB 7', true)],
    }),
  mod(4, 'Polymorphism', 'Virtual functions, abstract base classes, and runtime dispatch through base pointers.',
    ['Pure virtual functions', 'Dynamic dispatch and vtables', 'Virtual destructors'], {
      title: 'Shape Areas', difficulty: 'medium',
      problem: 'Read n shapes: "R w h" (rectangle), "C r" (circle, use pi = 3.14159265358979) or "T b h" (triangle). Use an abstract Shape with a virtual area(). Print "Total: <sum>" with two decimals and "Largest: <Rectangle|Circle|Triangle>" (the first on a tie).',
      starterCode: `#include <iostream>
#include <iomanip>
#include <string>
#include <vector>
using namespace std;

const double PI = 3.14159265358979;

class Shape {
public:
    virtual double area() const = 0;
    virtual string kind() const = 0;
    virtual ~Shape() {}
};

// TODO: Rectangle, Circle and Triangle derived from Shape

int main() {
    int n;
    cin >> n;
    vector<Shape*> shapes;
    for (int i = 0; i < n; i++) {
        char k; cin >> k;
        double a, b = 0;
        cin >> a;
        if (k != 'C') cin >> b;
        // TODO: create the right shape and push it
    }
    double total = 0;
    string largest = "None";
    // TODO: total area and the largest shape
    cout << fixed << setprecision(2) << "Total: " << total << endl;
    cout << "Largest: " << largest << endl;
    for (Shape* s : shapes) delete s;
    return 0;
}`,
      testCases: [t('3\nR 3 4\nC 1\nT 6 2\n', 'Total: 21.14\nLargest: Rectangle'), t('2\nC 2\nR 1 1\n', 'Total: 13.57\nLargest: Circle'), t('2\nT 4 4\nR 2 4\n', 'Total: 16.00\nLargest: Triangle', true)],
    }),
];

export const DSA_MODULES: Module[] = [
  mod(1, 'Arrays', 'Traversal, prefix sums and the maximum subarray problem (Kadane).',
    ['Indexing and traversal', 'Prefix sums', "Kadane's algorithm"], {
      title: 'Maximum Subarray Sum', difficulty: 'easy',
      problem: 'Read n and n integers. Print the largest sum of a non-empty contiguous subarray.',
      starterCode: `#include <iostream>
#include <vector>
using namespace std;

long long maxSubarray(const vector<long long>& a) {
    // TODO: Kadane's algorithm in O(n)
    return 0;
}

int main() {
    int n; cin >> n;
    vector<long long> a(n);
    for (auto& x : a) cin >> x;
    cout << maxSubarray(a) << endl;
    return 0;
}`,
      testCases: [t('8\n-2 1 -3 4 -1 2 1 -5\n', '6'), t('1\n5\n', '5'), t('3\n-3 -1 -2\n', '-1', true)],
    }),
  mod(2, 'Linked Lists', 'Nodes and pointers, insertion, traversal and in-place reversal.',
    ['Node allocation with new', 'Traversal and insertion', 'Reversing in place'], {
      title: 'Reverse a Linked List', difficulty: 'easy',
      problem: 'Read n and n integers, build a singly linked list in that order, reverse it in place, and print the values separated by spaces.',
      starterCode: `#include <iostream>
using namespace std;

struct Node {
    int val;
    Node* next;
    Node(int v) : val(v), next(nullptr) {}
};

Node* reverseList(Node* head) {
    // TODO: reverse the next pointers in O(n) time and O(1) space
    return head;
}

int main() {
    int n; cin >> n;
    Node* head = nullptr; Node* tail = nullptr;
    for (int i = 0; i < n; i++) {
        int v; cin >> v;
        Node* node = new Node(v);
        if (!head) head = tail = node; else { tail->next = node; tail = node; }
    }
    head = reverseList(head);
    for (Node* p = head; p; p = p->next) cout << p->val << (p->next ? " " : "");
    cout << endl;
    return 0;
}`,
      testCases: [t('5\n1 2 3 4 5\n', '5 4 3 2 1'), t('2\n10 20\n', '20 10'), t('1\n7\n', '7', true)],
    }),
  mod(3, 'Stacks', 'LIFO order with std::stack and matching brackets.',
    ['Push, pop and top', 'Balanced brackets', 'Expression evaluation'], {
      title: 'Balanced Brackets', difficulty: 'easy',
      problem: 'Read q, then q strings of brackets ()[]{}. For each print YES if it is balanced, otherwise NO.',
      starterCode: `#include <iostream>
#include <stack>
#include <string>
using namespace std;

bool balanced(const string& s) {
    stack<char> st;
    // TODO: push opening brackets, match closing ones
    return false;
}

int main() {
    int q; cin >> q;
    while (q--) {
        string s; cin >> s;
        cout << (balanced(s) ? "YES" : "NO") << endl;
    }
    return 0;
}`,
      testCases: [t('3\n{[()]}\n([)]\n((\n', 'YES\nNO\nNO'), t('2\n()[]{}\n]\n', 'YES\nNO'), t('1\n{{[[(())]]}}\n', 'YES', true)],
    }),
  mod(4, 'Queues', 'FIFO order with std::queue and simulations.',
    ['Enqueue and dequeue', 'Circular simulation', 'Queues in BFS'], {
      title: 'Counting-Out Game', difficulty: 'medium',
      problem: 'Read n and k, then n names in a circle. Counting from the first, every k-th person leaves. Use a queue. Print the names in the order they leave on one line, then "Winner: <name>".',
      starterCode: `#include <iostream>
#include <queue>
#include <string>
using namespace std;

int main() {
    int n, k; cin >> n >> k;
    queue<string> q;
    for (int i = 0; i < n; i++) { string s; cin >> s; q.push(s); }
    string order;
    // TODO: rotate k-1 people to the back, then remove the front, until one remains
    cout << order << endl;
    cout << "Winner: " << q.front() << endl;
    return 0;
}`,
      testCases: [t('5 3\nA B C D E\n', 'C A E B\nWinner: D'), t('3 1\nX Y Z\n', 'X Y\nWinner: Z'), t('4 2\nP Q R S\n', 'Q S R\nWinner: P', true)],
    }),
  mod(5, 'Trees', 'Binary search trees: insertion, traversals and height.',
    ['BST insertion', 'In-order traversal is sorted', 'Height and balance'], {
      title: 'Build a BST', difficulty: 'medium',
      problem: 'Read n distinct integers and insert them into a BST in that order. Print the in-order traversal on one line, then "Height: <h>" where a single node has height 1.',
      starterCode: `#include <iostream>
using namespace std;

struct Node {
    int key;
    Node* left;
    Node* right;
    Node(int k) : key(k), left(nullptr), right(nullptr) {}
};

Node* insert(Node* root, int key) {
    // TODO
    return root;
}

void inorder(Node* root, bool& first) {
    // TODO: print keys in sorted order, separated by spaces
}

int height(Node* root) {
    // TODO
    return 0;
}

int main() {
    int n; cin >> n;
    Node* root = nullptr;
    for (int i = 0; i < n; i++) { int k; cin >> k; root = insert(root, k); }
    bool first = true;
    inorder(root, first);
    cout << endl << "Height: " << height(root) << endl;
    return 0;
}`,
      testCases: [t('7\n50 30 70 20 40 60 80\n', '20 30 40 50 60 70 80\nHeight: 3'), t('4\n1 2 3 4\n', '1 2 3 4\nHeight: 4'), t('1\n9\n', '9\nHeight: 1', true)],
    }),
  mod(6, 'Graphs', 'Adjacency lists, breadth-first search and shortest paths in unweighted graphs.',
    ['Adjacency lists', 'Breadth-first search', 'Connected components'], {
      title: 'Shortest Path by BFS', difficulty: 'medium',
      problem: 'Read n nodes (0 to n-1) and m undirected edges, then s and t. Print the fewest edges on a path from s to t, or -1 if there is none.',
      starterCode: `#include <iostream>
#include <queue>
#include <vector>
using namespace std;

int main() {
    int n, m; cin >> n >> m;
    vector<vector<int>> adj(n);
    for (int i = 0; i < m; i++) { int a, b; cin >> a >> b; adj[a].push_back(b); adj[b].push_back(a); }
    int s, t; cin >> s >> t;
    // TODO: BFS from s; dist[t] or -1
    cout << -1 << endl;
    return 0;
}`,
      testCases: [t('5 5\n0 1\n0 2\n1 3\n2 3\n3 4\n0 4\n', '3'), t('4 2\n0 1\n2 3\n0 3\n', '-1'), t('3 3\n0 1\n1 2\n0 2\n2 2\n', '0', true)],
    }),
  mod(7, 'Searching', 'Linear and binary search on sorted data.',
    ['Linear search', 'Binary search invariants', 'Lower and upper bounds'], {
      title: 'Binary Search Queries', difficulty: 'easy',
      problem: 'Read n sorted distinct integers, then q queries. For each query print its index (0-based) or -1. Use binary search.',
      starterCode: `#include <iostream>
#include <vector>
using namespace std;

int search(const vector<int>& a, int x) {
    // TODO: binary search in O(log n)
    return -1;
}

int main() {
    int n; cin >> n;
    vector<int> a(n);
    for (auto& x : a) cin >> x;
    int q; cin >> q;
    while (q--) { int x; cin >> x; cout << search(a, x) << endl; }
    return 0;
}`,
      testCases: [t('6\n1 3 5 7 9 11\n3\n7\n2\n11\n', '3\n-1\n5'), t('1\n4\n2\n4\n5\n', '0\n-1'), t('5\n-9 -4 0 3 8\n2\n-9\n8\n', '0\n4', true)],
    }),
  mod(8, 'Sorting', 'Comparison sorts and divide and conquer with merge sort.',
    ['Bubble, insertion and selection sort', 'Merge sort', 'Counting inversions'], {
      title: 'Merge Sort with Inversions', difficulty: 'hard',
      problem: 'Read n integers. Sort them with merge sort and count inversions (pairs i < j with a[i] > a[j]) while merging. Print the sorted values, then "Inversions: <count>".',
      starterCode: `#include <iostream>
#include <vector>
using namespace std;

long long mergeSort(vector<int>& a, int lo, int hi) {
    // TODO: sort a[lo..hi) and return the inversions inside it
    return 0;
}

int main() {
    int n; cin >> n;
    vector<int> a(n);
    for (auto& x : a) cin >> x;
    long long inv = mergeSort(a, 0, n);
    for (int i = 0; i < n; i++) cout << a[i] << (i + 1 < n ? " " : "");
    cout << endl << "Inversions: " << inv << endl;
    return 0;
}`,
      testCases: [t('5\n2 4 1 3 5\n', '1 2 3 4 5\nInversions: 3'), t('4\n4 3 2 1\n', '1 2 3 4\nInversions: 6'), t('3\n1 1 1\n', '1 1 1\nInversions: 0', true)],
    }),
  mod(9, 'Dynamic Programming', 'Overlapping subproblems, memoisation and tabulation.',
    ['Recursion with memoisation', 'Tabulation', 'Longest common subsequence'], {
      title: 'Longest Common Subsequence', difficulty: 'hard',
      problem: 'Read two strings, one per line. Print the length of their longest common subsequence.',
      starterCode: `#include <iostream>
#include <string>
#include <vector>
using namespace std;

int lcs(const string& a, const string& b) {
    // TODO: dp[i][j] = LCS of a[0..i) and b[0..j)
    return 0;
}

int main() {
    string a, b;
    cin >> a >> b;
    cout << lcs(a, b) << endl;
    return 0;
}`,
      testCases: [t('ABCBDAB\nBDCABA\n', '4'), t('AAAA\nAA\n', '2'), t('XYZ\nABC\n', '0', true)],
    }),
];
