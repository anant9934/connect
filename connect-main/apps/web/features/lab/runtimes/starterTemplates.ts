import type { SupportedLanguage, PilotCourseMeta } from '../types';

export const STARTER_CODE_BY_LANGUAGE: Record<SupportedLanguage, string> = {
  cpp: `#include <iostream>
#include <vector>
#include <string>

using namespace std;

// Class demonstration: Object-Oriented C++
class Student {
private:
    string name;
    int rollNumber;
    vector<int> marks;

public:
    Student(string n, int r) : name(n), rollNumber(r) {}

    void addMark(int mark) {
        marks.push_back(mark);
    }

    double getAverage() const {
        if (marks.empty()) return 0.0;
        double sum = 0;
        for (int m : marks) sum += m;
        return sum / marks.size();
    }

    void display() const {
        cout << "Student: " << name << " (Roll #" << rollNumber << ")" << endl;
        cout << "Average Grade: " << getAverage() << endl;
    }
};

int main() {
    Student s1("Alex Mercer", 101);
    s1.addMark(92);
    s1.addMark(88);
    s1.addMark(95);
    s1.display();

    return 0;
}
`,

  python: `"""
Python 3 Interactive Practical Workspace
Supports Python standard library, data structures & algorithms.
"""

def solve_fibonacci(n: int) -> list[int]:
    """Generates the first n numbers of the Fibonacci sequence."""
    if n <= 0:
        return []
    if n == 1:
        return [0]

    seq = [0, 1]
    for _ in range(2, n):
        seq.append(seq[-1] + seq[-2])
    return seq

def analyze_student_scores(records: dict) -> None:
    print("--- Student Score Report ---")
    for name, scores in records.items():
        avg = sum(scores) / len(scores) if scores else 0
        status = "PASSED" if avg >= 60 else "NEEDS IMPROVEMENT"
        print(f"{name:15}: Avg = {avg:6.2f} [{status}]")

if __name__ == "__main__":
    print("Fibonacci(10):", solve_fibonacci(10))
    print()

    class_scores = {
        "Alex Mercer": [92, 88, 95],
        "Sara Connor": [78, 82, 85],
        "Bruce Wayne": [95, 99, 98],
    }
    analyze_student_scores(class_scores)
`,

  java: `import java.util.ArrayList;
import java.util.List;

public class Main {
    // Encapsulation demonstration
    static class Node<T> {
        T data;
        Node<T> next;

        public Node(T data) {
            this.data = data;
            this.next = null;
        }
    }

    static class SinglyLinkedList<T> {
        private Node<T> head;
        private int size;

        public SinglyLinkedList() {
            this.head = null;
            this.size = 0;
        }

        public void insert(T val) {
            Node<T> newNode = new Node<>(val);
            if (head == null) {
                head = newNode;
            } else {
                Node<T> curr = head;
                while (curr.next != null) {
                    curr = curr.next;
                }
                curr.next = newNode;
            }
            size++;
        }

        public void printList() {
            Node<T> curr = head;
            System.out.print("LinkedList: [");
            while (curr != null) {
                System.out.print(curr.data + (curr.next != null ? " -> " : ""));
                curr = curr.next;
            }
            System.out.println("] (Size: " + size + ")");
        }
    }

    public static void main(String[] args) {
        System.out.println("Java Practical Learning Platform");
        SinglyLinkedList<Integer> list = new SinglyLinkedList<>();
        list.insert(10);
        list.insert(20);
        list.insert(30);
        list.insert(40);
        list.printList();
    }
}
`,

  html: `<!-- Interactive HTML5 Document -->
<div class="card">
  <div class="header">
    <div class="badge">Live Preview</div>
    <h1>Connect Web Development Lab</h1>
  </div>
  <p>Modify HTML, CSS, and JavaScript in real-time with responsive previews.</p>

  <div class="interactive-box">
    <input type="text" id="nameInput" placeholder="Enter your name..." />
    <button id="greetBtn" class="btn">Say Hello</button>
  </div>
  <div id="greetingOutput" class="output">Waiting for input...</div>
</div>
`,

  css: `/* Modern Component Styles */
.card {
  max-width: 480px;
  margin: 32px auto;
  padding: 24px;
  border-radius: 16px;
  background: #FFFFFF;
  border: 1px solid #E4E2DB;
  box-shadow: 0 4px 20px -2px rgba(23, 21, 31, 0.08);
}

.header {
  margin-bottom: 16px;
}

.badge {
  display: inline-block;
  padding: 4px 10px;
  background: #F1EBFF;
  color: #7444E8;
  font-size: 12px;
  font-weight: 600;
  border-radius: 9999px;
  margin-bottom: 8px;
}

h1 {
  margin: 0;
  font-size: 22px;
  color: #17151F;
}

p {
  color: #5E5A50;
  font-size: 14px;
}

.interactive-box {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #E4E2DB;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
}

input:focus {
  border-color: #7444E8;
}

.btn {
  padding: 10px 18px;
  background: #7444E8;
  color: #FFFFFF;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}

.btn:hover {
  background: #6537D6;
}

.output {
  margin-top: 16px;
  padding: 12px;
  border-radius: 8px;
  background: #FAF9FC;
  border: 1px dashed #E4E2DB;
  color: #7444E8;
  font-weight: 500;
  font-size: 14px;
}
`,

  javascript: `// JavaScript Client Interactivity
const nameInput = document.getElementById('nameInput');
const greetBtn = document.getElementById('greetBtn');
const greetingOutput = document.getElementById('greetingOutput');

greetBtn.addEventListener('click', () => {
  const name = nameInput.value.trim() || 'World';
  const time = new Date().toLocaleTimeString();
  greetingOutput.textContent = \`Hello, \${name}! Welcome to Connect Web Lab at \${time}.\`;
  console.log('Greeting generated for:', name);
});
`,

  sql: `-- Academic Database SQL Playground
-- Tables: departments, instructors, courses, students, enrollments

-- 1. Display all departments and their budgets
SELECT dept_name, building, budget
FROM departments
ORDER BY budget DESC;

-- 2. Query courses taught with instructor information
SELECT c.course_id, c.title, c.dept_name, i.name AS instructor_name
FROM courses c
LEFT JOIN instructors i ON i.dept_name = c.dept_name
ORDER BY c.course_id;

-- 3. Student enrollment statistics with average grades
SELECT
    s.name AS student_name,
    s.dept_name,
    COUNT(e.enrollment_id) AS enrolled_classes
FROM students s
LEFT JOIN enrollments e ON e.student_id = s.student_id
GROUP BY s.student_id, s.name, s.dept_name
ORDER BY enrolled_classes DESC;
`,
};

export const PILOT_COURSES: PilotCourseMeta[] = [
  {
    slug: 'cpp-oops',
    title: 'Object-Oriented Programming with C++',
    code: 'CS201-OOP',
    tagline: 'Classes, Objects, Inheritance, Virtual Functions & Memory Layout',
    description: 'Master practical C++ development including encapsulation, inheritance hierarchies, dynamic polymorphism, operator overloading, and memory management with RAII.',
    badge: 'C++',
    primaryLanguage: 'cpp',
    tools: ['editor', 'oops_visualizer'],
    accentColor: '#7444E8',
    modules: [
      {
        order: 1,
        title: 'Classes, Objects & Encapsulation',
        description: 'Constructors, destructors, access specifiers, and getter/setter patterns.',
        lessons: ['Class Anatomy & Member Variables', 'Constructor Delegating & Initialization Lists', 'Const Correctness'],
        sampleExercise: {
          title: 'BankAccount Class with Balance Validation',
          problem: 'Implement a BankAccount class with deposit(amount), withdraw(amount), and getBalance() methods. Disallow negative deposits or withdrawals exceeding balance.',
          difficulty: 'beginner',
          language: 'cpp',
          starterCode: `#include <iostream>\nusing namespace std;\n\nclass BankAccount {\nprivate:\n    double balance;\npublic:\n    BankAccount(double init) : balance(init) {}\n    void deposit(double amt) {\n        // TODO\n    }\n    bool withdraw(double amt) {\n        // TODO\n        return false;\n    }\n    double getBalance() const {\n        return balance;\n    }\n};\n\nint main() {\n    BankAccount acc(100.0);\n    acc.deposit(50.0);\n    cout << "Balance: " << acc.getBalance() << endl;\n    return 0;\n}`,
          testCases: [
            { input: '', expected_output: 'Balance: 150', is_hidden: false },
          ],
        },
      },
      {
        order: 2,
        title: 'Inheritance & Polymorphism',
        description: 'Base and derived classes, virtual functions, vtables, and pure abstract interfaces.',
        lessons: ['Public vs Private Inheritance', 'Virtual Functions & Runtime Dispatch', 'Abstract Base Classes'],
        sampleExercise: {
          title: 'Geometric Shapes Polymorphic Hierarchy',
          problem: 'Create an abstract Shape class with virtual double area() const = 0, and implement Rectangle and Circle derived classes.',
          difficulty: 'medium',
          language: 'cpp',
          starterCode: `#include <iostream>\nusing namespace std;\n\nclass Shape {\npublic:\n    virtual double area() const = 0;\n    virtual ~Shape() {}\n};\n\nint main() {\n    cout << "Shapes initialized" << endl;\n    return 0;\n}`,
          testCases: [
            { input: '', expected_output: 'Shapes initialized', is_hidden: false },
          ],
        },
      },
    ],
  },
  {
    slug: 'dsa',
    title: 'Data Structures & Algorithms',
    code: 'CS202-DSA',
    tagline: 'Linear Structures, Trees, Graphs, Sorting & Traversal Visualizers',
    description: 'Design and analyze data structures and algorithmic complexity with interactive animated visualizers for arrays, linked lists, stacks, queues, trees, and sorting.',
    badge: 'DSA',
    primaryLanguage: 'cpp',
    tools: ['editor', 'dsa_visualizer'],
    accentColor: '#2DBE74',
    modules: [
      {
        order: 1,
        title: 'Linear Data Structures',
        description: 'Singly and doubly linked lists, circular buffers, stack push/pop, queue operations.',
        lessons: ['Pointers & Node Allocation', 'Stack Operations & Parenthesis Matching', 'Queue Implementations'],
        sampleExercise: {
          title: 'Reverse a Singly Linked List',
          problem: 'Given the head of a linked list, reverse it in-place in O(N) time and O(1) auxiliary space.',
          difficulty: 'medium',
          language: 'cpp',
          starterCode: `#include <iostream>\nusing namespace std;\n\nstruct ListNode {\n    int val;\n    ListNode* next;\n    ListNode(int x) : val(x), next(nullptr) {}\n};\n\nListNode* reverseList(ListNode* head) {\n    // TODO: Invert next pointers\n    return head;\n}\n\nint main() {\n    cout << "Reversed successfully" << endl;\n    return 0;\n}`,
          testCases: [
            { input: '', expected_output: 'Reversed successfully', is_hidden: false },
          ],
        },
      },
      {
        order: 2,
        title: 'Trees & Graph Algorithms',
        description: 'Binary search trees, traversals (pre, in, post), BFS and DFS traversals.',
        lessons: ['BST Insertion & Lookup', 'In-Order Traversal Sorting Property', 'Breadth-First Search'],
        sampleExercise: {
          title: 'Binary Search Tree Validation',
          problem: 'Write a function to determine if a binary tree is a valid Binary Search Tree (BST).',
          difficulty: 'hard',
          language: 'cpp',
          starterCode: `#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "BST Valid: true" << endl;\n    return 0;\n}`,
          testCases: [
            { input: '', expected_output: 'BST Valid: true', is_hidden: false },
          ],
        },
      },
    ],
  },
  {
    slug: 'web-dev',
    title: 'Full-Stack Web Development',
    code: 'CS304-WEB',
    tagline: 'HTML5 Semantic Layout, Modern CSS Flex/Grid & Interactive JavaScript',
    description: 'Build responsive, accessible user interfaces with live split-screen preview, HTML5 elements, CSS responsive layouts, and modern async JavaScript APIs.',
    badge: 'Web',
    primaryLanguage: 'html',
    tools: ['editor', 'web_preview'],
    accentColor: '#FF6B6B',
    modules: [
      {
        order: 1,
        title: 'Semantic HTML5 & Document Flow',
        description: 'Header, main, section, article, forms, input types, and accessibility landmarks.',
        lessons: ['Semantic Elements vs Divs', 'Form Controls & Client Validation', 'ARIA Attributes'],
        sampleExercise: {
          title: 'Responsive Student Registration Card',
          problem: 'Create a semantic HTML form with Name, Email, Department dropdown, and Submit button styled with modern borders.',
          difficulty: 'beginner',
          language: 'html',
          starterCode: `<div class="form-container">\n  <h2>Student Registration</h2>\n  <!-- Add input fields and button here -->\n</div>`,
          testCases: [],
        },
      },
      {
        order: 2,
        title: 'Modern CSS Layouts (Flexbox & Grid)',
        description: 'Centering, auto-fit responsive grids, gap spacing, and media queries.',
        lessons: ['Flex Direction & Alignment', 'CSS Grid Template Columns & Areas', 'Mobile Breakpoints'],
        sampleExercise: {
          title: 'Product Pricing Matrix',
          problem: 'Build a 3-column responsive pricing grid that stacks into a single column on mobile devices.',
          difficulty: 'medium',
          language: 'html',
          starterCode: `<div class="pricing-grid">\n  <div class="tier">Free</div>\n  <div class="tier featured">Pro</div>\n  <div class="tier">Enterprise</div>\n</div>`,
          testCases: [],
        },
      },
    ],
  },
  {
    slug: 'python-ds',
    title: 'Python for Engineers & Data Science',
    code: 'CS102-PY',
    tagline: 'Pythonic Idioms, List Comprehensions, Matrix Math & Data Parsing',
    description: 'Learn modern Python 3 programming from core fundamentals to data manipulation, string parsing, functional iterators, and scientific calculations in WebAssembly.',
    badge: 'Python',
    primaryLanguage: 'python',
    tools: ['editor'],
    accentColor: '#FFC93C',
    modules: [
      {
        order: 1,
        title: 'Core Fundamentals & Data Structures',
        description: 'Lists, dictionaries, sets, tuples, list comprehensions, and generator expressions.',
        lessons: ['Dynamic Typing & Slicing', 'Dictionary Aggregations', 'Comprehensions & Lambdas'],
        sampleExercise: {
          title: 'Word Frequency Histogram',
          problem: 'Write a function word_frequency(text) that returns a dictionary counting occurrences of each unique word ignoring casing.',
          difficulty: 'beginner',
          language: 'python',
          starterCode: `def word_frequency(text: str) -> dict[str, int]:\n    # TODO\n    return {}\n\nprint(word_frequency("hello world hello"))`,
          testCases: [
            { input: '', expected_output: "{'hello': 2, 'world': 1}", is_hidden: false },
          ],
        },
      },
      {
        order: 2,
        title: 'Algorithms & Numeric Computation',
        description: 'Recursive functions, sorting, matrix transformations, and standard library tools.',
        lessons: ['Recursion & Memoization', 'Collections & Itertools', 'File IO & Serialization'],
        sampleExercise: {
          title: 'Matrix Transpose & Multiplication',
          problem: 'Compute the transpose of a 2D matrix represented as a list of lists using list comprehension.',
          difficulty: 'medium',
          language: 'python',
          starterCode: `def transpose(matrix: list[list[int]]) -> list[list[int]]:\n    # TODO\n    return []\n\nprint(transpose([[1, 2], [3, 4]]))`,
          testCases: [
            { input: '', expected_output: '[[1, 3], [2, 4]]', is_hidden: false },
          ],
        },
      },
    ],
  },
  {
    slug: 'dbms-sql',
    title: 'Database Management Systems (SQL)',
    code: 'CS301-DBMS',
    tagline: 'DDL, DML, Relational Algebra, Multi-Table JOINs & Normalization',
    description: 'Practical relational database design and SQL querying in an interactive SQLite WebAssembly sandbox with live schema visualization and query result tables.',
    badge: 'SQL',
    primaryLanguage: 'sql',
    tools: ['editor', 'sql_runner'],
    accentColor: '#06B6D4',
    modules: [
      {
        order: 1,
        title: 'SQL Query Fundamentals & Filtering',
        description: 'SELECT, WHERE, ORDER BY, LIMIT, LIKE, IN, and aggregate functions (COUNT, SUM, AVG).',
        lessons: ['Projection & Selection', 'Pattern Matching with LIKE', 'Aggregate Grouping'],
        sampleExercise: {
          title: 'High-Budget Academic Departments',
          problem: 'Write a SQL query to list all departments with a budget greater than $700,000 ordered by budget descending.',
          difficulty: 'beginner',
          language: 'sql',
          starterCode: `-- Query departments with budget > 700000\nSELECT dept_name, budget\nFROM departments\nWHERE budget > 700000\nORDER BY budget DESC;`,
          testCases: [],
        },
      },
      {
        order: 2,
        title: 'Relational JOINs & Aggregations',
        description: 'INNER JOIN, LEFT OUTER JOIN, GROUP BY, HAVING, and correlated subqueries.',
        lessons: ['Multi-Table Joins', 'GROUP BY with HAVING filters', 'Subqueries vs Joins'],
        sampleExercise: {
          title: 'Department Faculty Payroll Summary',
          problem: 'Calculate total salary expenditure and instructor count for each department having at least 2 instructors.',
          difficulty: 'medium',
          language: 'sql',
          starterCode: `SELECT dept_name, COUNT(instructor_id) AS faculty_count, SUM(salary) AS total_payroll\nFROM instructors\nGROUP BY dept_name\nHAVING COUNT(instructor_id) >= 2;`,
          testCases: [],
        },
      },
    ],
  },
];
