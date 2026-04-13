'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Entity {
  id: string;
  name: string;
  regime: string;
  frequency: string;
}

interface Declaration {
  id: string;
  entity_name: string;
  year: number;
  period: string;
  status: string;
  created_at: string;
}

export default function Home() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [declarations, setDeclarations] = useState<Declaration[]>([]);

  useEffect(() => {
    fetch('/api/entities').then(r => r.json()).then(setEntities);
    fetch('/api/declarations').then(r => r.json()).then(setDeclarations);
  }, []);

  const recentDeclarations = declarations.slice(0, 10);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Entities</div>
          <div className="text-2xl font-bold">{entities.length}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Declarations</div>
          <div className="text-2xl font-bold">{declarations.length}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase font-semibold mb-1">In Review</div>
          <div className="text-2xl font-bold">
            {declarations.filter(d => d.status === 'review').length}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Entities</h2>
            <Link href="/entities" className="text-sm text-blue-600 hover:underline">
              View all
            </Link>
          </div>
          {entities.length === 0 ? (
            <p className="text-sm text-gray-500">
              No entities yet.{' '}
              <Link href="/entities" className="text-blue-600 hover:underline">Create one</Link>
            </p>
          ) : (
            <div className="space-y-2">
              {entities.slice(0, 5).map(e => (
                <div key={e.id} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                  <span className="font-medium">{e.name}</span>
                  <span className="text-xs text-gray-500">{e.regime} / {e.frequency}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Recent Declarations</h2>
            <Link href="/declarations" className="text-sm text-blue-600 hover:underline">
              View all
            </Link>
          </div>
          {recentDeclarations.length === 0 ? (
            <p className="text-sm text-gray-500">No declarations yet.</p>
          ) : (
            <div className="space-y-2">
              {recentDeclarations.map(d => (
                <Link
                  key={d.id}
                  href={`/declarations/${d.id}`}
                  className="flex items-center justify-between text-sm py-1 border-b last:border-0 hover:bg-gray-50"
                >
                  <span>
                    <span className="font-medium">{d.entity_name}</span>
                    <span className="text-gray-500 ml-2">{d.year} {d.period}</span>
                  </span>
                  <StatusBadge status={d.status} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    created: 'bg-gray-100 text-gray-700',
    uploading: 'bg-blue-100 text-blue-700',
    extracting: 'bg-purple-100 text-purple-700',
    classifying: 'bg-yellow-100 text-yellow-700',
    review: 'bg-orange-100 text-orange-700',
    approved: 'bg-green-100 text-green-700',
    filed: 'bg-emerald-100 text-emerald-800',
    paid: 'bg-teal-100 text-teal-800',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${colors[status] || 'bg-gray-100'}`}>
      {status.toUpperCase()}
    </span>
  );
}
