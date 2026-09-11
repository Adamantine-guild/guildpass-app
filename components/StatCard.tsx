export default function StatCard({ title, value, icon, trend }: { title: string; value: string | number; icon: string; trend?: string }) {
  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500 font-medium">{title}</p>
          <p className="text-3xl font-bold text-slate-800 mt-1">{value}</p>
          {trend && <p className="text-sm text-green-600 mt-2">{trend}</p>}
        </div>
        <div className="w-12 h-12 bg-primary-50 rounded-lg flex items-center justify-center text-2xl">
          {icon}
        </div>
      </div>
    </div>
  );
}
