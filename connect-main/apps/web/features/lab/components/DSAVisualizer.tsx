'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  Plus,
  Trash2,
  Search,
  Layers,
  ArrowRight,
  GitCommit,
  BarChart3,
  ListOrdered,
} from 'lucide-react';

type DsaCategory = 'linked_list' | 'stack_queue' | 'binary_tree' | 'sorting';

interface ListNode {
  id: string;
  value: number;
}

interface TreeNode {
  value: number;
  left?: TreeNode;
  right?: TreeNode;
}

export const DSAVisualizer: React.FC = () => {
  const [category, setCategory] = useState<DsaCategory>('linked_list');

  // --- 1. Linked List State ---
  const [listNodes, setListNodes] = useState<ListNode[]>([
    { id: '1', value: 12 },
    { id: '2', value: 24 },
    { id: '3', value: 36 },
    { id: '4', value: 48 },
  ]);
  const [listInputValue, setListInputValue] = useState<string>('');
  const [activeHighlightIdx, setActiveHighlightIdx] = useState<number | null>(null);
  const [linkedListLog, setLinkedListLog] = useState<string>('Linked list initialized with 4 nodes.');

  const handleInsertHead = () => {
    const val = parseInt(listInputValue, 10);
    if (isNaN(val)) return;
    const newNode: ListNode = { id: String(Date.now()), value: val };
    setListNodes([newNode, ...listNodes]);
    setListInputValue('');
    setLinkedListLog(`Inserted ${val} at head (O(1)).`);
  };

  const handleInsertTail = () => {
    const val = parseInt(listInputValue, 10);
    if (isNaN(val)) return;
    const newNode: ListNode = { id: String(Date.now()), value: val };
    setListNodes([...listNodes, newNode]);
    setListInputValue('');
    setLinkedListLog(`Inserted ${val} at tail (O(N) traversal or O(1) with tail pointer).`);
  };

  const handleDeleteNode = (id: string, val: number) => {
    setListNodes(listNodes.filter((n) => n.id !== id));
    setLinkedListLog(`Deleted node with value ${val}. Updated pointer links.`);
  };

  const handleSearchNode = async () => {
    const target = parseInt(listInputValue, 10);
    if (isNaN(target)) return;
    setLinkedListLog(`Traversing linked list searching for ${target}...`);

    for (let i = 0; i < listNodes.length; i++) {
      setActiveHighlightIdx(i);
      await new Promise((r) => setTimeout(r, 600));
      if (listNodes[i].value === target) {
        setLinkedListLog(`Found value ${target} at node index ${i}!`);
        return;
      }
    }
    setActiveHighlightIdx(null);
    setLinkedListLog(`Value ${target} not found in linked list.`);
  };

  // --- 2. Stack & Queue State ---
  const [stackItems, setStackItems] = useState<number[]>([10, 20, 30]);
  const [queueItems, setQueueItems] = useState<number[]>([100, 200, 300]);
  const [sqInputValue, setSqInputValue] = useState<string>('');
  const [sqLog, setSqLog] = useState<string>('Stack & Queue initialized.');

  const handlePushStack = () => {
    const val = parseInt(sqInputValue, 10);
    if (isNaN(val)) return;
    setStackItems([...stackItems, val]);
    setSqInputValue('');
    setSqLog(`Pushed ${val} onto Stack (LIFO: Top is now ${val}).`);
  };

  const handlePopStack = () => {
    if (stackItems.length === 0) {
      setSqLog('Stack Underflow: cannot pop from empty stack.');
      return;
    }
    const popped = stackItems[stackItems.length - 1];
    setStackItems(stackItems.slice(0, -1));
    setSqLog(`Popped ${popped} from top of Stack.`);
  };

  const handleEnqueue = () => {
    const val = parseInt(sqInputValue, 10);
    if (isNaN(val)) return;
    setQueueItems([...queueItems, val]);
    setSqInputValue('');
    setSqLog(`Enqueued ${val} at Rear of Queue (FIFO).`);
  };

  const handleDequeue = () => {
    if (queueItems.length === 0) {
      setSqLog('Queue Underflow: cannot dequeue from empty queue.');
      return;
    }
    const dequeued = queueItems[0];
    setQueueItems(queueItems.slice(1));
    setSqLog(`Dequeued ${dequeued} from Front of Queue.`);
  };

  // --- 3. Binary Search Tree State ---
  const [treeValues, setTreeValues] = useState<number[]>([50, 30, 70, 20, 40, 60, 80]);
  const [treeInputValue, setTreeInputValue] = useState<string>('');
  const [traversalHighlight, setTraversalHighlight] = useState<number | null>(null);
  const [treeLog, setTreeLog] = useState<string>('Binary Search Tree initialized.');

  const handleInsertTree = () => {
    const val = parseInt(treeInputValue, 10);
    if (isNaN(val) || treeValues.includes(val)) return;
    setTreeValues([...treeValues, val]);
    setTreeInputValue('');
    setTreeLog(`Inserted ${val} into BST maintaining (left < root < right) invariant.`);
  };

  const handleInOrderTraversal = async () => {
    // In-order traversal sorts a BST:
    const sorted = [...treeValues].sort((a, b) => a - b);
    setTreeLog('Running In-Order Traversal (Left -> Root -> Right)...');
    for (const val of sorted) {
      setTraversalHighlight(val);
      await new Promise((r) => setTimeout(r, 600));
    }
    setTraversalHighlight(null);
    setTreeLog(`In-Order sequence: [${sorted.join(', ')}] (Always yields sorted order).`);
  };

  // --- 4. Sorting & Searching State ---
  const [sortArray, setSortArray] = useState<number[]>([64, 34, 25, 12, 22, 11, 90]);
  const [comparingIndices, setComparingIndices] = useState<[number, number] | null>(null);
  const [isSorting, setIsSorting] = useState<boolean>(false);
  const [sortLog, setSortLog] = useState<string>('Array ready for sorting.');

  const handleResetSort = () => {
    setSortArray([64, 34, 25, 12, 22, 11, 90]);
    setComparingIndices(null);
    setIsSorting(false);
    setSortLog('Array reset.');
  };

  const handleBubbleSort = async () => {
    setIsSorting(true);
    setSortLog('Starting Bubble Sort (O(N^2) comparisons)...');
    const arr = [...sortArray];
    const n = arr.length;

    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < n - i - 1; j++) {
        setComparingIndices([j, j + 1]);
        setSortLog(`Comparing arr[${j}]=${arr[j]} and arr[${j + 1}]=${arr[j + 1]}`);
        await new Promise((r) => setTimeout(r, 500));

        if (arr[j] > arr[j + 1]) {
          const temp = arr[j];
          arr[j] = arr[j + 1];
          arr[j + 1] = temp;
          setSortArray([...arr]);
          setSortLog(`Swapped: arr[${j}] and arr[${j + 1}]`);
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    }

    setComparingIndices(null);
    setIsSorting(false);
    setSortLog('Bubble Sort complete! Array is sorted.');
  };

  return (
    <div className="space-y-6">
      {/* Category Navigation Pills */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 bg-[#FAF9FC] border border-[#E4E2DB] rounded-2xl w-fit">
        <button
          type="button"
          onClick={() => setCategory('linked_list')}
          className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
            category === 'linked_list'
              ? 'bg-[#7444E8] text-white shadow-xs'
              : 'text-[#5E5A50] hover:text-[#17151F]'
          }`}
        >
          <GitCommit className="w-3.5 h-3.5" />
          Linked Lists
        </button>

        <button
          type="button"
          onClick={() => setCategory('stack_queue')}
          className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
            category === 'stack_queue'
              ? 'bg-[#7444E8] text-white shadow-xs'
              : 'text-[#5E5A50] hover:text-[#17151F]'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          Stack & Queue
        </button>

        <button
          type="button"
          onClick={() => setCategory('binary_tree')}
          className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
            category === 'binary_tree'
              ? 'bg-[#7444E8] text-white shadow-xs'
              : 'text-[#5E5A50] hover:text-[#17151F]'
          }`}
        >
          <ListOrdered className="w-3.5 h-3.5" />
          Binary Search Tree
        </button>

        <button
          type="button"
          onClick={() => setCategory('sorting')}
          className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
            category === 'sorting'
              ? 'bg-[#7444E8] text-white shadow-xs'
              : 'text-[#5E5A50] hover:text-[#17151F]'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          Sorting Algorithms
        </button>
      </div>

      {/* Main Canvas Box */}
      <div className="p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm space-y-6">
        {/* --- 1. LINKED LIST CANVAS --- */}
        {category === 'linked_list' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-[#17151F]">Singly Linked List Interactive Model</h3>
                <p className="text-xs text-[#5E5A50]">
                  Each node stores data and a memory pointer (next) referencing the subsequent node.
                </p>
              </div>

              {/* Controls */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  placeholder="Value..."
                  value={listInputValue}
                  onChange={(e) => setListInputValue(e.target.value)}
                  className="w-24 px-3 py-1.5 text-xs border border-[#E4E2DB] rounded-lg outline-none focus:border-[#7444E8]"
                />
                <button
                  type="button"
                  onClick={handleInsertHead}
                  className="px-3 py-1.5 bg-[#FAF9FC] border border-[#E4E2DB] hover:border-[#7444E8] text-xs font-semibold text-[#17151F] rounded-lg transition-colors cursor-pointer"
                >
                  + Head
                </button>
                <button
                  type="button"
                  onClick={handleInsertTail}
                  className="px-3 py-1.5 bg-[#FAF9FC] border border-[#E4E2DB] hover:border-[#7444E8] text-xs font-semibold text-[#17151F] rounded-lg transition-colors cursor-pointer"
                >
                  + Tail
                </button>
                <button
                  type="button"
                  onClick={handleSearchNode}
                  className="flex items-center gap-1 px-3 py-1.5 bg-[#7444E8] hover:bg-[#6537D6] text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  <Search className="w-3 h-3" />
                  Search
                </button>
              </div>
            </div>

            {/* Visualizer Canvas */}
            <div className="p-8 rounded-2xl bg-[#FAF9FC] border border-[#E4E2DB] overflow-x-auto min-h-[160px] flex items-center">
              {listNodes.length === 0 ? (
                <div className="text-xs text-[#9C988D] italic">List is empty. Insert a node to begin.</div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="px-2.5 py-1 text-[11px] font-bold rounded-md bg-[#F1EBFF] text-[#7444E8] border border-[#E3D9FC]">
                    HEAD
                  </div>
                  {listNodes.map((node, idx) => (
                    <React.Fragment key={node.id}>
                      <div
                        className={`group relative flex items-center rounded-xl border transition-all duration-300 shadow-xs ${
                          activeHighlightIdx === idx
                            ? 'bg-[#FFF4D1] border-[#FFC93C] scale-110'
                            : 'bg-[#FFFFFF] border-[#E4E2DB] hover:border-[#7444E8]'
                        }`}
                      >
                        <div className="px-3.5 py-2.5 text-sm font-bold text-[#17151F] border-r border-[#E4E2DB]">
                          {node.value}
                        </div>
                        <div className="px-2 py-2 text-[10px] font-mono text-[#5E5A50] bg-[#FAF9FC] rounded-r-xl">
                          next
                        </div>
                        {/* Hover delete button */}
                        <button
                          type="button"
                          onClick={() => handleDeleteNode(node.id, node.value)}
                          className="absolute -top-2 -right-2 p-1 bg-[#FF6B6B] text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                      <ArrowRight className="w-4 h-4 text-[#7444E8] shrink-0" />
                    </React.Fragment>
                  ))}
                  <div className="px-2.5 py-1 text-[11px] font-mono rounded-md bg-[#F6F5F2] text-[#9C988D] border border-[#E4E2DB]">
                    NULL
                  </div>
                </div>
              )}
            </div>

            {/* Status log */}
            <div className="p-3 bg-[#FAF9FC] rounded-xl border border-[#F0EEE8] text-xs font-mono text-[#5E5A50]">
              &gt; {linkedListLog}
            </div>
          </div>
        )}

        {/* --- 2. STACK & QUEUE CANVAS --- */}
        {category === 'stack_queue' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-[#17151F]">Stack (LIFO) & Queue (FIFO) Dual Model</h3>
                <p className="text-xs text-[#5E5A50]">
                  Stack push/pop from the top. Queue enqueue at rear, dequeue from front.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  placeholder="Value..."
                  value={sqInputValue}
                  onChange={(e) => setSqInputValue(e.target.value)}
                  className="w-24 px-3 py-1.5 text-xs border border-[#E4E2DB] rounded-lg outline-none focus:border-[#7444E8]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Stack Box */}
              <div className="p-5 rounded-2xl bg-[#FAF9FC] border border-[#E4E2DB] space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#7444E8]">STACK (LIFO)</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handlePushStack}
                      className="px-2.5 py-1 bg-[#7444E8] text-white text-xs font-semibold rounded-lg shadow-xs"
                    >
                      Push
                    </button>
                    <button
                      type="button"
                      onClick={handlePopStack}
                      className="px-2.5 py-1 bg-[#FFFFFF] border border-[#E4E2DB] text-[#FF6B6B] text-xs font-semibold rounded-lg"
                    >
                      Pop
                    </button>
                  </div>
                </div>

                <div className="w-full h-48 border-2 border-dashed border-[#E4E2DB] rounded-xl p-3 flex flex-col-reverse gap-2 overflow-y-auto bg-[#FFFFFF]">
                  {stackItems.length === 0 ? (
                    <div className="m-auto text-xs text-[#9C988D] italic">Stack is Empty</div>
                  ) : (
                    stackItems.map((val, idx) => (
                      <div
                        key={idx}
                        className={`p-2 rounded-lg text-center font-mono text-xs font-bold border transition-all ${
                          idx === stackItems.length - 1
                            ? 'bg-[#F1EBFF] border-[#7444E8] text-[#7444E8]'
                            : 'bg-[#FAF9FC] border-[#E4E2DB] text-[#17151F]'
                        }`}
                      >
                        {val} {idx === stackItems.length - 1 ? '← (TOP)' : ''}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Queue Box */}
              <div className="p-5 rounded-2xl bg-[#FAF9FC] border border-[#E4E2DB] space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#2DBE74]">QUEUE (FIFO)</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleEnqueue}
                      className="px-2.5 py-1 bg-[#2DBE74] text-white text-xs font-semibold rounded-lg shadow-xs"
                    >
                      Enqueue
                    </button>
                    <button
                      type="button"
                      onClick={handleDequeue}
                      className="px-2.5 py-1 bg-[#FFFFFF] border border-[#E4E2DB] text-[#FF6B6B] text-xs font-semibold rounded-lg"
                    >
                      Dequeue
                    </button>
                  </div>
                </div>

                <div className="w-full h-48 border-2 border-dashed border-[#E4E2DB] rounded-xl p-3 flex items-center gap-2 overflow-x-auto bg-[#FFFFFF]">
                  {queueItems.length === 0 ? (
                    <div className="m-auto text-xs text-[#9C988D] italic">Queue is Empty</div>
                  ) : (
                    queueItems.map((val, idx) => (
                      <div
                        key={idx}
                        className={`px-4 py-3 rounded-lg text-center font-mono text-xs font-bold border shrink-0 transition-all ${
                          idx === 0
                            ? 'bg-[#E4F8EB] border-[#2DBE74] text-[#1F6B3B]'
                            : 'bg-[#FAF9FC] border-[#E4E2DB] text-[#17151F]'
                        }`}
                      >
                        <div>{val}</div>
                        <div className="text-[9px] font-normal text-[#5E5A50] mt-0.5">
                          {idx === 0 ? 'FRONT' : idx === queueItems.length - 1 ? 'REAR' : `pos ${idx}`}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="p-3 bg-[#FAF9FC] rounded-xl border border-[#F0EEE8] text-xs font-mono text-[#5E5A50]">
              &gt; {sqLog}
            </div>
          </div>
        )}

        {/* --- 3. BINARY SEARCH TREE CANVAS --- */}
        {category === 'binary_tree' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-[#17151F]">Binary Search Tree (BST)</h3>
                <p className="text-xs text-[#5E5A50]">
                  Maintains property: left child &lt; parent &lt; right child. Supports O(log N) average lookup.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  placeholder="Key..."
                  value={treeInputValue}
                  onChange={(e) => setTreeInputValue(e.target.value)}
                  className="w-20 px-3 py-1.5 text-xs border border-[#E4E2DB] rounded-lg outline-none focus:border-[#7444E8]"
                />
                <button
                  type="button"
                  onClick={handleInsertTree}
                  className="px-3 py-1.5 bg-[#FAF9FC] border border-[#E4E2DB] hover:border-[#7444E8] text-xs font-semibold text-[#17151F] rounded-lg"
                >
                  Insert Node
                </button>
                <button
                  type="button"
                  onClick={handleInOrderTraversal}
                  className="px-3 py-1.5 bg-[#7444E8] hover:bg-[#6537D6] text-white text-xs font-semibold rounded-lg shadow-xs"
                >
                  In-Order Traversal
                </button>
              </div>
            </div>

            {/* Tree Nodes Node Grid Canvas */}
            <div className="p-8 rounded-2xl bg-[#FAF9FC] border border-[#E4E2DB] flex flex-col items-center justify-center min-h-[220px] space-y-4">
              <div className="flex flex-wrap items-center justify-center gap-3">
                {treeValues.map((val) => (
                  <div
                    key={val}
                    className={`w-12 h-12 rounded-full flex items-center justify-center font-mono text-sm font-bold border-2 transition-all duration-300 shadow-sm ${
                      traversalHighlight === val
                        ? 'bg-[#FFC93C] border-[#17151F] text-[#17151F] scale-125'
                        : 'bg-[#FFFFFF] border-[#7444E8] text-[#7444E8]'
                    }`}
                  >
                    {val}
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-[#5E5A50] text-center max-w-md">
                BST root: 50. Left subtree nodes: 30, 20, 40. Right subtree nodes: 70, 60, 80.
              </div>
            </div>

            <div className="p-3 bg-[#FAF9FC] rounded-xl border border-[#F0EEE8] text-xs font-mono text-[#5E5A50]">
              &gt; {treeLog}
            </div>
          </div>
        )}

        {/* --- 4. SORTING CANVAS --- */}
        {category === 'sorting' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-[#17151F]">Sorting Algorithm Step Visualizer</h3>
                <p className="text-xs text-[#5E5A50]">
                  Visualizing element comparisons and bar swaps with color-coded comparison pointers.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetSort}
                  disabled={isSorting}
                  className="px-3 py-1.5 bg-[#FAF9FC] border border-[#E4E2DB] text-xs font-semibold text-[#17151F] rounded-lg"
                >
                  Reset Array
                </button>
                <button
                  type="button"
                  onClick={handleBubbleSort}
                  disabled={isSorting}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#7444E8] hover:bg-[#6537D6] text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Run Bubble Sort
                </button>
              </div>
            </div>

            {/* Bars Visualization Canvas */}
            <div className="p-8 rounded-2xl bg-[#FAF9FC] border border-[#E4E2DB] h-64 flex items-end justify-center gap-4">
              {sortArray.map((val, idx) => {
                const isComparing = comparingIndices && (comparingIndices[0] === idx || comparingIndices[1] === idx);
                return (
                  <div key={idx} className="flex flex-col items-center gap-2">
                    <span className="text-[11px] font-mono text-[#5E5A50]">{val}</span>
                    <div
                      className={`w-10 rounded-t-xl transition-all duration-200 ${
                        isComparing ? 'bg-[#FF6B6B] shadow-md scale-105' : 'bg-[#7444E8]'
                      }`}
                      style={{ height: `${val * 2}px` }}
                    />
                    <span className="text-[10px] text-[#9C988D]">[{idx}]</span>
                  </div>
                );
              })}
            </div>

            <div className="p-3 bg-[#FAF9FC] rounded-xl border border-[#F0EEE8] text-xs font-mono text-[#5E5A50]">
              &gt; {sortLog}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
