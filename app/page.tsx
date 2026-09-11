import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-slate-100 flex items-center justify-center p-8">
      <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full p-10 text-center">
        <h1 className="text-5xl font-bold text-slate-800 mb-4">
          <span className="text-primary-600">🛡️</span> GuildPass Dashboard
        </h1>
        <p className="text-lg text-slate-600 mb-8">
          Manage your passes, communities, members, and activity all in one place.
        </p>
        <Link href="/dashboard">
          <button className="bg-primary-600 hover:bg-primary-700 text-white font-semibold px-8 py-3 rounded-lg transition-colors">
            Go to Dashboard
          </button>
        </Link>
      </div>
    </div>
  );
}
