import React from "react";
import Link from "next/link";

interface AccessDeniedProps {
  requiredPermission?: string;
  currentRole?: string;
}

export default function AccessDenied({ requiredPermission, currentRole }: AccessDeniedProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 bg-gray-50/50 rounded-xl border border-gray-200/80 max-w-2xl mx-auto my-12">
      <div className="h-14 w-14 bg-red-50 text-red-600 rounded-full flex items-center justify-center mb-4 border border-red-100">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m0-6v2m0-8H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-5z" />
        </svg>
      </div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Boundary Triggered</h2>
      <p className="text-gray-600 mb-6 max-w-md">
        Your assigned role <span className="px-2 py-0.5 bg-gray-200 text-gray-800 rounded font-mono text-sm">{currentRole || "unknown"}</span> does not hold the permissions required to view or modify this screen.
      </p>

      {requiredPermission && (
        <div className="mb-6 px-4 py-2.5 bg-gray-100 border border-gray-200 rounded-lg text-left text-xs font-mono text-gray-500 w-full max-w-md">
          <span className="font-semibold text-gray-700">Required Boundary:</span> {requiredPermission}
        </div>
      )}

      <div className="flex gap-4">
        <Link href="/dashboard" className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm rounded-lg transition-colors shadow-sm">
          Return Home
        </Link>
      </div>
    </div>
  );
}