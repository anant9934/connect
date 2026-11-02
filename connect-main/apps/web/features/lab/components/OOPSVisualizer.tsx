'use client';

import React, { useState } from 'react';
import { Cpu, Layers, ArrowRight, Sparkles, CheckCircle2 } from 'lucide-react';

export const OOPSVisualizer: React.FC = () => {
  const [selectedClass, setSelectedClass] = useState<'Student' | 'Shape' | 'Polymorphic'>('Polymorphic');
  const [lifecycleStep, setLifecycleStep] = useState<number>(1);

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-[#F1EBFF] text-[#7444E8]">
              C++ Architecture Engine
            </span>
            <span className="text-xs text-[#5E5A50]">Runtime Memory Inspection</span>
          </div>
          <h2 className="text-xl font-extrabold text-[#17151F]">
            Object-Oriented Memory & Virtual Table (vtable) Explorer
          </h2>
          <p className="text-xs text-[#5E5A50] max-w-2xl">
            Inspect how C++ compilers layout object instances in Stack and Heap memory, resolve pointers, and perform runtime dynamic dispatch through virtual function pointer tables.
          </p>
        </div>

        {/* Class Selection Buttons */}
        <div className="flex items-center gap-2 bg-[#FAF9FC] p-1.5 rounded-2xl border border-[#E4E2DB]">
          {(['Student', 'Shape', 'Polymorphic'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setSelectedClass(c);
                setLifecycleStep(1);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
                selectedClass === c
                  ? 'bg-[#7444E8] text-white shadow-xs'
                  : 'text-[#5E5A50] hover:text-[#17151F]'
              }`}
            >
              {c === 'Polymorphic' ? 'Virtual Dispatch (vptr)' : `${c} Layout`}
            </button>
          ))}
        </div>
      </div>

      {/* Memory Diagram Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 1. Stack Memory Frame */}
        <div className="p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#E4E2DB]">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#7444E8]" />
              <h3 className="text-sm font-bold text-[#17151F]">Stack Frame (Local Scope)</h3>
            </div>
            <span className="text-[10px] font-mono text-[#5E5A50]">0x7FFEE4B20</span>
          </div>

          <div className="space-y-3 font-mono text-xs">
            {selectedClass === 'Student' ? (
              <>
                <div className="p-3 rounded-xl bg-[#FAF9FC] border border-[#E4E2DB] space-y-1">
                  <div className="text-[10px] text-[#9C988D]">Address: 0x7FFEE4B20 [int rollNumber]</div>
                  <div className="font-bold text-[#17151F]">Value: 101 (4 bytes)</div>
                </div>
                <div className="p-3 rounded-xl bg-[#F1EBFF] border border-[#7444E8] space-y-1">
                  <div className="text-[10px] text-[#7444E8]">Address: 0x7FFEE4B28 [std::string name]</div>
                  <div className="font-bold text-[#17151F]">Pointer to Heap: 0x00A1F0</div>
                </div>
              </>
            ) : (
              <>
                <div className="p-3 rounded-xl bg-[#F1EBFF] border border-[#7444E8] space-y-1">
                  <div className="text-[10px] text-[#7444E8]">Address: 0x7FFEE4B30 [Shape* ptr]</div>
                  <div className="font-bold text-[#17151F]">Heap Address: 0x00B2A0</div>
                  <div className="text-[10px] text-[#2DBE74]">Points to polymorphic Circle instance</div>
                </div>
                <div className="p-3 rounded-xl bg-[#FAF9FC] border border-[#E4E2DB] space-y-1">
                  <div className="text-[10px] text-[#9C988D]">Address: 0x7FFEE4B38 [double radius]</div>
                  <div className="font-bold text-[#17151F]">Value: 5.5 (8 bytes IEEE 754)</div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 2. Heap Memory Space */}
        <div className="p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#E4E2DB]">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#2DBE74]" />
              <h3 className="text-sm font-bold text-[#17151F]">Heap Allocated Block</h3>
            </div>
            <span className="text-[10px] font-mono text-[#5E5A50]">0x00B2A0</span>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div className="p-3 rounded-xl bg-[#E4F8EB] border border-[#2DBE74] space-y-1">
              <div className="text-[10px] text-[#1F6B3B]">Offset +0 [vptr - Virtual Table Pointer]</div>
              <div className="font-bold text-[#17151F]">Points to: Circle::vtable (0x00F8C0)</div>
              <div className="text-[10px] text-[#5E5A50]">Injected automatically by compiler (8 bytes)</div>
            </div>

            <div className="p-3 rounded-xl bg-[#FAF9FC] border border-[#E4E2DB] space-y-1">
              <div className="text-[10px] text-[#9C988D]">Offset +8 [double radius]</div>
              <div className="font-bold text-[#17151F]">5.5 (Data member)</div>
            </div>

            <div className="p-3 rounded-xl bg-[#FAF9FC] border border-[#E4E2DB] space-y-1">
              <div className="text-[10px] text-[#9C988D]">Offset +16 [std::string color]</div>
              <div className="font-bold text-[#17151F]">&quot;Coral Red&quot;</div>
            </div>
          </div>
        </div>

        {/* 3. Class Virtual Table (vtable) */}
        <div className="p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#E4E2DB]">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#FFC93C]" />
              <h3 className="text-sm font-bold text-[#17151F]">Circle::vtable (Read-Only .rodata)</h3>
            </div>
            <span className="text-[10px] font-mono text-[#5E5A50]">0x00F8C0</span>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div className="p-3 rounded-xl bg-[#FFF4D1] border border-[#FFC93C] space-y-1">
              <div className="text-[10px] text-[#6B4E00]">Slot 0: type_info for Circle</div>
              <div className="font-bold text-[#17151F]">RTTI Metadata (typeid)</div>
            </div>

            <div className="p-3 rounded-xl bg-[#FFF4D1] border border-[#FFC93C] space-y-1">
              <div className="text-[10px] text-[#6B4E00]">Slot 1: virtual double area()</div>
              <div className="font-bold text-[#17151F]">-> &amp;Circle::area (0x001040)</div>
              <div className="text-[10px] text-[#5E5A50]">Overrides Shape::area</div>
            </div>

            <div className="p-3 rounded-xl bg-[#FFF4D1] border border-[#FFC93C] space-y-1">
              <div className="text-[10px] text-[#6B4E00]">Slot 2: virtual ~Shape()</div>
              <div className="font-bold text-[#17151F]">-> &amp;Circle::~Circle (0x001080)</div>
              <div className="text-[10px] text-[#5E5A50]">Virtual destructor prevents memory leaks</div>
            </div>
          </div>
        </div>
      </div>

      {/* Dynamic Dispatch Resolution Step-Through */}
      <div className="p-6 rounded-3xl bg-[#FAF9FC] border border-[#E4E2DB] space-y-3">
        <h4 className="text-sm font-bold text-[#17151F]">
          Polymorphic Call Execution Pipeline: <span className="font-mono text-[#7444E8]">ptr-&gt;area();</span>
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs font-mono">
          <div className="p-3 rounded-xl bg-[#FFFFFF] border border-[#E4E2DB] space-y-1">
            <div className="font-bold text-[#7444E8]">Step 1: Dereference ptr</div>
            <div className="text-[#5E5A50]">Read stack variable 0x7FFEE4B30 -> points to heap 0x00B2A0.</div>
          </div>
          <div className="p-3 rounded-xl bg-[#FFFFFF] border border-[#E4E2DB] space-y-1">
            <div className="font-bold text-[#7444E8]">Step 2: Read vptr</div>
            <div className="text-[#5E5A50]">Extract first 8 bytes of object instance -> Circle::vtable at 0x00F8C0.</div>
          </div>
          <div className="p-3 rounded-xl bg-[#FFFFFF] border border-[#E4E2DB] space-y-1">
            <div className="font-bold text-[#7444E8]">Step 3: Index Slot 1</div>
            <div className="text-[#5E5A50]">Look up offset for area() -> function address 0x001040.</div>
          </div>
          <div className="p-3 rounded-xl bg-[#FFFFFF] border border-[#E4E2DB] space-y-1">
            <div className="font-bold text-[#2DBE74]">Step 4: Dispatch</div>
            <div className="text-[#5E5A50]">Indirect jump: call 0x001040 passing this pointer in registers.</div>
          </div>
        </div>
      </div>
    </div>
  );
};
