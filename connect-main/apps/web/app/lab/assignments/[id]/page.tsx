import React from 'react';
import { notFound } from 'next/navigation';
import { AssignmentSolver } from '@/features/lab/components/AssignmentSolver';
import type { LabAssignment } from '@/features/lab/types';

interface AssignmentPageProps {
  params: Promise<{ id: string }>;
}

export default async function AssignmentPage({ params }: AssignmentPageProps) {
  const { id } = await params;

  // Mock assignment or retrieve from DB/API
  const assignment: LabAssignment = {
    id,
    organization_id: '11111111-1111-1111-1111-111111111111',
    lab_course_id: '22222222-2222-2222-2222-222222222222',
    created_by_user_id: '33333333-3333-3333-3333-333333333333',
    title: 'Practical Lab: Dynamic Array Template with Memory Boundary Checks',
    description: `Problem Statement:
Design and implement a generic Container class template in C++ or Python that manages a dynamically allocated buffer.

Requirements:
1. Provide push(element) to insert at the end, resizing buffer by a factor of 2 when capacity is exceeded.
2. Provide pop() which removes the last element and returns it.
3. Provide at(index) that throws or prints an error message if index is out of bounds.
4. Correctly free all heap allocated memory in destructor with zero memory leaks.

Example:
Input:
push 10
push 20
pop
at 0

Expected Output:
20
10`,
    allowed_languages: ['cpp', 'python', 'java'],
    starter_code: {
      code: `#include <iostream>
using namespace std;

// Implement your solution here

int main() {
    cout << "20" << endl;
    cout << "10" << endl;
    return 0;
}`,
    },
    due_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    max_score: 100,
    status: 'published',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    test_cases: [
      {
        id: 'tc-01',
        organization_id: '11111111-1111-1111-1111-111111111111',
        assignment_id: id,
        input: '5\n',
        expected_output: '20\n10',
        is_hidden: false,
        weight: 1,
        time_limit_ms: 2000,
      },
      {
        id: 'tc-02-hidden',
        organization_id: '11111111-1111-1111-1111-111111111111',
        assignment_id: id,
        input: '1000\n',
        expected_output: '1000',
        is_hidden: true,
        weight: 2,
        time_limit_ms: 2000,
      },
    ],
  };

  return (
    <div className="min-h-screen bg-[#FAF9FC]">
      <AssignmentSolver assignment={assignment} orgId={assignment.organization_id} />
    </div>
  );
}
